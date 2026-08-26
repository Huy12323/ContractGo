-- ===========================================================================
-- CG-047 — EMBEDDED SIGNING: THE ORIGIN A SIGNING SESSION MAY SPEAK TO
-- ===========================================================================
--
-- v1.4.0 Phase E. One nullable column and one new issue routine. Nothing
-- existing changes shape: `signer_token_issue`, `signer_token_redeem`,
-- `signer_token_consume` and `signer_token_revoke_for_*` are untouched.
--
-- WHAT AN EMBED TOKEN IS. `api_envelopes_embed-url` mints an ordinary
-- `purpose='sign'` credential for a named signer and hands the URL back to the
-- integrator instead of mailing it. The signing page then renders inside an
-- iframe on the integrator's own site and reports progress to the host page by
-- `postMessage`. `postMessage` requires a `targetOrigin`, and the whole security
-- value of the feature rests on that value never being `'*'` and never being
-- chosen by the frame's contents. So it is decided when the token is MINTED, by
-- a caller that has already proved it holds the organization's API key, and
-- stamped on the credential itself.
--
-- WHY THE ORIGIN LIVES ON THE TOKEN AND NOT ON THE REQUEST OR THE KEY.
-- The key carries the ALLOWLIST — the set of origins its owner registered. The
-- token carries the ONE origin this session may speak to, chosen from that list
-- at mint time. A signing page reads its own token, so it can learn its target
-- origin without being told by the page framing it. If the origin were read from
-- the key at render time, a key registering three origins would let any of the
-- three receive any session's events; if it were read from the request, the
-- frame's host would be choosing where its own events go, which is not a check
-- at all.
--
-- ⚠ WHY THIS IS A NEW FUNCTION AND NOT A PARAMETER ON `signer_token_issue`.
-- That function REVOKES every live token for the same signer and purpose before
-- minting, which is exactly right for its callers: a resend must invalidate the
-- older link rather than leave two live credentials in two mailboxes. It is
-- exactly wrong here. An integrator asking for an embed URL would silently kill
-- the emailed link the counterparty is holding — so a signer who had the mail
-- open in another tab would find their link dead, with nothing anywhere saying
-- why. The two credentials answer different questions ("the link I mailed you"
-- and "the pane on my website") and both may legitimately be live at once, so
-- this routine mints WITHOUT revoking and says so in its comment.
--
-- The cost of that choice, stated rather than glossed: an integrator can
-- accumulate live embed credentials for one signer by calling repeatedly. It is
-- bounded on both axes instead — a hard TTL ceiling of one hour and
-- `max_uses = 3` — so what accumulates is a set of short-lived, use-capped
-- credentials for a signer who is already entitled to sign, rather than an
-- unbounded set of fortnight-long ones.
--
-- STANDING RULES OBSERVED: named-role REVOKE (CG-010 — a bare `FROM PUBLIC` is
-- inert on this schema), `has_function_privilege` for the assertion rather than
-- reading `proacl`, and the probe skips with a NOTICE rather than failing when
-- the database carries no seeded signer.

-- ---------------------------------------------------------------------------
-- PHASE 1: THE COLUMN
-- ---------------------------------------------------------------------------

ALTER TABLE public.signer_access_tokens
    ADD COLUMN embed_origin TEXT;

COMMENT ON COLUMN public.signer_access_tokens.embed_origin IS
    'The single origin this session may postMessage to (CG-047), chosen at mint '
    'time from the API key''s allowlist. NULL for every emailed credential, '
    'which is every token issued before v1.4.0 and every one issued by '
    'envelopes_send / _resend / _remind since — and NULL is what makes the '
    'embed bridge emit NOTHING AT ALL rather than fall back to a wildcard. An '
    'absent origin is silence, never ''*''.';

-- ---------------------------------------------------------------------------
-- PHASE 2: THE ISSUE ROUTINE
-- ---------------------------------------------------------------------------
-- Mirrors `signer_token_issue`'s token generation byte for byte — 32 CSPRNG
-- bytes, base64url, sha256 stored — so an embed credential is indistinguishable
-- from an emailed one at rest, and `signer_token_redeem` needs no branch for it.
--
-- THE CEILINGS ARE ENFORCED HERE AND NOT ONLY IN TYPESCRIPT. The edge function
-- clamps too, and the duplication is deliberate: this function is SECURITY
-- DEFINER and reachable by service_role, so it must not depend on its only
-- current caller having done the arithmetic correctly.

