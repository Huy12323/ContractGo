-- ---------------------------------------------------------------------------
-- CG-015 — chain coverage, and the drop of the deprecated signer `fields`
-- ---------------------------------------------------------------------------
-- v1.1.0 Phase H. Two unrelated-looking changes ship together because the
-- chain audit that motivates the first one is what proves the second is safe:
-- auditing every state transition against
-- `signature_audit_log_event_type_enum` turned up three gaps, and two of them
-- are gaps the DATABASE has to close because the fact they want to record —
-- how many credentials a revocation actually killed, and whether a redemption
-- was a credential's FIRST use — is only knowable inside the statement that
-- does the work.
--
-- THE AUDIT, in full. Every v1.1 transition, against the 21 enum values:
--
--   send                    -> request_sent                (envelopes_send)
--   draft create            -> request_created             (envelopes_draft_create)
--   notify / resend         -> signer_token_issued + signer_notified
--   view                    -> signer_viewed               (signing_session_open)
--   save fields             -> signer_fields_saved         (signing_submit)
--   sign                    -> signer_signed               (signing_submit)
--   advance                 -> the next batch's signer_notified  (see NOTE below)
--   CC notify               -> cc_notified                 (envelopeNotify)
--   decline                 -> signer_declined             (signing_decline)
--   remind                  -> signer_reminded             (envelopeNotify)
--   expire                  -> request_expired             (envelopes_cron_expire)
--   void                    -> request_cancelled           (envelopes_void)
--   request changes         -> sender_requested_changes    (envelopes_request-changes)
--   supersede               -> capture_superseded          (envelopes_request-changes)
--   burn                    -> document_burned             (signing_submit)
--   cryptographic sign      -> document_signed             (signing_submit)
--   complete                -> request_completed           (signing_submit)
--   download                -> integrity_verified          (envelopes_download-signed)
--
-- NOTE on `advance`: there is deliberately no `request_advanced` value. The
-- routing pointer moving is not an event about the DOCUMENT; its observable
-- consequence is the next batch being notified, and that already chains. An
-- advance that notified nobody would be a bug (CG-014 addition 1), not an
-- event worth recording as normal.
--
-- THE THREE GAPS, and what closes each:
--
--   1. `signer_token_redeemed` is declared in `SignerAuditEventType` and
--      written by nothing. It should not fire per HTTP call — the chain
--      records what happened to the document, not that a browser polled, and
--      `signature_audit_append` takes FOR UPDATE on the request, so a
--      per-call entry would serialize the signing surface against itself. It
--      SHOULD fire once per credential, on first use: "this emailed link was
--      opened for the first time, from this IP, at this time" is exactly the
--      kind of fact an evidence trail wants, it is bounded at one entry per
--      `signer_token_issued`, and it is the ONLY trace a CC observer ever
--      leaves — today nothing records that an observer opened the document at
--      all. `signer_token_redeem` therefore has to return `use_count`, which
--      it computes and then throws away.
--
--   2. `signer_access_denied` is likewise declared and never written. Closed
--      in TypeScript (`signerAuth.assertCanAct`), which is where the context
--      for a refused act exists. No schema change needed. Note that a refusal
--      inside `resolveSignerToken` — a bad, expired or revoked token — still
--      cannot be chained, and that is not an oversight: there is no request id
--      to chain it to, and inventing one would put a fabricated row in the
--      evidence trail. The same reasoning CG-013 applied to cron heartbeats.
--
--   3. Token revocation is chained in ONE of four places.
--      `envelopes_request-changes` records `signer_token_revoked` with a
--      count; `signing_decline`, `envelopes_void` and `envelopes_cron_expire`
--      all revoke silently. The asymmetry is not a judgement call — it is that
--      CG-011 gave `signer_token_revoke_for_signer` an INTEGER return "so the
--      caller can chain an entry that records how many credentials were
--      actually killed", and never did the same for
--      `signer_token_revoke_for_request`, which is the one the other three
--      call. `envelopes_cron_expire/index.ts:131` already reads that return as
--      a number and writes `tokens_revoked` into the `request_expired`
--      payload — it has been recording NULL since CG-013 because the function
--      returns VOID. This migration makes the return match the call site that
--      was already written for it.
--
-- AND the phase's stated task: drop `signature_request_signers.fields`,
-- deprecated since CG-006 and superseded by `field_values`. See PHASE 1 —
-- the drop is asserted lossless rather than assumed so.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- PHASE 1: PROVE THE `fields` DROP IS LOSSLESS BEFORE MAKING IT
-- ---------------------------------------------------------------------------
-- `fields` was AHR-2100's per-signer positioned-box list, from before templates
-- were the source of layout. CG-005 backfilled `signature_requests.template_
-- snapshot` FROM this column for exactly the rows that predate it, so the
-- information is supposed to survive the drop in the snapshot. "Supposed to"
-- is not a standard to destroy a column on: this asserts it, per row, by key.
--
-- A failure here is not a reason to skip the assertion — it means a signer's
-- field layout exists ONLY in the column about to be dropped, and the drop
-- would destroy the record of where that person's signature was placed on a
-- document they signed.

