-- ============================================
-- CG-010 — Lock down SECURITY DEFINER grants (v1.1.0 Phase A)
-- ============================================
--
-- CRITICAL SECURITY FIX. Before this migration, a caller holding nothing but
-- the public `anon` key could execute:
--
--     POST /rest/v1/rpc/signer_token_issue  {"p_signer_id": "sgs_..."}
--
-- and receive a live plaintext signing token in the response. That token is the
-- entire credential the external-signer surface is built on: it opens
-- `signing_session_open` and it submits `signing_submit`. Anyone who learned a
-- signer id could therefore SIGN A DOCUMENT AS THAT PERSON. `signer_token_issue`
-- additionally revokes the signer's prior live tokens, so the same call also
-- denied service to the legitimate signer. Verified exploitable end to end
-- against the local stack before writing this.
--
-- ---------------------------------------------------------------------------
-- WHY THE EXISTING LOCKDOWNS DID NOT WORK
-- ---------------------------------------------------------------------------
-- CG-005 and CG-008 both intended to close exactly this. Both wrote:
--
--     REVOKE EXECUTE ON FUNCTION public.signer_token_issue(...) FROM PUBLIC;
--     GRANT  EXECUTE ON FUNCTION public.signer_token_issue(...) TO service_role;
--
-- and both were no-ops for the roles that matter. Supabase ships default
-- privileges on this schema:
--
--     pg_default_acl (schema public, grantor supabase_admin AND postgres):
--         postgres=X, anon=X, authenticated=X, service_role=X
--
-- so every newly created function in `public` is born with EXPLICIT EXECUTE
-- grants to `anon` and `authenticated`. Revoking from PUBLIC removes only the
-- implicit world grant — a bit these functions never relied on. The explicit
-- grants survived untouched, and `has_function_privilege('anon', ...)` stayed
-- true while `proacl` no longer showed a PUBLIC entry, which is precisely why
-- reading the ACL looked like the fix had landed.
--
-- Two consequences drive the shape of this file:
--   1. Every REVOKE below names `anon` and `authenticated` explicitly. Never
--      write a bare `FROM PUBLIC` on this schema again and expect it to secure
--      anything.
--   2. The verify block at the end asserts with `has_function_privilege`, the
--      question that actually matters, rather than inspecting `proacl` for a
--      PUBLIC entry — the check that would have passed while the hole was open.
--
-- Note that `signature_claim_turn`, `signature_release_turn` and
-- `signature_audit_append` were ALREADY unreachable by anon/authenticated:
-- they predate the default-privilege grants (CREATE OR REPLACE preserves an
-- existing ACL and does not re-apply defaults). They are re-asserted below so
-- the guarantee is stated rather than inherited by accident.

-- ---------------------------------------------------------------------------
-- PHASE 1: DROP TWO ORPHANS THE HR STRIP LEFT BEHIND
-- ---------------------------------------------------------------------------
-- `get_or_create_day` INSERTs into `public.days`, dropped in CG-003.
-- `set_day_id_for_session` has no trigger referencing it. Both were missed by
-- CG-004 and CG-009 and both were anon-executable. `db lint` cannot see the
-- second one — it names no dropped object in its body, the same blind spot that
-- hid `notify_dynamic_table_change` until CG-009's dry run.

DROP FUNCTION IF EXISTS public.get_or_create_day(DATE, TEXT);
DROP FUNCTION IF EXISTS public.set_day_id_for_session();

-- ---------------------------------------------------------------------------
-- PHASE 2: SERVICE-ROLE-ONLY — signer credentials and audit internals
-- ---------------------------------------------------------------------------
-- These are secrets and state machines, reachable only through edge functions
-- running under the service role. No client of any kind may call them.

