/**
 * envelopes_request-changes — the sender sends one signer's turn back.
 *
 * AUTHENTICATED. Admin or owner of the envelope's organization, via the same
 * `resolveSender` gate as `envelopes_send` / `_void` / `_resend` / `_remind`.
 *
 * ⚠ THIS IS NOT A VOID, AND IT IS NOT A DECLINE. The three are easy to conflate
 * from the button bar and are different acts with different terminality:
 *
 *   void            — the SENDER ends the document. Terminal. Every link dies.
 *   decline         — a SIGNER ends the document. Terminal. Every link dies.
 *   request changes — the SENDER reopens ONE signer's turn. NOT terminal. That
 *                     signer gets a working link back; everyone else's
 *                     signatures stand.
 *
 * WHAT MAKES IT SAFE IS THAT IT IS ONE SQL STATEMENT'S WORTH OF DECISION.
 * `signature_request_changes` (CG-014) does the three writes that must be
 * all-or-nothing — signer status, capture supersession, `current_order` rewind —
 * inside one transaction under the request row lock that
 * `signature_advance_after_signature` also takes. This function does not decide
 * anything about routing; it authorizes, calls, and then deals with the two
 * things a database transaction cannot hold: a credential and an email.
 *
 * ORDER OF OPERATIONS, and why:
 *
 *   1. rpc     — the atomic state change. Everything below is derived from it,
 *                so nothing below runs unless it returned `ok`.
 *   2. chain   — `sender_requested_changes` + `capture_superseded`. Written
 *                before the credential work, because they are the evidence and
 *                the credential is a consequence.
 *   3. revoke  — `signer_token_revoke_for_signer`. Usually finds nothing: this
 *                signer signed, and `signing_submit` consumed their token on the
 *                way out. It runs anyway, for the case where they hold an unspent
 *                one (a resend they never used), and its COUNT is what the
 *                `signer_token_revoked` entry records.
 *   4. issue   — a fresh `sign` token and the mail carrying the reason. Cannot be
 *                skipped the way a reminder skips it: the link they have is spent
 *                by construction. Non-fatal — the turn is already sent back, and
 *                a failure here is recoverable with Resend link.
 *
 * THE REASON IS REQUIRED. "Changes requested" with no explanation reopens a turn
 * and tells the signer nothing about what to change, so they re-sign the same
 * document and the loop runs again for nothing.
 */

import { jsonResponse } from "../_shared/http.ts";
import { notifySignerOfChangesRequested } from "../_shared/envelopeNotify.ts";
import {
    loadEnvelopeForSender,
    logSenderEvent,
    resolveSender,
    SenderAuthError,
    serveSenderFunction,
} from "../_shared/senderAuth.ts";

/** Same cap as `signing_decline`'s: the chain hashes this string verbatim, so it
 *  bounds an audit payload as well as a mail body. */
const MAX_REASON_LENGTH = 1000;

type RequestChangesOutcome = {
    outcome:
        | "ok"
        | "request_missing"
        | "not_in_progress"
        | "not_a_signer"
        | "not_signed"
        | "finalizing";
    superseded_capture_id: string | null;
    rewound_to: number | null;
};

