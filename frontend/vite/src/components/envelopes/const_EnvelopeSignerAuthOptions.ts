// How recipients prove who they are before signing — CG-031.
//
// A real Postgres enum (`signature_requests_signer_auth_enum`), so this is keyed
// off the generated types like `const_EnvelopeStatusOptions`: the
// `satisfies Record<...>` fails the build if a value is added to the enum
// without being given copy here. That matters more than usual for this one — the
// SMS passcode driver is already declared in `_shared/signing.ts`, so a third
// value is a question of when, and it must not be able to reach the composer as
// an unlabelled radio button.
//
// THE DESCRIPTIONS ARE THE FEATURE. This control decides what a signature is
// worth, and a sender picking between two options called "Account" and "Email
// code" has been told nothing about the difference. Each option therefore states
// what the recipient DOES and what the signature ends up RESTING ON — and the
// second half is what a dispute is actually about.

import type { Supabase_Enums } from "@/types/supabase.types";
import { Utils_Options_EnumsToOptions } from "@/utils/options/EnumsToOptions";

export type Envelope_SignerAuth = Supabase_Enums<"signature_requests_signer_auth_enum">;

type SignerAuthOption = {
    value: Envelope_SignerAuth;
    label: string;
    /**
     * The Tag form — two or three words.
     *
     * A SEPARATE FIELD BECAUSE `label` IS A SENTENCE. `label` is written for the
     * radio group, where it is the heading of a paragraph and can afford to be
     * "Recipients sign straight from the email". An ANTD `Tag` sets
     * `white-space: nowrap`, so putting that sentence in one inside a 300px
     * sidebar makes the Tag refuse to shrink and crushes whatever shares its
     * flex row — which is exactly what happened to the signer's name in the
     * composer's summary. Anywhere the value is a Tag, use this.
     */
    shortLabel: string;
    /** Shown under the label in the composer's radio group. */
    description: string;
    /** An ANTD Tag colour, for the envelope detail summary. */
    color: string;
};

// KEY ORDER IS RENDER ORDER. `Utils_Options_EnumsToOptions` is `Object.values`,
// so the composer's radio group lists these in the order written here — and the
// default (`email_otp`, see `Page_EnvelopeComposer`) is written first so the
// selected option is the one the eye lands on. It deliberately does NOT match the
// Postgres enum's declaration order; nothing reads these positionally.
const Envelope_SignerAuths = {
    email_otp: {
        value: "email_otp",
        label: "Recipients sign straight from the email",
        shortLabel: "Emailed code",
        // Says what it costs, not just what it saves. A sender choosing this
        // should know they are trading an account-bound signature for one bound
        // to a mailbox at a moment in time — that is a real difference, and
        // burying it would make this control quietly misleading.
        description:
            "No account needed. We email a one-time code to each recipient's address, which they enter before signing. The signature is bound to their mailbox rather than to an account.",
        color: "warning",
    },
    account: {
        value: "account",
        label: "Recipients sign in to ContractGo",
        shortLabel: "Account sign-in",
        // "Proved" rather than "verified" because this project uses
        // `email_verified` to mean one specific column, and since CG-031 a
        // magic-link session satisfies the same check without setting it.
        description:
            "Each recipient signs in to an account on the address you addressed the document to. Their signature is recorded against that account. If they have no account, they can get in with a one-time link we email them.",
        color: "processing",
    },
} satisfies Record<Envelope_SignerAuth, SignerAuthOption>;

export const const_EnvelopeSignerAuthOptions = Utils_Options_EnumsToOptions(Envelope_SignerAuths);

/**
 * Lookup for the detail page's summary, which renders one rather than choosing.
 *
 * Falls back to `account` for a NULL, which is what every envelope sent before
 * CG-031 actually required — the column's default says the same thing, and this
 * is the reader's half of it.
 */
export const utils_Envelope_SignerAuthOption = (
    value: Envelope_SignerAuth | null | undefined
): SignerAuthOption => Envelope_SignerAuths[value ?? "account"] ?? Envelope_SignerAuths.account;