DO $$
DECLARE
    v_orphans TEXT;
BEGIN
    SELECT string_agg(DISTINCT s.id || ' (key: ' || (f.elem ->> 'key') || ')', E'\n  ')
      INTO v_orphans
      FROM public.signature_request_signers s
      JOIN public.signature_requests r ON r.id = s.request_id
     CROSS JOIN LATERAL jsonb_array_elements(s.fields) AS f(elem)
     WHERE s.fields <> '[]'::jsonb
       AND NOT EXISTS (
               SELECT 1
                 FROM jsonb_array_elements(
                          COALESCE(r.template_snapshot -> 'layout', '[]'::jsonb)
                      ) AS l(elem)
                WHERE l.elem ->> 'key' = f.elem ->> 'key'
           );

    IF v_orphans IS NOT NULL THEN
        RAISE EXCEPTION E'CG-015: refusing to drop signature_request_signers.fields — these entries are not represented in their request''s template_snapshot.layout and would be destroyed:\n  %',
            v_orphans;
    END IF;

    RAISE NOTICE 'CG-015: every signature_request_signers.fields entry is mirrored in template_snapshot.layout; the drop is lossless.';
END $$;

ALTER TABLE public.signature_request_signers DROP COLUMN fields;

COMMENT ON COLUMN public.signature_request_signers.field_values IS
    'The values this signer entered, keyed by TemplateField.id. Sole successor '
    'to the `fields` column dropped in CG-015: layout lives on the request''s '
    'template_snapshot, and only the entered VALUES are per-signer.';

-- ---------------------------------------------------------------------------
-- PHASE 2: `signer_token_revoke_for_request` REPORTS WHAT IT REVOKED
-- ---------------------------------------------------------------------------
-- DROP + CREATE rather than CREATE OR REPLACE: the return type changes, and
-- Postgres refuses to replace a function's result type. Nothing in SQL calls
-- it — the three callers are edge functions — so the drop is safe without a
-- dependency sweep, which was checked rather than assumed.
--
-- CREATE re-applies Supabase's schema default privileges (anon and
-- authenticated get EXECUTE), which is the whole mechanism CG-010 documented.
-- The REVOKE below therefore is not belt-and-braces; without it this migration
-- would REOPEN the hole CG-010 closed. It names the roles explicitly for the
-- same reason.

DROP FUNCTION IF EXISTS public.signer_token_revoke_for_request(TEXT);

