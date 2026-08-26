// Status vocabularies for the envelope tables.
//
// These ARE Postgres enums (`signature_requests_status_enum` and
// `signature_request_signers_status_enum`, converted from TEXT+CHECK by CG-005),
// so unlike `const_TemplateFieldTypeOptions` they are keyed off the generated
// database types — the `satisfies Record<...>` below fails the build if a value
// is added to or removed from the enum without being given a label here.
//
// Colour choices are load-bearing rather than decorative: `declined` and
// `cancelled` are both terminal-without-a-document, but only one of them is
// something a signer did, and a sender chasing a stalled envelope needs to tell
// those apart at a glance.

import type { Supabase_Enums } from "@/types/supabase.types";
import { Utils_Options_EnumsToOptions } from "@/utils/options/EnumsToOptions";

export type Envelope_Status = Supabase_Enums<"signature_requests_status_enum">;
export type EnvelopeSigner_Status = Supabase_Enums<"signature_request_signers_status_enum">;
export type EnvelopeRecipient_Type =
    Supabase_Enums<"signature_request_signers_recipient_type_enum">;

type StatusOption<T extends string> = {
    value: T;
    label: string;
    /** An ANTD Tag colour name or token — see `App_EnvelopeStatusTag`. */
    color: string;
};

const Envelope_Statuses = {
    draft: { value: "draft", label: "Draft", color: "default" },
    in_progress: { value: "in_progress", label: "Awaiting signatures", color: "processing" },
    completed: { value: "completed", label: "Completed", color: "success" },
    declined: { value: "declined", label: "Declined", color: "error" },
    cancelled: { value: "cancelled", label: "Voided", color: "default" },
    // The third way a route ends without a document, and the only one NOBODY
    // chose — `declined` was an act and `cancelled` was an act, this is the
    // absence of one. Warning rather than error for exactly that reason: nothing
    // went wrong, the clock simply ran out, and the sender's next move is to
    // send it again rather than to find out what happened.
    expired: { value: "expired", label: "Expired", color: "warning" },
} satisfies Record<Envelope_Status, StatusOption<Envelope_Status>>;

const EnvelopeSigner_Statuses = {
    pending: { value: "pending", label: "Not yet notified", color: "default" },
    notified: { value: "notified", label: "Sent", color: "blue" },
    viewed: { value: "viewed", label: "Opened", color: "processing" },
    signed: { value: "signed", label: "Signed", color: "success" },
    declined: { value: "declined", label: "Declined", color: "error" },
    // Warning, not error: the sender sent this turn back, so the envelope is
    // live and waiting on someone — the opposite of `declined`, which is
    // terminal. Both are red-adjacent states that mean very different things to
    // whoever is chasing the document.
    changes_requested: { value: "changes_requested", label: "Changes requested", color: "warning" },
} satisfies Record<EnvelopeSigner_Status, StatusOption<EnvelopeSigner_Status>>;

// CG-011 made a recipient's kind structural: a `cc` is pinned to signer_order 0
// and owns no role, so it can never satisfy `signature_claim_turn`'s order
// match. The list renders observers outside the numbered steps for that reason
// — a CC shown as a step is a step that never completes.
const EnvelopeRecipient_Types = {
    signer: { value: "signer", label: "Signer", color: "processing" },
    cc: { value: "cc", label: "Receives a copy", color: "default" },
} satisfies Record<EnvelopeRecipient_Type, StatusOption<EnvelopeRecipient_Type>>;

export const const_EnvelopeStatusOptions = Utils_Options_EnumsToOptions(Envelope_Statuses);
export const const_EnvelopeSignerStatusOptions =
    Utils_Options_EnumsToOptions(EnvelopeSigner_Statuses);
export const const_EnvelopeRecipientTypeOptions =
    Utils_Options_EnumsToOptions(EnvelopeRecipient_Types);

/**
 * Tabs on the envelope list. `all` is not a status — it is the absence of a
 * filter — so it lives here rather than being smuggled into the enum, and the
 * list route's search param is typed as this union rather than the raw enum.
 */
export const const_EnvelopeStatusFilters = [
    { value: "all", label: "All" },
    // First after "All" because it is the only tab whose rows are still the
    // sender's to finish. Everything to its right is a document that has left.
    { value: "draft", label: "Drafts" },
    { value: "in_progress", label: "Awaiting signatures" },
    { value: "completed", label: "Completed" },
    { value: "declined", label: "Declined" },
    { value: "expired", label: "Expired" },
    { value: "cancelled", label: "Voided" },
] as const;

export type Envelope_StatusFilter = (typeof const_EnvelopeStatusFilters)[number]["value"];

export const utils_Envelope_IsStatusFilter = (value: unknown): value is Envelope_StatusFilter =>
    const_EnvelopeStatusFilters.some((filter) => filter.value === value);
