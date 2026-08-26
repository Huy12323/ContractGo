import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

/**
 * A signing party. Fulfils exactly one template role, and that role's `order`
 * decides when they are reached — roles sharing an order sign in parallel
 * (CG-011 swapped `UNIQUE (request_id, signer_order)` for
 * `UNIQUE (request_id, role_id)` to make that representable).
 */
export type UseM_Envelope_Send_Recipient = {
    recipient_type: "signer";
    /** Which `signer_roles[].id` from the template this person fulfils. */
    role_id: string;
    name: string;
    email: string;
    /**
     * Identification evidence for this party (CG-016), never a send requirement.
     *
     * DECLARED BELATEDLY, NOT NEWLY SENT: `buildPayload` has always put it on
     * the body, and this type has always denied it. It compiled only because the
     * payload object is not "fresh" at the `mutateAsync` call site, so excess
     * property checking never ran. Leaving the lie in place would invite the next
     * person to conclude excess properties are fine here.
     */
    phone?: string;
    /**
     * This recipient's exception to the envelope-level `signer_auth` (CG-032).
     * `null` means inherit, and the composer always sends one of the two
     * explicit values for the same reason it always sends `expires_at`.
     */
    auth_method?: "account" | "email_otp" | null;
    /**
     * [ekyc] This recipient's exception to the envelope's identity requirement
     * (CG-033). `null` means inherit.
     */
    require_identity_check?: boolean | null;
};

/**
 * An observer. Carries no `role_id` AT ALL — the CG-011 shape CHECK rejects a
 * `cc` row that owns one, because a role owns positioned field boxes and an
 * observer fills nothing. Pinned server-side to `signer_order` 0, which
 * `current_order >= 1` can never match, so they can never take a turn.
 */
export type UseM_Envelope_Send_Cc = {
    recipient_type: "cc";
    name: string;
    email: string;
    /** Copy them at send time as well as on completion. Not persisted. */
    notify_on_send: boolean;
};

export type UseM_Envelope_Send_Body = {
    organization_id: string;
    // No `entity_id`: CG-030 made it something the server derives from the
    // template, so sending one would be a value the edge function ignores.
    template_id: string;
    title: string;
    /**
     * Promote this DRAFT instead of creating a new envelope (Phase G).
     *
     * The rest of the body still travels and is still authoritative: the server
     * takes its content from here and uses the draft only for its identity, so
     * what gets sent is what is on screen rather than whatever the last autosave
     * happened to catch. Omitted for a fresh compose.
     */
    envelope_id?: string;
    recipients: (UseM_Envelope_Send_Recipient | UseM_Envelope_Send_Cc)[];
    /** The SENDER's own field values, keyed by `TemplateField.id`. */
    prefilled_values: Record<string, unknown>;
    /**
     * ISO instant, or `null` for "no deadline". THREE-WAY on the server, so the
     * composer always sends one of the two explicit values: omitting the key
     * means "use the pinned version's `default_expiry_days`", which would
     * silently re-apply a default the sender had just switched off.
     */
    expires_at?: string | null;
    /** Offsets in whole days since sending. Omitted = the version's default. */
    reminder_days?: number[];
    /**
     * How recipients prove who they are before signing (CG-031).
     *
     * Unlike `expires_at` this is only two-way: there is no template default to
     * fall back to, so an omitted key means `"account"` and nothing else. The
     * composer sends it explicitly anyway, for the same reason it sends the
     * deadline explicitly — a body that leaves an authentication setting to a
     * server-side default is a body whose meaning depends on which version of
     * the server received it.
     */
    signer_auth?: "account" | "email_otp";
    /**
     * [ekyc] Whether recipients must pass a government-ID check before signing
     * (CG-033). ORTHOGONAL to `signer_auth` — a recipient can owe a passcode, a
     * document check, both, or neither. An omitted key means `false`; the
     * composer sends it explicitly anyway, like the deadline and the auth mode.
     */
    require_identity_check?: boolean;
};

export type UseM_Envelope_Send_Result = {
    id: string;
    status: "sent" | "sent_with_delivery_failures";
    notified: string[];
    failed?: string[];
};

/**
 * Sends a template to its recipients as a live signature request.
 *
 * Two modes, differing only by `envelope_id`: create-and-send, or promote a draft.
 * The pair beside this — `useM_Envelope_DraftCreate` / `useM_Envelope_DraftUpdate`
 * — arrived in Phase G. They are edge functions rather than client inserts for the
 * reason that deferred drafts out of v1.0 in the first place:
 * `signature_requests.source_pdf_sha256` is NOT NULL and is evidence, so the row
 * cannot exist before a server has read the PDF and hashed it.
 *
 * Server-side field errors are re-thrown with `missing_fields` attached, the
 * same contract `signing_submit` uses, so the composer can highlight the exact
 * boxes rather than showing a sentence about fields the sender then has to hunt
 * for.
 */
export const useM_Envelope_Send = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["envelopes", "send"],
        mutationFn: async (body: UseM_Envelope_Send_Body) => {
            const sb_FunctionsEnvelopesSend_Invoke = await supabase.functions.invoke(
                "envelopes_send",
                { body }
            );
            if (sb_FunctionsEnvelopesSend_Invoke.error) {
                throw await utils_Signing_UnwrapError(sb_FunctionsEnvelopesSend_Invoke.error);
            }
            return sb_FunctionsEnvelopesSend_Invoke.data as UseM_Envelope_Send_Result;
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.signature_requests.all() });
            queryClient.invalidateQueries({
                queryKey: QueryKeys.signature_request_signers.all(),
            });

            // A 207 means the document IS sent and one or more emails were not
            // delivered. Reporting it as plain success would leave the sender
            // waiting on someone who never got a link.
            if (result.status === "sent_with_delivery_failures") {
                message.warning(
                    `Sent, but the email could not be delivered to ${(result.failed ?? []).join(", ")}. Resend from the document once it is listed.`
                );
                return;
            }
            message.success("Sent for signature");
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to send for signature");
        },
    });

    return { mutation };
};
