/**
 * The org-level default signer authentication picker.
 *
 * A RE-EXPORT, not a second options file. `bible-supabase-options` says a shared
 * enum gets one options module and every surface imports it — and this is the
 * same `signature_requests_signer_auth_enum` the composer offers, choosing the
 * same thing one level up. Authoring a parallel list would mean two places to
 * update when the SMS driver already declared in `_shared/signing.ts` becomes a
 * third value, and two chances to describe the same option differently on the
 * screen that sets the default and the screen that overrides it.
 */

export {
    const_EnvelopeSignerAuthOptions as const_OrganizationsDefaultSignerAuthOptions,
    utils_Envelope_SignerAuthOption,
    type Envelope_SignerAuth,
} from "@/components/envelopes/const_EnvelopeSignerAuthOptions";
