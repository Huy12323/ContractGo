// The per-recipient EXCEPTION to the envelope-level choice — CG-032.
//
// `const_EnvelopeSignerAuthOptions` says what the two ways of proving identity
// ARE, and it stays the single source for that copy. This file adds only the
// third thing this control can say: "same as everyone".
//
// WHY A SENTINEL IS NEEDED AT ALL. ANTD's `Select` cannot carry `null` as an
// option value — a null `value` renders as the placeholder, so "inherit" would
// be indistinguishable from "not answered". So the SELECT speaks in a sentinel
// and the caller speaks in `null`, and the two translations live here.
//
// STATE HOLDS `null`, NEVER THE SENTINEL. What the composer holds is then
// byte-for-byte what the column stores, and a sentinel in state would have to be
// translated at both the draft-hydrate and the send boundary — where one miss
// writes the literal string "__inherit__" into a Postgres enum column. Keeping
// the sentinel inside this module means it can only exist between
// `utils_Envelope_AuthToSelect` and `utils_Envelope_AuthFromSelect`.

import {
    const_EnvelopeSignerAuthOptions,
    utils_Envelope_SignerAuthOption,
    type Envelope_SignerAuth,
} from "@/components/envelopes/const_EnvelopeSignerAuthOptions";

/**
 * Not a value of `signature_requests_signer_auth_enum` and never sent anywhere.
 * Double-underscored so it cannot collide with a future enum value — and
 * `const_EnvelopeRecipientAuthOptions.test.ts` asserts it never appears in the
 * enum-derived options, which is what stops it reaching the column.
 */
export const const_Envelope_AuthInherit = "__inherit__";

export type Envelope_RecipientAuthSelectValue =
    | typeof const_Envelope_AuthInherit
    | Envelope_SignerAuth;

export const utils_Envelope_AuthToSelect = (
    value: Envelope_SignerAuth | null | undefined
): Envelope_RecipientAuthSelectValue => value ?? const_Envelope_AuthInherit;

export const utils_Envelope_AuthFromSelect = (
    value: Envelope_RecipientAuthSelectValue
): Envelope_SignerAuth | null => (value === const_Envelope_AuthInherit ? null : value);

type RecipientAuthOption = {
    value: Envelope_RecipientAuthSelectValue;
    label: string;
    description: string;
};

/**
 * The options for one recipient's control, given what the envelope is set to.
 *
 * THE INHERIT OPTION NAMES WHAT IT INHERITS. The wizard reaches Recipients
 * BEFORE Prepare, so at the moment a sender opens this the envelope-level radio
 * group is one they have not seen yet — an unlabelled "Same as everyone" would
 * be asking them to except from a default they cannot name. Spelling it out
 * costs one string interpolation and removes the only genuinely confusing thing
 * about having two controls.
 */
export const utils_Envelope_RecipientAuthOptions = (
    inherited: Envelope_SignerAuth
): RecipientAuthOption[] => [
    {
        value: const_Envelope_AuthInherit,
        label: `Same as everyone — ${utils_Envelope_SignerAuthOption(inherited).label.toLowerCase()}`,
        description:
            "This recipient follows the choice made for the whole document on the Prepare & send step.",
    },
    ...const_EnvelopeSignerAuthOptions.options.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description,
    })),
];
