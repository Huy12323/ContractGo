/**
 * envelopes_dev-signing-link — hand a signer's link to the SENDER, for testing.
 *
 * AUTHENTICATED. Admin or owner of the envelope's organization, like every other
 * sender-side function. Then one further gate that the others do not have.
 *
 * WHY THIS IS DEV-ONLY, AND WHY THE GATE IS `DEV_SIGNING_LINKS`.
 * A signing token is a bearer credential that speaks AS the signer: whoever
 * holds it can open the document, fill the fields and sign. The whole point of
 * `_shared/envelopeNotify.ts` never returning the plaintext to the composer's
 * browser is that the sender must not be able to sign on a counterparty's
 * behalf — that is what makes the audit trail worth anything. Returning it here
 * deliberately breaks that property, so the function refuses to run anywhere the
 * property still matters.
 *
 * The gate used to be `EMAIL_DRIVER === "console"`, on the reasoning that a
 * stack which cannot mail anyone has no counterparty to protect. That coupling
 * broke the moment dev got real Resend credentials: delivering mail for real and
 * reaching the signer surface locally are separate wants, and folding them into
 * one switch meant buying either at the cost of the other.
 *
 * So the capability now has its own flag, and it is opt-IN by absence: anything
 * other than the literal `enabled` refuses. Nothing defaults it on, no generated
 * env file carries it (it ships commented out in `.env.example`, and
 * `env-apply.js` skips comment lines), and unsetting it is enough to close the
 * hole. That is deliberately unlike `ENVIRONMENT`, whose template default is
 * `development` — a flag that fails OPEN when someone copies the template is no
 * gate at all for a capability that discloses a live signing credential.
 *
 * WHAT IT COSTS. Issuing is not free of side effects, and the UI says so: like a
 * resend, `signer_token_issue` REVOKES the signer's previous live token, so any
 * link already sitting in the console log (or a real inbox) stops working. And
 * the issue is chained as `signer_token_issued` exactly as the mail path chains
 * it — a credential that exists without evidence that it was minted would be a
 * worse hole than the one this function openly admits to.
 */

import { jsonResponse } from "../_shared/http.ts";
import { getSignerPortalUrl, getTokenTtlHours } from "../_shared/envelopeNotify.ts";
import type { Rpc_SignerTokenIssue } from "../_shared/rpcRows.ts";
import {
    loadEnvelopeForSender,
    logSenderEvent,
    resolveSender,
    SenderAuthError,
    serveSenderFunction,
} from "../_shared/senderAuth.ts";

function assertDevEnvironment() {
    if (Deno.env.get("DEV_SIGNING_LINKS") !== "enabled") {
        // Deliberately not "this feature is disabled" — there is no configuration
        // the caller is entitled to turn on, and saying so invites someone to try.
        throw new SenderAuthError(403, "Signing links are only readable in development.");
    }
}

serveSenderFunction("envelopes_dev-signing-link", async (body, req) => {
    assertDevEnvironment();

    const ctx = await resolveSender(req, String(body.organization_id ?? ""), "send_documents");
    const envelope = await loadEnvelopeForSender(ctx, String(body.envelope_id ?? ""));
    const signerId = String(body.signer_id ?? "");

    if (!signerId) throw new SenderAuthError(400, "signer_id is required");

    if (envelope.status === "draft") {
        // A draft has no signer credentials by construction: `template_snapshot`
        // is still NULL, so there is nothing for the signing page to render.
        throw new SenderAuthError(409, "This document has not been sent yet.");
    }

    // Scoped to the envelope the caller was just authorized for, so a signer id
    // from another organization's document reads as "not found" rather than
    // resolving. Same reasoning as `loadEnvelopeForSender`'s WHERE clause.
    const { data: signer, error } = await ctx.admin
        .from("signature_request_signers")
        .select("id, signer_name, signer_email, signer_order, status, recipient_type")
        .eq("id", signerId)
        .eq("request_id", envelope.id)
        .maybeSingle();

    if (error) {
        console.error("envelopes_dev-signing-link: could not load signer:", error);
        throw new SenderAuthError(500, "Could not load the recipient");
    }
    if (!signer) throw new SenderAuthError(404, "Recipient not found on this document");

    // A CC observer's credential is read-only, and issuing them a `sign` token
    // would hand out a capability the composer never granted. `assertCanAct`
    // would reject it at the far end anyway; matching the purpose to the
    // recipient type means the link that comes back is the one that works.
    const purpose = signer.recipient_type === "cc" ? "view" : "sign";

    const { data: issued, error: issueError } = await ctx.admin
        .rpc("signer_token_issue", {
            p_signer_id: signer.id,
            p_purpose: purpose,
            p_ttl_hours: getTokenTtlHours(),
        })
        .maybeSingle<Rpc_SignerTokenIssue>();

    if (issueError || !issued?.token) {
        console.error(`signer_token_issue failed for ${signer.id}:`, issueError);
        throw new SenderAuthError(500, "Could not issue a link");
    }

    // The token id, never the token — the same payload the mail path writes. The
    // `dev_link` marker is what tells a later reader that this credential went to
    // the sender's screen instead of the recipient's inbox, which is exactly the
    // kind of thing an evidence trail exists to record.
    await logSenderEvent(ctx, {
        envelopeId: envelope.id,
        signerId: signer.id,
        eventType: "signer_token_issued",
        payload: {
            token_id: issued.token_id,
            expires_at: issued.expires_at,
            signer_email: signer.signer_email,
            purpose,
            dev_link: true,
        },
    });

    // Handing the link over IS the delivery here, so the same status move the
    // mail path makes after a successful send happens for the same reason: a
    // `pending` signer is not signable — `assertCanAct` accepts only `notified`,
    // `viewed` or `changes_requested` — so without this the link would open
    // straight onto a refusal whenever the original send never reached them.
    // Guarded on `pending` exactly as the mail path is, so a signer who has
    // already opened the document does not walk backwards from `viewed`.
    if (purpose === "sign") {
        const { error: statusError } = await ctx.admin
            .from("signature_request_signers")
            .update({ status: "notified", notified_at: new Date().toISOString() })
            .eq("id", signer.id)
            .eq("status", "pending");

        if (statusError) {
            console.error(`Marking ${signer.id} notified failed:`, statusError);
        } else if (signer.status === "pending") {
            // State and evidence move together. A row that reads `notified` with
            // nothing in the chain saying so is exactly the inconsistency the
            // hash chain exists to make impossible.
            await logSenderEvent(ctx, {
                envelopeId: envelope.id,
                signerId: signer.id,
                eventType: "signer_notified",
                payload: {
                    signer_email: signer.signer_email,
                    signer_order: signer.signer_order,
                    dev_link: true,
                },
            });
        }
    }

    return jsonResponse(
        {
            url: `${getSignerPortalUrl().replace(/\/+$/, "")}/sign/${issued.token}`,
            expires_at: issued.expires_at,
            purpose,
            signer_name: signer.signer_name,
            signer_email: signer.signer_email,
        },
        200
    );
});