serveSenderFunction("envelopes_request-changes", async (body, req) => {
    const ctx = await resolveSender(req, String(body.organization_id ?? ""), "send_documents");
    const envelope = await loadEnvelopeForSender(ctx, String(body.envelope_id ?? ""));

    const signerId = String(body.signer_id ?? "");
    if (!signerId) throw new SenderAuthError(400, "signer_id is required");

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
        throw new SenderAuthError(
            400,
            "Say what needs to change — the signer is emailed this and has nothing else to go on."
        );
    }
    if (reason.length > MAX_REASON_LENGTH) {
        throw new SenderAuthError(
            400,
            `Please keep the explanation under ${MAX_REASON_LENGTH} characters.`
        );
    }

    // Read the signer BEFORE the RPC, because the RPC clears `signed_at` and
    // rewrites the status — and the mail below needs the name, address and order,
    // none of which it changes. Scoped to this request in the WHERE clause, so a
    // signer id from another envelope is indistinguishable from a missing one.
    const { data: signer, error: signerError } = await ctx.admin
        .from("signature_request_signers")
        .select("id, signer_name, signer_email, signer_phone, signer_order, status, recipient_type")
        .eq("id", signerId)
        .eq("request_id", envelope.id)
        .maybeSingle();

    if (signerError) {
        console.error("envelopes_request-changes: could not load the signer:", signerError);
        throw new SenderAuthError(500, "Could not load the recipient");
    }
    if (!signer) throw new SenderAuthError(404, "Recipient not found on this document");

    const previousStatus = signer.status as string;

    const { data: rows, error: rpcError } = await ctx.admin.rpc("signature_request_changes", {
        p_request_id: envelope.id,
        p_signer_id: signerId,
        p_reason: reason,
    });

    if (rpcError) {
        console.error("signature_request_changes failed:", rpcError);
        throw new SenderAuthError(500, "Could not send this turn back. Nothing was changed.");
    }

    const result = (Array.isArray(rows) ? rows[0] : rows) as RequestChangesOutcome | undefined;
    if (!result) {
        throw new SenderAuthError(500, "Could not send this turn back. Nothing was changed.");
    }

    // Each outcome gets its own sentence rather than one generic refusal. The
    // sender is looking at a page that offered this action, so "why not" is the
    // only useful thing to say — and `finalizing` in particular is the one they
    // should simply retry.
    switch (result.outcome) {
        case "ok":
            break;
        case "request_missing":
            throw new SenderAuthError(404, "Document not found");
        case "not_in_progress":
            throw new SenderAuthError(
                409,
                `This document is ${envelope.status} and its signatures can no longer be reopened.`
            );
        case "not_a_signer":
            throw new SenderAuthError(
                409,
                "This recipient only receives a copy — they were never asked to sign."
            );
        case "not_signed":
            throw new SenderAuthError(
                409,
                `${signer.signer_name} has not signed yet, so there is nothing to send back. Use Remind instead.`
            );
        case "finalizing":
            throw new SenderAuthError(
                409,
                "The signed document is being generated right now. Reload in a moment and try again."
            );
        default:
            console.error("Unknown signature_request_changes outcome:", result.outcome);
            throw new SenderAuthError(500, "Could not send this turn back.");
    }

    await logSenderEvent(ctx, {
        envelopeId: envelope.id,
        signerId,
        eventType: "sender_requested_changes",
        payload: {
            reason,
            signer_email: signer.signer_email,
            signer_order: signer.signer_order,
            previous_status: previousStatus,
            rewound_to: result.rewound_to,
        },
    });

    // NULL when the signer's role owned no signature field — a role may legitimately
    // hold only data boxes. Chaining a supersession that did not happen would put a
    // claim about evidence into the evidence.
    if (result.superseded_capture_id) {
        await logSenderEvent(ctx, {
            envelopeId: envelope.id,
            signerId,
            eventType: "capture_superseded",
            payload: { capture_id: result.superseded_capture_id },
        });
    }

    const { data: revokedCount, error: revokeError } = await ctx.admin.rpc(
        "signer_token_revoke_for_signer",
        { p_signer_id: signerId }
    );

    if (revokeError) {
        // Loud, not fatal. The turn is sent back and recorded; the worst case is a
        // stale unspent link that `signer_token_issue` below revokes anyway as a
        // side effect of minting the new one.
        console.error("signer_token_revoke_for_signer failed:", revokeError);
    } else if (typeof revokedCount === "number" && revokedCount > 0) {
        await logSenderEvent(ctx, {
            envelopeId: envelope.id,
            signerId,
            eventType: "signer_token_revoked",
            payload: { revoked_count: revokedCount, cause: "changes_requested" },
        });
    }

    const outcome = await notifySignerOfChangesRequested({
        admin: ctx.admin,
        signer: {
            id: signer.id,
            signer_email: signer.signer_email,
            signer_name: signer.signer_name,
            signer_phone: signer.signer_phone,
            signer_order: signer.signer_order,
        },
        requestId: envelope.id,
        organizationId: ctx.organizationId,
        organizationName: ctx.organizationName,
        documentTitle: envelope.title,
        reason,
        actorUserId: ctx.userId,
        actorEvidence: ctx.evidence,
    });

    // 207 rather than 500: the state change succeeded and must not be reported as
    // a failure the sender might retry — retrying would answer `not_signed`, which
    // reads as "nothing happened" about something that did.
    if (!outcome.notified) {
        console.error("Could not email the re-sign link:", outcome.error);
        return jsonResponse(
            {
                id: envelope.id,
                signer_id: signerId,
                status: "changes_requested",
                rewound_to: result.rewound_to,
                notified: false,
                message:
                    "The turn was sent back, but the email did not go out. Use Resend link to give them a working link.",
            },
            207
        );
    }

    return jsonResponse(
        {
            id: envelope.id,
            signer_id: signerId,
            status: "changes_requested",
            rewound_to: result.rewound_to,
            notified: true,
            notified_email: signer.signer_email,
        },
        200
    );
});