CREATE FUNCTION public.signer_token_revoke_for_request(p_request_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_revoked INTEGER;
BEGIN
    UPDATE public.signer_access_tokens
       SET revoked_at = now()
     WHERE request_id = p_request_id
       AND revoked_at IS NULL;

    GET DIAGNOSTICS v_revoked = ROW_COUNT;
    RETURN v_revoked;
END;
$$;

COMMENT ON FUNCTION public.signer_token_revoke_for_request(TEXT) IS
    'Administrative revocation of every live link on a request — void, decline, '
    'expire. Returns the number of credentials actually killed so the caller '
    'can chain a signer_token_revoked entry that says how many, matching '
    'signer_token_revoke_for_signer (CG-011). Returned VOID until CG-015.';

REVOKE EXECUTE ON FUNCTION public.signer_token_revoke_for_request(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.signer_token_revoke_for_request(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- PHASE 3: `signer_token_redeem` REPORTS THE USE COUNT IT ALREADY COMPUTES
-- ---------------------------------------------------------------------------
-- Same DROP + CREATE reasoning: adding a column to a RETURNS TABLE is a result
-- type change. The body is unchanged apart from returning `use_count` — the
-- post-increment value, so a credential's FIRST redemption returns 1 and the
-- caller can chain `signer_token_redeemed` exactly once per issued token.
--
-- Everything that made this function correct stays: the expiry, revocation,
-- consumption and use-cap checks and the increment are still ONE statement, so
-- concurrent requests still cannot both slip past the cap. Splitting them to
-- read the count separately would reintroduce the race the single UPDATE was
-- written to avoid, which is why the count is returned FROM the UPDATE.

DROP FUNCTION IF EXISTS public.signer_token_redeem(TEXT, TEXT);

CREATE FUNCTION public.signer_token_redeem(
    p_token_hash TEXT,
    p_ip TEXT DEFAULT NULL
)
RETURNS TABLE(
    token_id TEXT,
    signer_id TEXT,
    request_id TEXT,
    organization_id TEXT,
    purpose public.signer_access_tokens_purpose_enum,
    use_count INTEGER
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    UPDATE public.signer_access_tokens t
       SET use_count    = t.use_count + 1,
           last_used_at = now(),
           last_used_ip = COALESCE(p_ip::inet, t.last_used_ip)
     WHERE t.token_hash = p_token_hash
       AND t.revoked_at IS NULL
       AND t.consumed_at IS NULL
       AND t.expires_at > now()
       AND t.use_count < t.max_uses
    RETURNING t.id, t.signer_id, t.request_id, t.organization_id, t.purpose, t.use_count;
$$;

COMMENT ON FUNCTION public.signer_token_redeem(TEXT, TEXT) IS
    'Atomically validates and consumes one use of an access token. Returns the '
    'POST-increment use_count (CG-015) so the caller can chain '
    'signer_token_redeemed on a credential''s first use and only then — the '
    'one trace a CC observer opening a document otherwise leaves.';

REVOKE EXECUTE ON FUNCTION public.signer_token_redeem(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.signer_token_redeem(TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- PHASE 4: VERIFY
-- ---------------------------------------------------------------------------

-- 4a. The two rewritten functions behave as their callers now assume.
DO $$
DECLARE
    v_request TEXT;
    v_signer  TEXT;
    v_org     TEXT;
    v_token   TEXT := '_cg015_probe_' || repeat('a', 52);
    v_redeem  RECORD;
    v_revoked INTEGER;
    v_failed  TEXT[] := ARRAY[]::TEXT[];
BEGIN
    SELECT s.id, s.request_id, s.organization_id
      INTO v_signer, v_request, v_org
      FROM public.signature_request_signers s
     LIMIT 1;

    IF v_signer IS NULL THEN
        RAISE NOTICE 'CG-015: no signer rows to probe against; behavioural checks skipped.';
        RETURN;
    END IF;

    INSERT INTO public.signer_access_tokens
        (token_hash, signer_id, request_id, organization_id, purpose, expires_at, max_uses)
    VALUES
        (v_token, v_signer, v_request, v_org, 'view', now() + interval '1 hour', 5);

    -- First redemption reports 1 — the condition the `signer_token_redeemed`
    -- entry is gated on. If this ever returned 0 or NULL the entry would never
    -- fire; if it returned the PRE-increment value it would fire on the second
    -- use instead of the first, which is worse than not firing at all.
    SELECT * INTO v_redeem FROM public.signer_token_redeem(v_token, NULL);
    IF v_redeem.use_count IS DISTINCT FROM 1 THEN
        v_failed := v_failed || format('first redemption reported use_count %s, expected 1', v_redeem.use_count);
    END IF;

    SELECT * INTO v_redeem FROM public.signer_token_redeem(v_token, NULL);
    IF v_redeem.use_count IS DISTINCT FROM 2 THEN
        v_failed := v_failed || format('second redemption reported use_count %s, expected 2', v_redeem.use_count);
    END IF;

    -- Revocation reports a count, and reports 0 the second time rather than
    -- re-counting rows it already revoked — the caller chains an entry only
    -- when the count is non-zero, so a stale count would claim credentials
    -- were killed that were already dead.
    v_revoked := public.signer_token_revoke_for_request(v_request);
    IF v_revoked < 1 THEN
        v_failed := v_failed || format('revoke reported %s, expected at least the probe token', v_revoked);
    END IF;

    IF public.signer_token_revoke_for_request(v_request) <> 0 THEN
        v_failed := v_failed || 'a second revoke reported a non-zero count';
    END IF;

    -- A revoked token is refused, so the probe cannot leave a usable credential
    -- behind even if the DELETE below were to fail.
    IF EXISTS (SELECT 1 FROM public.signer_token_redeem(v_token, NULL)) THEN
        v_failed := v_failed || 'a revoked token was still redeemable';
    END IF;

    DELETE FROM public.signer_access_tokens WHERE token_hash = v_token;

    IF array_length(v_failed, 1) > 0 THEN
        RAISE EXCEPTION 'CG-015: rewritten token routines are wrong — %',
            array_to_string(v_failed, '; ');
    END IF;

    RAISE NOTICE 'CG-015: signer_token_redeem reports use_count and signer_token_revoke_for_request reports its count.';
END $$;

-- 4b. CG-010's whole-schema grant tripwire, re-run because both functions above
--     were CREATEd fresh and therefore re-inherited the schema default grants.
--     Asserted with `has_function_privilege` — the question that matters —
--     rather than by reading `proacl`, which would have passed while the
--     original hole was open.
DO $$
DECLARE
    v_anon_allowed TEXT[] := ARRAY[
        'get_invitation_by_token',
        'is_org_member',
        'is_admin_or_owner',
        'get_organization_role'
    ];
    v_auth_allowed TEXT[] := v_anon_allowed || ARRAY[
        'accept_invitation',
        'create_organization',
        'has_pending_invitation',
        'get_my_member_organizations',
        'signature_mark_viewed',
        'signature_verify_chain_for_member'
    ];
    v_leaks TEXT;
BEGIN
    SELECT string_agg(
               p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
               E'\n  ')
      INTO v_leaks
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND (
             (has_function_privilege('anon', p.oid, 'EXECUTE')          AND NOT (p.proname = ANY(v_anon_allowed)))
          OR (has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT (p.proname = ANY(v_auth_allowed)))
       );

    IF v_leaks IS NOT NULL THEN
        RAISE EXCEPTION E'CG-015: SECURITY DEFINER function(s) reachable by anon/authenticated outside the allowlist:\n  %', v_leaks;
    END IF;

    RAISE NOTICE 'CG-015: SECURITY DEFINER grant surface verified clean.';
END $$;

-- 4c. CG-009's invariant, re-asserted alongside it.
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY(roles);
    IF v_count > 0 THEN
        RAISE EXCEPTION 'CG-015: % RLS policy/policies target anon; expected 0.', v_count;
    END IF;
END $$;
