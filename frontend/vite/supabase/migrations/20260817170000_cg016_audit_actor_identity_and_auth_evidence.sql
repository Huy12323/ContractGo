-- ---------------------------------------------------------------------------
-- CG-016 — the audit trail identifies WHO acted, and HOW they proved it
-- ---------------------------------------------------------------------------
-- The trail already answered WHAT happened, WHEN (to the microsecond), and FROM
-- WHERE (`ip`, `user_agent` in the hashed payload). Three things it did not
-- answer, and an eContract trail is required to:
--
--   1. WHO, by name. A sender event carried `actor_user_id` — a UUID — and
--      nothing else. Resolving it to a person meant joining `profiles` at read
--      time, which is precisely what an evidence trail must not do: the join
--      answers who that person is TODAY, not who acted then, and a renamed or
--      deleted profile silently rewrites history. A signer event carried
--      `signer_email` and not even a name. Identity must be SNAPSHOT into the
--      hashed payload at write time, and from CG-016 it is — see
--      `_shared/auditEvidence.ts`, which is the single builder every writer uses.
--
--   2. A PHONE NUMBER. Nowhere in the schema. Two columns are added below, one
--      per kind of performer: `signature_request_signers.signer_phone` for the
--      external party a sender names, `profiles.phone` for the internal one.
--
--   3. AUTHENTICATION STATUS — which verification methods a performer actually
--      used. The vocabulary already exists in `_shared/signing.ts` (`OtpDriver`,
--      `IdentityDriver` for eKYC, `SignatureDriver` for the CA signature); what
--      was missing is the record. Every entry now carries an `auth` block naming
--      the methods used and stating, explicitly, which of OTP and eKYC were NOT
--      performed. An absent key and an unperformed check are different facts and
--      the trail must not conflate them: "we did not record it" is not evidence,
--      "it was not required" is.
--
-- AND `request_updated`, the fourth gap. CG-015 argued no such event was needed
-- because "the chain is the evidence trail of what happened to a document that
-- parties were asked to sign, and nobody has been asked anything yet". That is
-- true of the ceremony and false of the requirement: EDITING is an action on the
-- document, a draft is edited by a named colleague at a recorded time, and a
-- trail that starts at `request_sent` cannot show who changed the terms between
-- creation and sending. The enum gains the value; `envelopes_draft_update`
-- writes it.
--
-- WHY EVERYTHING GOES IN `payload` AND NOT IN NEW COLUMNS. The chain hashes
-- `(prev_hash, request_id, seq, event_type, signer_id, actor_user_id, payload,
-- occurred_at)`. Evidence outside that tuple can be edited without breaking a
-- single hash — so a `actor_phone` column would be a phone number nobody can
-- prove. The payload is inside it. This is the same reasoning that put `ip` and
-- `user_agent` there.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- PHASE 1: `request_updated`
-- ---------------------------------------------------------------------------
-- NOT USED anywhere below, and cannot be: PostgreSQL forbids an enum value
-- added in a transaction from being referenced in that same transaction. PHASE 5
-- therefore asserts it through `pg_enum` by name, which is a catalogue read
-- rather than a use.

ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'request_updated';

-- ---------------------------------------------------------------------------
-- PHASE 2: A PHONE NUMBER FOR THE EXTERNAL PERFORMER
-- ---------------------------------------------------------------------------
-- Nullable, and permanently so. A phone number is an identification aid, not a
-- routing requirement: the ceremony runs on the emailed link, and making this
-- NOT NULL would refuse to send documents to parties whose number the sender
-- does not have. What the trail must not do is claim a number it was never
-- given, which NULL says exactly.
--
-- Not validated to a format either. E.164 would be the right shape for an SMS
-- OTP to dial, and when the OTP driver lands (v1.2) it is the driver's business
-- to normalize and to refuse what it cannot dial. Rejecting `+84 (0)90 123` at
-- the schema today would block a sender from recording the only number they
-- have, for the benefit of a feature that does not exist.

ALTER TABLE public.signature_request_signers
    ADD COLUMN IF NOT EXISTS signer_phone TEXT;

COMMENT ON COLUMN public.signature_request_signers.signer_phone IS
    'Phone number of this recipient as the sender recorded it. Identification '
    'evidence (CG-016): snapshot into every audit payload this person is the '
    'actor of. Nullable — a sender may not have it — and unvalidated, because '
    'normalization belongs to the OTP driver that will dial it (v1.2), not to '
    'a constraint that would refuse the only number the sender has.';