CREATE FUNCTION public.signer_token_issue_embed(
    p_signer_id    TEXT,
    p_origin       TEXT,
    p_ttl_seconds  INTEGER DEFAULT 900,
    p_max_uses     INTEGER DEFAULT 3
)
RETURNS TABLE(token TEXT, token_id TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_request_id TEXT;
    v_token      TEXT;
    v_hash       TEXT;
    v_ttl        INTEGER;
    v_uses       INTEGER;
    v_expires    TIMESTAMPTZ;
    v_id         TEXT;
BEGIN
    -- An embed credential with no origin is a credential whose signing page can
    -- report to nobody: the bridge would stay silent and the integrator would
    -- see a pane that works and an event stream that never starts. Refused here
    -- rather than stored, so the failure names itself.
    IF p_origin IS NULL OR btrim(p_origin) = '' THEN
        RAISE EXCEPTION 'signer_token_issue_embed: an embed token requires an origin';
    END IF;

    SELECT request_id INTO v_request_id
      FROM public.signature_request_signers
     WHERE id = p_signer_id;

    IF v_request_id IS NULL THEN
        RAISE EXCEPTION 'signer_token_issue_embed: unknown signer_id %', p_signer_id;
    END IF;

    -- Clamped, not rejected. A caller asking for a day gets an hour and a
    -- working integration; a 400 for a number that is merely optimistic would
    -- fail the send over a preference.
    v_ttl  := least(greatest(COALESCE(p_ttl_seconds, 900), 60), 3600);
    v_uses := least(greatest(COALESCE(p_max_uses, 3), 1), 10);
    v_expires := now() + make_interval(secs => v_ttl);

    -- DELIBERATELY NO REVOCATION OF EXISTING TOKENS. See the file header: the
    -- emailed link and the embedded pane are two live routes to the same
    -- signature and killing one to open the other would break a counterparty's
    -- mail with no explanation anywhere. Do not "align" this with
    -- `signer_token_issue` later.
    v_token := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');
    v_hash  := encode(digest(v_token, 'sha256'), 'hex');

    INSERT INTO public.signer_access_tokens
        (signer_id, request_id, token_hash, purpose, expires_at, max_uses, embed_origin)
    VALUES
        (p_signer_id, v_request_id, v_hash, 'sign', v_expires, v_uses, btrim(p_origin))
    RETURNING id INTO v_id;

    RETURN QUERY SELECT v_token, v_id, v_expires;
END;
$$;

COMMENT ON FUNCTION public.signer_token_issue_embed(TEXT, TEXT, INTEGER, INTEGER) IS
    'Mints a short-lived, use-capped, origin-pinned signing credential for '
    'embedded signing (CG-047). Unlike signer_token_issue it does NOT revoke the '
    'signer''s existing links — an integrator opening an embedded pane must not '
    'kill the link already sitting in the counterparty''s mailbox. TTL is clamped '
    'to [60s, 1h] and uses to [1, 10] IN THIS FUNCTION, not only in its caller.';

REVOKE EXECUTE ON FUNCTION public.signer_token_issue_embed(TEXT, TEXT, INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.signer_token_issue_embed(TEXT, TEXT, INTEGER, INTEGER)
    TO service_role;

-- ---------------------------------------------------------------------------
-- PHASE 3: VERIFY
-- ---------------------------------------------------------------------------

-- 3a. Behaviour. The load-bearing assertion is the LAST one: an embed mint must
--     leave a pre-existing emailed credential alive. Everything else here is
--     ordinary bounds checking; that one is the property the design chose over
--     symmetry with `signer_token_issue`, and the one a future "tidy" would
--     silently reverse.
DO $$
DECLARE
    v_signer     TEXT;
    v_request    TEXT;
    v_org        TEXT;
    v_mail_hash  TEXT := '_cg047_mailed_' || repeat('b', 50);
    v_issued     RECORD;
    v_row        RECORD;
    v_failed     TEXT[] := ARRAY[]::TEXT[];
BEGIN
    SELECT s.id, s.request_id, s.organization_id
      INTO v_signer, v_request, v_org
      FROM public.signature_request_signers s
     LIMIT 1;

    IF v_signer IS NULL THEN
        RAISE NOTICE 'CG-047: no signer rows to probe against; behavioural checks skipped.';
        RETURN;
    END IF;

    -- Stand in for the link that was emailed to the counterparty.
    INSERT INTO public.signer_access_tokens
        (token_hash, signer_id, request_id, organization_id, purpose, expires_at, max_uses)
    VALUES
        (v_mail_hash, v_signer, v_request, v_org, 'sign', now() + interval '14 days', 100);

    SELECT * INTO v_issued
      FROM public.signer_token_issue_embed(v_signer, 'https://app.example.com', 900, 3);

    SELECT * INTO v_row
      FROM public.signer_access_tokens WHERE id = v_issued.token_id;

    IF v_row.embed_origin IS DISTINCT FROM 'https://app.example.com' THEN
        v_failed := v_failed || format('embed_origin was %L, expected the minted origin', v_row.embed_origin);
    END IF;
    IF v_row.max_uses <> 3 THEN
        v_failed := v_failed || format('max_uses was %s, expected 3', v_row.max_uses);
    END IF;
    IF v_row.purpose <> 'sign' THEN
        v_failed := v_failed || format('purpose was %s, expected sign', v_row.purpose);
    END IF;
    IF v_row.expires_at > now() + interval '16 minutes' THEN
        v_failed := v_failed || 'a 900-second token outlived its TTL';
    END IF;
    -- The credential is real: it redeems like any other, with no branch anywhere
    -- in `signer_token_redeem` for the fact that it was never emailed.
    IF NOT EXISTS (SELECT 1 FROM public.signer_token_redeem(encode(digest(v_issued.token, 'sha256'), 'hex'), NULL)) THEN
        v_failed := v_failed || 'a freshly minted embed token was not redeemable';
    END IF;

    -- The TTL ceiling holds against a caller asking for a week.
    SELECT * INTO v_issued
      FROM public.signer_token_issue_embed(v_signer, 'https://app.example.com', 604800, 3);
    SELECT * INTO v_row FROM public.signer_access_tokens WHERE id = v_issued.token_id;
    IF v_row.expires_at > now() + interval '61 minutes' THEN
        v_failed := v_failed || 'the one-hour TTL ceiling did not hold';
    END IF;

    -- An origin-less embed token is refused rather than stored.
    BEGIN
        PERFORM public.signer_token_issue_embed(v_signer, '   ', 900, 3);
        v_failed := v_failed || 'a blank origin was accepted';
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- ⚠ THE ASSERTION THIS MIGRATION EXISTS FOR.
    IF NOT EXISTS (
        SELECT 1 FROM public.signer_access_tokens
         WHERE token_hash = v_mail_hash AND revoked_at IS NULL
    ) THEN
        v_failed := v_failed
            || 'minting an embed token REVOKED the signer''s emailed link — see the file header';
    END IF;

    DELETE FROM public.signer_access_tokens
     WHERE token_hash = v_mail_hash OR embed_origin IS NOT NULL;

    IF array_length(v_failed, 1) > 0 THEN
        RAISE EXCEPTION 'CG-047: embed token issuance is wrong — %',
            array_to_string(v_failed, '; ');
    END IF;

    RAISE NOTICE 'CG-047: embed tokens are origin-pinned, TTL-capped, redeemable, and leave emailed links alive.';
END $$;

-- 3b. CG-010's grant tripwire, scoped to the function this file CREATEs — a
--     fresh CREATE re-inherits Supabase's pg_default_acl, which grants EXECUTE
--     to anon and authenticated EXPLICITLY. Asked with `has_function_privilege`,
--     which is the question that matters; reading `proacl` would have passed
--     while the original hole was wide open.
DO $$
DECLARE
    v_leaks TEXT;
BEGIN
    SELECT string_agg(format('%s → %s', p.proname, r.rolname), ', ')
      INTO v_leaks
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
     WHERE n.nspname = 'public'
       AND p.proname = 'signer_token_issue_embed'
       AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');

    IF v_leaks IS NOT NULL THEN
        RAISE EXCEPTION 'CG-047: a client role can execute an embed token minter — %', v_leaks;
    END IF;

    RAISE NOTICE 'CG-047: signer_token_issue_embed is service_role only.';
END $$;

-- 3c. Additive safety. Every credential that existed before this migration has a
--     NULL origin, which the bridge reads as "emit nothing" — so no page that
--     was working yesterday starts speaking to anybody today.
DO $$
DECLARE
    v_stamped INTEGER;
BEGIN
    SELECT count(*) INTO v_stamped
      FROM public.signer_access_tokens WHERE embed_origin IS NOT NULL;

    IF v_stamped <> 0 THEN
        RAISE EXCEPTION 'CG-047: % pre-existing tokens carry an embed origin; they must all be NULL', v_stamped;
    END IF;

    RAISE NOTICE 'CG-047: every pre-existing credential has a NULL embed_origin.';
END $$;
