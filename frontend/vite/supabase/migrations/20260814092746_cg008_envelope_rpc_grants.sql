-- CG-008 — Scope the workflow RPCs that were still granted to PUBLIC.
--
-- CG-005 locked down the routines that MINT or REDEEM credentials, on the
-- reasoning that SECURITY DEFINER says nothing about who may CALL a function and
-- the default grant is EXECUTE to PUBLIC. Two AHR-2100 routines were outside
-- that migration's scope and kept the default. Phase I is the first thing to put
-- either of them behind a UI, so this is where they get the same treatment.
--
--   `signature_verify_chain(request_id)` — reachable by ANON today. It leaks no
--       row contents, but it does answer "does a request with this id exist, and
--       how many events does it have" for any id, in any organization. Ids are
--       random so this is not a practical enumeration route; it is still an
--       endpoint that answers questions about other tenants' data, which is what
--       the project's default-deny posture exists to prevent.
--
--   `signature_mark_viewed(request_id)` — resolves its signer through
--       `auth.uid()`, so an anonymous caller can already change nothing. Revoked
--       anyway: relying on a second mechanism to make a grant harmless is how a
--       grant survives the day that mechanism changes.
--
-- The member-facing verification path becomes a WRAPPER rather than a widened
-- grant. The check has to happen inside a SECURITY DEFINER body — the underlying
-- routine is DEFINER too, so a SECURITY INVOKER wrapper could not call it once
-- the direct grant is gone — and putting the org check in the wrapper keeps
-- `signature_verify_chain` itself a pure, unauthenticated primitive that edge
-- functions and future certificate generation can keep calling as-is.

REVOKE EXECUTE ON FUNCTION public.signature_verify_chain(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signature_verify_chain(TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.signature_mark_viewed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signature_mark_viewed(TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Member-scoped verification
-- ------------------------------------------------------------
-- Returns the same three columns, for a request the caller can already see.
-- An unknown or foreign request id returns NO ROWS rather than `false`:
-- "the chain is broken" and "that is not your document" are different answers,
-- and conflating them would report a healthy envelope as tampered with.

CREATE OR REPLACE FUNCTION public.signature_verify_chain_for_member(p_request_id TEXT)
RETURNS TABLE(chain_intact BOOLEAN, broken_at_seq BIGINT, entries_checked INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_organization_id TEXT;
BEGIN
    SELECT organization_id INTO v_organization_id
      FROM public.signature_requests
     WHERE id = p_request_id;

    IF v_organization_id IS NULL OR NOT public.is_org_member(v_organization_id) THEN
        RETURN;
    END IF;

    RETURN QUERY SELECT * FROM public.signature_verify_chain(p_request_id);
END;
$$;

COMMENT ON FUNCTION public.signature_verify_chain_for_member(TEXT) IS
    'Org-scoped wrapper around signature_verify_chain, for the envelope detail '
    'UI. Returns no rows for a request the caller is not a member of — distinct '
    'from returning chain_intact=false, which would misreport a healthy chain.';

REVOKE EXECUTE ON FUNCTION public.signature_verify_chain_for_member(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signature_verify_chain_for_member(TEXT) TO authenticated, service_role;
