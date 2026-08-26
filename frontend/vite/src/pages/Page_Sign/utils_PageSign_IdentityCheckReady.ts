import type { Signing_Session } from "@/hooks/useQ_Signing_Session";

/**
 * [ekyc] May this signer commit, as far as the identity arm is concerned? —
 * CG-033.
 *
 * `undefined` IS `true`, AND THAT IS THE WHOLE ADDITIVE-SAFETY CLAIM ON THE
 * CLIENT. `signing_session_open` omits `identity_check` entirely whenever no
 * check is required — which is every document that predates CG-033 — so an
 * absent block means "this arm does not apply", never "we could not tell". A
 * browser holding a page from before this shipped reads `undefined` too, and
 * gets exactly the ceremony it has always had.
 *
 * ITS OWN FILE RATHER THAN AN INLINE EXPRESSION, for two reasons that both
 * matter: it can be unit-tested without rendering `PageSign_SignStep` (this
 * project has no component tests and `docs/testing.md` says why), and removing
 * eKYC is an `rm` plus one line instead of untangling a boolean from a
 * `canSubmit` chain.
 *
 * ADVISORY ONLY. `assertSignerIdentity` re-checks at the commit; this exists so
 * the page does not offer a button the server is about to refuse.
 */
export const utils_PageSign_IdentityCheckReady = (
    check: Signing_Session["identity_check"]
): boolean => !check?.required || check.satisfied === true;