REVOKE EXECUTE ON FUNCTION public.signer_token_issue(TEXT, TEXT, INTEGER)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signer_token_redeem(TEXT, TEXT)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signer_token_consume(TEXT)                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signer_token_revoke_for_request(TEXT)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signature_mark_viewed_by_signer(TEXT)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signature_verify_chain(TEXT)                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signature_audit_append(TEXT, TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signature_claim_turn(TEXT, TEXT)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signature_release_turn(TEXT, TEXT)           FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.signer_token_issue(TEXT, TEXT, INTEGER)       TO service_role;
GRANT EXECUTE ON FUNCTION public.signer_token_redeem(TEXT, TEXT)               TO service_role;
GRANT EXECUTE ON FUNCTION public.signer_token_consume(TEXT)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.signer_token_revoke_for_request(TEXT)         TO service_role;
GRANT EXECUTE ON FUNCTION public.signature_mark_viewed_by_signer(TEXT)         TO service_role;
GRANT EXECUTE ON FUNCTION public.signature_verify_chain(TEXT)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.signature_audit_append(TEXT, TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.signature_claim_turn(TEXT, TEXT)              TO service_role;
GRANT EXECUTE ON FUNCTION public.signature_release_turn(TEXT, TEXT)            TO service_role;

-- ---------------------------------------------------------------------------
-- PHASE 3: SERVICE-ROLE-ONLY — maintenance jobs and trigger functions
-- ---------------------------------------------------------------------------
-- Trigger functions are invoked by the executor as part of the table operation;
-- EXECUTE is checked when the trigger is CREATED, not when it fires, so
-- revoking here does not disturb any trigger. Direct callability, by contrast,
-- lets a client drive a SECURITY DEFINER body outside the statement it was
-- written to serve.

REVOKE EXECUTE ON FUNCTION public.clean_old_realtime_events()                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_auth_tokens()                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_organization_id_for_change(TEXT, JSONB)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_organization_of_table_change()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_org_id_from_entity()                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_org_id_from_signature_request()               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signature_captures_guard()                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.write_contract_template_version()                 FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.clean_old_realtime_events()                        TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_auth_tokens()                      TO service_role;
GRANT EXECUTE ON FUNCTION public.get_organization_id_for_change(TEXT, JSONB)        TO service_role;

-- ---------------------------------------------------------------------------
-- PHASE 4: AUTHENTICATED-ONLY — drop `anon` from signed-in surfaces
-- ---------------------------------------------------------------------------
-- Each of these requires an `auth.uid()` to mean anything. Leaving them open to
-- `anon` granted nothing useful and widened the surface for free.

REVOKE EXECUTE ON FUNCTION public.accept_invitation(TEXT)                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_organization(TEXT)                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_pending_invitation(TEXT)               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_member_organizations()              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.signature_mark_viewed(TEXT)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.signature_verify_chain_for_member(TEXT)    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_organization(TEXT)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_pending_invitation(TEXT)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_member_organizations()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.signature_mark_viewed(TEXT)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.signature_verify_chain_for_member(TEXT)     TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PHASE 5: DELIBERATELY LEFT REACHABLE BY `anon`
-- ---------------------------------------------------------------------------
-- `get_invitation_by_token` — a logged-out user following an invite link must
--   render the invitation before they have a session (`Page_Invitation.tsx:45`).
--   The token IS the authorization; that is the same trade the signer surface
--   makes, and the function returns only what the invite already told them.
--
-- `is_org_member` / `is_admin_or_owner` / `get_organization_role` — invoked
--   from inside RLS policies, which evaluate them as the CALLING role, so
--   revoking would break the policies themselves. One surviving policy on
--   `members` is granted to `public` (which includes `anon`) and calls
--   `is_admin_or_owner`. All three return false/NULL when `auth.uid()` is NULL,
--   so an anon caller learns nothing.
--
-- No statement is needed for these; they are named so the omission reads as a
-- decision rather than an oversight, and so the verify block's allowlist below
-- has a stated rationale.

-- ---------------------------------------------------------------------------
-- PHASE 6: VERIFY — the tripwire this file exists to install
-- ---------------------------------------------------------------------------
-- Fails the migration if ANY SECURITY DEFINER function in `public` is
-- executable by `anon` or `authenticated` outside the allowlist. Because
-- Supabase's default privileges grant EXECUTE to both roles on every new
-- function, the safe state is not the default — a future migration that adds a
-- SECURITY DEFINER function gets it wide open unless it says otherwise, and
-- this block is what forces that to be a conscious act.

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
               p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' ||
               CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'anon ' ELSE '' END ||
               CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'authenticated' ELSE '' END,
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
        RAISE EXCEPTION E'CG-010: SECURITY DEFINER function(s) reachable by anon/authenticated outside the allowlist:\n  %', v_leaks;
    END IF;

    RAISE NOTICE 'CG-010: SECURITY DEFINER grant surface verified clean.';
END $$;

-- Re-assert CG-009's invariant while we are here: no RLS policy may target anon.
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY(roles);
    IF v_count > 0 THEN
        RAISE EXCEPTION 'CG-010: % RLS policy/policies target anon; expected 0.', v_count;
    END IF;
END $$;
