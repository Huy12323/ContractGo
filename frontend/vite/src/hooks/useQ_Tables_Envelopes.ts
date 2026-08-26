import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { Envelope_StatusFilter } from "@/components/envelopes/const_EnvelopeStatusOptions";

// The envelope list.
//
// Signers are embedded rather than fetched per row: the list's whole job is to
// answer "who is this waiting on", and a second query per envelope would make
// that N+1 over exactly the rows the user is looking at. The embed is small —
// five columns per signer — and both tables are covered by the same
// `is_org_member` SELECT policy, so RLS filters the join without a second
// round trip.
//
// Scoped by ORGANIZATION. There was an entity filter on top of that until CG-030,
// but it had never once narrowed anything: `Page_Envelopes` seeded it to `''`,
// which meant "all entities", and the toolbar selector that was the only way to
// change it collapsed to an unclickable chip at one entity per org.

const fetchEnvelopes = async (args: { organizationId: string; status: Envelope_StatusFilter }) => {
    let query = supabase
        .from("signature_requests")
        // ONE string literal, deliberately not concatenated: supabase-js parses
        // the select at the TYPE level, and `"a" + "b"` widens to `string`,
        // which collapses the whole result type to `GenericStringError`.
        .select(
            "id, title, status, current_order, created_by, template_id, sent_at, completed_at, expires_at, reminder_days, created_at, updated_at, signed_pdf_r2_key, signed_pdf_sha256, certificate_sha256, certificate_generated_at, signature_request_signers(id, signer_user_id, signer_name, signer_email, signer_order, status, role_id, signed_at)"
        )
        .eq("organization_id", args.organizationId)
        .order("created_at", { ascending: false });

    if (args.status !== "all") query = query.eq("status", args.status);

    const sb_FromSignatureRequests_Select = await query;
    if (sb_FromSignatureRequests_Select.error) throw sb_FromSignatureRequests_Select.error;
    return sb_FromSignatureRequests_Select.data;
};

export type Tables_Envelopes_QueryData = Awaited<ReturnType<typeof fetchEnvelopes>>;
export type Tables_Envelopes_Record = Tables_Envelopes_QueryData[number];
export type Tables_Envelopes_Signer = Tables_Envelopes_Record["signature_request_signers"][number];

export const useQ_Tables_Envelopes = ({
    organizationId,
    status,
}: {
    organizationId: string;
    status: Envelope_StatusFilter;
}) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.signature_requests.list(), { organizationId, status }],
        queryFn: () => fetchEnvelopes({ organizationId, status }),
    });

    const envelopes = useMemo(() => query.data || [], [query.data]);

    return { query, envelopes };
};

/**
 * The parties an envelope is currently waiting on — the ones at `current_order`
 * who have not acted.
 *
 * Derived rather than stored. `current_order` plus each signer's status is the
 * authoritative pair (it is what `signature_claim_turn` asserts on), and a
 * "waiting_on" column would be a third copy of a fact those two already state.
 */
export const utils_Envelope_WaitingOn = (
    envelope: Pick<Tables_Envelopes_Record, "status" | "current_order"> & {
        signature_request_signers: Pick<
            Tables_Envelopes_Signer,
            "signer_order" | "status" | "signer_name"
        >[];
    }
): string[] => {
    if (envelope.status !== "in_progress") return [];
    return envelope.signature_request_signers
        .filter((signer) => signer.signer_order === envelope.current_order)
        .filter((signer) => signer.status !== "signed" && signer.status !== "declined")
        .map((signer) => signer.signer_name);
};

export const utils_Envelope_SignedCount = (signers: Pick<Tables_Envelopes_Signer, "status">[]) =>
    signers.filter((signer) => signer.status === "signed").length;

/**
 * The signed-in user's own row on an envelope, if they are a party to it.
 *
 * Matched on `signer_user_id`, NOT on email. The column is the link the schema
 * actually enforces — `signature_claim_turn` asserts on it and there is a unique
 * key over `(request_id, signer_user_id)` — while `signer_email` is free text a
 * sender typed, and two people can reach the same inbox. It is nullable: an
 * envelope sent to an address with no account has a signer row and no user, and
 * that row must never match a logged-in reader, which a `null === null` compare
 * on a missing `userId` would do. Hence the empty-string guard.
 */
export const utils_Envelope_MySigner = (
    envelope: Pick<Tables_Envelopes_Record, "signature_request_signers">,
    userId: string
): Tables_Envelopes_Signer | null => {
    if (!userId) return null;
    return (
        envelope.signature_request_signers.find((signer) => signer.signer_user_id === userId) ??
        null
    );
};

/**
 * Whether this document is waiting on the signed-in user RIGHT NOW — the same
 * test `utils_Envelope_WaitingOn` applies to everyone, narrowed to one person.
 *
 * A cc recipient can never be someone's turn and needs no special case here:
 * CG-011 pins observers to `signer_order` 0 and `current_order` is `>= 1` by
 * check constraint, so the order match excludes them structurally.
 */
export const utils_Envelope_IsMyTurn = (
    envelope: Pick<
        Tables_Envelopes_Record,
        "status" | "current_order" | "signature_request_signers"
    >,
    userId: string
): boolean => {
    if (envelope.status !== "in_progress") return false;
    const me = utils_Envelope_MySigner(envelope, userId);
    return (
        !!me &&
        me.signer_order === envelope.current_order &&
        me.status !== "signed" &&
        me.status !== "declined"
    );
};

/** Inside this window, an expiry is worth surfacing in the list. */
const EXPIRING_SOON_DAYS = 3;

export type Envelope_ExpiryState =
    | { kind: "none" }
    | { kind: "passed" }
    | { kind: "soon"; days: number; at: string }
    | { kind: "later"; days: number; at: string };

/**
 * How close an in-flight document is to lapsing.
 *
 * Derived at render time rather than stored, for the same reason `WaitingOn` is:
 * `expires_at` plus the clock is the authoritative pair, and a stored
 * "expiring_soon" flag would be a third copy that goes stale between cron ticks.
 *
 * `passed` is reachable and is not a bug: `envelopes_cron_expire` runs hourly, so
 * a document can sit past its deadline for up to an hour before its status
 * catches up. Showing "overdue" during that window is more honest than showing a
 * countdown that has already reached zero.
 *
 * Only in-flight documents have a live deadline — a completed one's `expires_at`
 * is history, and counting down on it would suggest the finished document is
 * about to stop being valid.
 */
export const utils_Envelope_ExpiryState = (
    envelope: Pick<Tables_Envelopes_Record, "status" | "expires_at">,
    now: number = Date.now()
): Envelope_ExpiryState => {
    if (envelope.status !== "in_progress" || !envelope.expires_at) return { kind: "none" };
    const at = envelope.expires_at;
    const remainingMs = Date.parse(at) - now;
    if (remainingMs <= 0) return { kind: "passed" };
    // Rounded UP: with 30 hours left, "2 days" overstates the deadline and "1
    // day" understates it — and understating a deadline is the safe direction.
    const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    return days <= EXPIRING_SOON_DAYS ? { kind: "soon", days, at } : { kind: "later", days, at };
};