-- ---------------------------------------------------------------------------
-- PHASE 3: A PHONE NUMBER FOR THE INTERNAL PERFORMER
-- ---------------------------------------------------------------------------
-- `auth.users.phone` exists and is the authoritative number for a user who
-- signed up or enrolled MFA with one. It is not sufficient on its own: almost
-- every ContractGo user is email-only, so that column is empty for them, and a
-- trail that can only name a phone for SMS-enrolled users records nothing for
-- the senders who actually send documents. `profiles.phone` is the number the
-- person can supply in settings.
--
-- Backfilled from `auth.users.phone` so the authoritative value wins where it
-- exists, and `handle_new_user` is rewritten to carry both it and a metadata
-- phone from signup. The resolver in `_shared/auditEvidence.ts` reads
-- `profiles.phone` first and falls back to `auth.users.phone`, so neither source
-- can go missing from the record.
--
-- PRIVACY NOTE, stated because this column is more exposed than it looks. The
-- pre-existing SELECT policy on `profiles` is `to authenticated using (true)` —
-- every authenticated user of every organization can read every profile row. So
-- this phone number is org-wide-readable at minimum. That is inherited, not
-- introduced, and it is not tightened here because narrowing an existing
-- read policy is a change with its own blast radius (the sender-resolution paths
-- in `envelopeNotify` read profiles) and belongs in its own migration. Recorded
-- here so the exposure is a known decision rather than a discovery.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN public.profiles.phone IS
    'Contact phone for this user. Identification evidence (CG-016): snapshot '
    'into every audit payload they are the actor of, read in preference to '
    'auth.users.phone, which is only populated for phone/MFA signups.';

UPDATE public.profiles p
   SET phone = u.phone
  FROM auth.users u
 WHERE u.id = p.id
   AND p.phone IS NULL
   AND u.phone IS NOT NULL
   AND u.phone <> '';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, phone)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    -- The verified column wins over the metadata the client sent, and both are
    -- normalized to NULL rather than '' — `auth.users.phone` is '' for the
    -- email-only signups that are the norm here, and an empty string in an
    -- evidence payload reads as "recorded as blank" instead of "not recorded".
    nullif(coalesce(nullif(new.phone, ''), new.raw_user_meta_data ->> 'phone'), '')
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- PHASE 4: THE SINGLE WRITER GUARANTEES THE SHAPE
-- ---------------------------------------------------------------------------
-- `signature_audit_append` is the only thing that may insert into the log, so it
-- is the only place a "every entry carries identity, address and authentication
-- status" guarantee can be made true of ALL rows rather than of the rows whose
-- caller remembered.
--
-- IT NORMALIZES, IT DOES NOT REJECT. A missing `actor` block means a caller was
-- written wrong; raising would turn that into a LOST ENTRY, because every writer
-- deliberately swallows audit failures so a failed log cannot roll back a
-- signature that already happened. A gap in the trail is far worse than an entry
-- that says `{"kind": "unrecorded"}` — the second is honest and greppable, the
-- first is invisible. The WARNING is how it gets fixed.
--
-- The five keys are filled with JSON nulls when absent, so a reader may rely on
-- their presence in every row from here on. Historical rows are untouched and
-- must not be: rewriting a payload would change its hash and break the chain,
-- which is the trail's entire value proposition. The UI reads them defensively
-- for exactly that reason.
--
-- Normalization happens BEFORE the hash, so what is hashed is what is stored.

CREATE OR REPLACE FUNCTION public.signature_audit_append(
    p_request_id TEXT,
    p_organization_id TEXT,
    p_signer_id TEXT,
    p_actor_user_id UUID,
    p_event_type TEXT,
    p_payload JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_seq       BIGINT;
    v_prev_hash TEXT;
    v_hash      TEXT;
    v_occurred  TIMESTAMPTZ := clock_timestamp();
    v_payload   JSONB := COALESCE(p_payload, '{}'::jsonb);
    v_id        TEXT;
BEGIN
    IF NOT (v_payload ? 'actor') THEN
        RAISE WARNING 'signature_audit_append: % on % carries no actor identity; recording it as unrecorded. Fix the caller — every entry must name its performer (CG-016).',
            p_event_type, p_request_id;
        v_payload := v_payload || jsonb_build_object(
            'actor',
            jsonb_build_object(
                'kind', 'unrecorded',
                'user_id', p_actor_user_id,
                'signer_id', p_signer_id,
                'name', NULL,
                'email', NULL,
                'phone', NULL
            )
        );
    END IF;

    -- `auth` says which verification methods were used. An entry without it is
    -- not evidence of "no verification" — it is evidence of nothing — so the
    -- placeholder says which of the two it is.
    IF NOT (v_payload ? 'auth') THEN
        v_payload := v_payload || jsonb_build_object(
            'auth', jsonb_build_object('methods', '[]'::jsonb, 'recorded', FALSE)
        );
    END IF;

    -- Technical evidence. NULL is a real answer for a `system` actor: a cron
    -- tick has no client address, and inventing the server's would be a
    -- fabricated fact in an evidence trail.
    IF NOT (v_payload ? 'ip')         THEN v_payload := v_payload || jsonb_build_object('ip', NULL); END IF;
    IF NOT (v_payload ? 'user_agent') THEN v_payload := v_payload || jsonb_build_object('user_agent', NULL); END IF;

    SELECT seq, entry_hash
      INTO v_seq, v_prev_hash
      FROM public.signature_audit_log
     WHERE request_id = p_request_id
     ORDER BY seq DESC
     LIMIT 1
       FOR UPDATE;

    v_seq := COALESCE(v_seq, 0) + 1;

    v_hash := public.signature_audit_entry_hash(
        v_prev_hash, p_request_id, v_seq, p_event_type,
        p_signer_id, p_actor_user_id, v_payload, v_occurred
    );

    INSERT INTO public.signature_audit_log (
        request_id, organization_id, signer_id, actor_user_id,
        event_type, payload, seq, prev_hash, entry_hash, occurred_at
    ) VALUES (
        p_request_id, p_organization_id, p_signer_id, p_actor_user_id,
        p_event_type::public.signature_audit_log_event_type_enum,
        v_payload, v_seq, v_prev_hash, v_hash, v_occurred
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.signature_audit_append(TEXT, TEXT, TEXT, UUID, TEXT, JSONB) IS
    'The only writer of signature_audit_log. Since CG-016 it also guarantees '
    'the evidentiary SHAPE of every row: `actor` (who, by name/email/phone), '
    '`auth` (which verification methods were used), `ip` and `user_agent` are '
    'present in every payload, normalized before hashing. Missing identity is '
    'recorded as {"kind":"unrecorded"} with a WARNING rather than rejected — a '
    'rejected entry would be a hole in the trail, which is strictly worse.';

-- CREATE OR REPLACE preserves the existing ACL (it is not a fresh CREATE), but
-- these are re-stated because CG-010 and CG-015 both learned that assuming the
-- grant surface is unchanged is how it changes.
REVOKE EXECUTE ON FUNCTION public.signature_audit_append(TEXT, TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.signature_audit_append(TEXT, TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- PHASE 5: VERIFY
-- ---------------------------------------------------------------------------

-- 5a. The schema additions landed.
DO $$
DECLARE
    v_failed TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- By NAME through the catalogue, not by casting the literal: this
    -- transaction added the value and PostgreSQL forbids using it here.
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'signature_audit_log_event_type_enum'
           AND e.enumlabel = 'request_updated'
    ) THEN
        v_failed := v_failed || 'signature_audit_log_event_type_enum lacks request_updated';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'signature_request_signers'
           AND column_name = 'signer_phone'
    ) THEN
        v_failed := v_failed || 'signature_request_signers.signer_phone missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'profiles'
           AND column_name = 'phone'
    ) THEN
        v_failed := v_failed || 'profiles.phone missing';
    END IF;

    IF array_length(v_failed, 1) > 0 THEN
        RAISE EXCEPTION 'CG-016: schema additions incomplete — %', array_to_string(v_failed, '; ');
    END IF;
END $$;

-- 5b. The writer's guarantee holds, and holds without breaking the chain.
--     Probed against a real request rather than asserted, because the failure
--     mode being ruled out is "normalization changed the payload after it was
--     hashed", which only a verify pass over written rows can detect.
DO $$
DECLARE
    v_request TEXT;
    v_org     TEXT;
    v_signer  TEXT;
    v_id      TEXT;
    v_payload JSONB;
    v_intact  BOOLEAN;
    v_failed  TEXT[] := ARRAY[]::TEXT[];
BEGIN
    SELECT s.request_id, s.organization_id, s.id
      INTO v_request, v_org, v_signer
      FROM public.signature_request_signers s
     LIMIT 1;

    IF v_request IS NULL THEN
        RAISE NOTICE 'CG-016: no envelope rows to probe against; writer checks skipped.';
        RETURN;
    END IF;

    -- A caller that forgot everything. `integrity_verified` is used as the probe
    -- event because it asserts nothing about the document's state — it cannot be
    -- mistaken later for a real transition the way a `signer_signed` probe could.
    v_id := public.signature_audit_append(
        v_request, v_org, v_signer, NULL, 'integrity_verified',
        jsonb_build_object('probe', 'cg016')
    );

    SELECT payload INTO v_payload FROM public.signature_audit_log WHERE id = v_id;

    IF v_payload -> 'actor' ->> 'kind' IS DISTINCT FROM 'unrecorded' THEN
        v_failed := v_failed || 'a payload with no actor was not normalized';
    END IF;
    IF NOT (v_payload ? 'auth' AND v_payload ? 'ip' AND v_payload ? 'user_agent') THEN
        v_failed := v_failed || 'auth/ip/user_agent keys were not filled';
    END IF;
    IF (v_payload -> 'auth' ->> 'recorded')::boolean IS DISTINCT FROM FALSE THEN
        v_failed := v_failed || 'an unrecorded auth block did not say so';
    END IF;

    -- Supplied blocks are passed through untouched: normalization must not
    -- overwrite what a caller actually observed.
    v_id := public.signature_audit_append(
        v_request, v_org, v_signer, NULL, 'integrity_verified',
        jsonb_build_object(
            'actor', jsonb_build_object('kind', 'signer', 'name', 'Probe', 'email', 'p@example.test', 'phone', '+84900000000'),
            'auth',  jsonb_build_object('methods', jsonb_build_array('email_link'), 'recorded', TRUE),
            'ip', '203.0.113.9', 'user_agent', 'cg016-probe'
        )
    );
    SELECT payload INTO v_payload FROM public.signature_audit_log WHERE id = v_id;
    IF v_payload -> 'actor' ->> 'phone' IS DISTINCT FROM '+84900000000'
       OR v_payload ->> 'ip' IS DISTINCT FROM '203.0.113.9' THEN
        v_failed := v_failed || 'a supplied identity block was altered';
    END IF;

    -- The point of the whole exercise: what was hashed is what was stored.
    SELECT chain_intact INTO v_intact FROM public.signature_verify_chain(v_request);
    IF v_intact IS DISTINCT FROM TRUE THEN
        v_failed := v_failed || 'the chain does not verify after normalized appends';
    END IF;

    -- The probe rows are removed. The append-only guard is a BEFORE UPDATE
    -- trigger only — AHR-2100 deliberately left DELETE to the organization
    -- cascade — so this succeeds, and it is the reason the probe writes rather
    -- than rewrites. Removing them matters: leaving two `integrity_verified`
    -- entries on a real envelope would put migration artefacts in someone's
    -- evidence. They are the newest entries, so the chain re-seals at the tail.
    DELETE FROM public.signature_audit_log
     WHERE request_id = v_request
       AND (payload ->> 'probe' = 'cg016' OR payload -> 'actor' ->> 'name' = 'Probe');

    IF array_length(v_failed, 1) > 0 THEN
        RAISE EXCEPTION 'CG-016: the audit writer does not guarantee its shape — %',
            array_to_string(v_failed, '; ');
    END IF;

    RAISE NOTICE 'CG-016: every appended entry now carries actor identity, auth status, ip and user_agent, inside the hash.';
END $$;

-- 5c. CG-010's grant tripwire, for the function replaced above.
DO $$
BEGIN
    IF has_function_privilege('anon', 'public.signature_audit_append(TEXT, TEXT, TEXT, UUID, TEXT, JSONB)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.signature_audit_append(TEXT, TEXT, TEXT, UUID, TEXT, JSONB)', 'EXECUTE') THEN
        RAISE EXCEPTION 'CG-016: signature_audit_append is reachable by anon/authenticated.';
    END IF;
END $$;
