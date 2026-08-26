/**
 * signing_link_for_me — a party opens their own document from inside the app.
 *
 * AUTHENTICATED, and that is the whole security argument. The caller must hold a
 * session on the very address the document names; the function then mints that
 * signer's own credential and hands it back.
 *
 * WHY THIS IS NOT `envelopes_dev-signing-link` WITH THE GATE REMOVED. That
 * function is dev-only because it hands the SENDER a credential that speaks as a
 * counterparty — the sender being unable to sign on someone else's behalf is
 * what makes the audit trail worth anything. This one hands a credential to the
 * person it already belongs to, and the check it makes is STRICTER than the
 * emailed link's: a `/sign/<token>` URL proves only that someone reached the
 * signer's mailbox (links get forwarded, archives outlive their readers), while
 * a session proves the account. `signing_submit` already refuses unless BOTH
 * agree, so nothing here widens what the holder can ultimately do.
 *
 * WHY IT HAS TO EXIST AT ALL. The plaintext token is in the mail and nowhere
 * else — the database keeps only its sha256 (CG-005) — so a notification cannot
 * carry a signing link, and the envelope page it linked to instead lives under
 * `/_protected/$organizationId`, which a signer who is not a MEMBER of the
 * sending organization cannot open. Before this, a ContractGo user asked to sign
 * by another organization got a bell item pointing at a 403.
 *
 * WHAT IT COSTS, and the UI says so before the click: `signer_token_issue`
 * revokes the signer's previous live token of the same purpose, so using this
 * kills the link sitting in their inbox. That is the same trade a resend makes,
 * and it is the reason the button copy names it.
 *
 * TWO DESTINATIONS, and this function picks between them — which is why it
 * returns a `mode` rather than always a URL.
 *
 *   `sign_link`  the signing surface, reached with a freshly minted token. For
 *                anyone who still has something to do, and for outside parties
 *                who have no other way in.
 *   `in_app`     the document detail page under `/_protected/$organizationId`.
 *                For a party who has ALREADY SIGNED (or declined, or whose
 *                document has since completed, expired or been voided) AND who
 *                is a member of the sending organization. It carries a `reason`
 *                — `already_signed`, `declined` or `closed` — so the client can
 *                tell the user why they were sent to a page instead of to the
 *                signing surface the row's label promised.
 *
 * The second case is the one this used to refuse outright with 409 "You have
 * already signed this document." — a dead end reached by clicking a bell item
 * that says you signed it. The signing surface is the wrong answer for them
 * even read-only: it shows a receipt. The document page shows the signed PDF,
 * the recipient list, the hashes, the audit trail and the download, which is
 * what somebody clicking "Mutual NDA" is looking for.
 *
 * `in_app` MINTS NOTHING. No token, and therefore no `signer_token_issued`
 * entry — the caller is being sent somewhere their session already admits them,
 * and writing a credential into an evidence chain to then not use it would put
 * a fact in the record that did not happen.
 *
 * A party who has finished but is NOT a member still gets `sign_link`, with a
 * `view` purpose: the document page would 403 for them, and a read-only signing
 * surface beats a refusal.
 */

import { createClient } from "supabase";
import { jsonResponse, requireEnv } from "../_shared/http.ts";
import {
    getSignerPortalUrl,
    getTokenTtlHours,
    logEnvelopeEvent,
} from "../_shared/envelopeNotify.ts";
import type { Rpc_SignerTokenIssue } from "../_shared/rpcRows.ts";
import { SenderAuthError, serveSenderFunction } from "../_shared/senderAuth.ts";

serveSenderFunction("signing_link_for_me", async (body, req) => {
    const requestId = String(body.request_id ?? "");
    if (!requestId) throw new SenderAuthError(400, "request_id is required");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new SenderAuthError(401, "Missing authorization");

    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const asCaller = createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
        { global: { headers: { Authorization: authHeader } } }
    );

    const {
        data: { user },
        error: authError,
    } = await asCaller.auth.getUser();
    if (authError || !user?.email) throw new SenderAuthError(401, "Unauthorized");

    const { data: request, error: requestError } = await admin
        .from("signature_requests")
        .select("id, organization_id, title, status, current_order")
        .eq("id", requestId)
        .maybeSingle();

    if (requestError) {
        console.error("signing_link_for_me: could not load the request:", requestError);
        throw new SenderAuthError(500, "Could not load the document");
    }
    // "Not found" rather than "not yours" — a caller who is not a party to a
    // document is not entitled to learn that it exists.
    if (!request) throw new SenderAuthError(404, "Document not found");

    // THE AUTHORIZATION. Matched on the address rather than on `signer_user_id`,
    // which is null for everyone who was invited before they had an account —
    // which is most signers. Case-insensitive because the sender typed the
    // address and the signer typed their signup email.
    const { data: signers, error: signerError } = await admin
        .from("signature_request_signers")
        .select("id, signer_name, signer_email, signer_order, status, recipient_type")
        .eq("request_id", requestId)
        .ilike(
            "signer_email",
            user.email.replace(/[\\%_]/g, (c) => `\\${c}`)
        );

    if (signerError) {
        console.error("signing_link_for_me: could not load signers:", signerError);
        throw new SenderAuthError(500, "Could not load the document");
    }

    // One address can hold two roles on the same document — a party who is also
    // copied. Prefer the one that can act; a read-only link when a signature is
    // owed would be a dead end wearing a working link's clothes.
    const signer = signers?.find((s) => s.recipient_type === "signer") ?? signers?.[0];
    if (!signer) throw new SenderAuthError(404, "This document is not addressed to your account");

    if (request.status === "draft") {
        throw new SenderAuthError(409, "This document has not been sent yet.");
    }

    // Is this party's part OVER? Signed, declined, or the document itself moved
    // past the point of being signable while they were away.
    //
    // NOT INCLUDED: the out-of-turn case. "It is not your turn yet" is a wait,
    // not an ending — the document may still change before it reaches them, and
    // it stays a refusal below.
    const isFinishedForSigner =
        signer.status === "signed" ||
        signer.status === "declined" ||
        request.status !== "in_progress";

    // Asked AS THE CALLER: `is_org_member` reads auth.uid() itself, so running
    // it on the admin client would answer for nobody. This is the same predicate
    // the envelope page's own RLS applies, which is what makes it safe to send
    // them there — if it says true, the page will render for them.
    if (isFinishedForSigner) {
        const { data: isMember, error: memberError } = await asCaller.rpc("is_org_member", {
            org_id: request.organization_id,
        });

        if (memberError) {
            // Not fatal: falling through to a read-only signing link still shows
            // them the document. Logged because a failure here silently costs
            // the better destination.
            console.error("signing_link_for_me: membership check failed:", memberError);
        }

        if (isMember === true) {
            return jsonResponse(
                {
                    mode: "in_app",
                    organization_id: request.organization_id,
                    request_id: request.id,
                    // WHY their part is over, so the page they land on can say so.
                    // Without it the navigation is silent and indistinguishable
                    // from a plain "open document" click — the user clicked a row
                    // asking them to sign and got a read-only page with no
                    // explanation. The three cases read differently to the person
                    // who clicked, so they are three values rather than a flag.
                    reason:
                        signer.status === "signed"
                            ? "already_signed"
                            : signer.status === "declined"
                              ? "declined"
                              : "closed",
                },
                200
            );
        }
    }

    const purpose = signer.recipient_type === "cc" || isFinishedForSigner ? "view" : "sign";

    // The one refusal left, kept HERE with a reason the reader can act on rather
    // than left to `assertCanAct` at the far end, which answers every refusal
    // identically so as not to leak state to a bearer-token holder. A caller who
    // has proved their account is entitled to know why their own document will
    // not open.
    if (purpose === "sign" && signer.signer_order !== request.current_order) {
        throw new SenderAuthError(409, "It is not your turn to sign yet.");
    }

    const { data: issued, error: issueError } = await admin
        .rpc("signer_token_issue", {
            p_signer_id: signer.id,
            p_purpose: purpose,
            p_ttl_hours: getTokenTtlHours(),
        })
        .maybeSingle<Rpc_SignerTokenIssue>();

    if (issueError || !issued?.token) {
        console.error(`signer_token_issue failed for ${signer.id}:`, issueError);
        throw new SenderAuthError(500, "Could not open the document");
    }

    // The token id, never the token — the same payload every other issuing path
    // writes. `self_service` is what tells a later reader that this credential
    // was minted by the signer for themselves from a session, rather than mailed
    // to them, which is a different fact about how they came to hold it.
    await logEnvelopeEvent(admin, {
        requestId: request.id,
        organizationId: request.organization_id,
        signerId: signer.id,
        actorUserId: user.id,
        eventType: "signer_token_issued",
        payload: {
            token_id: issued.token_id,
            expires_at: issued.expires_at,
            signer_email: signer.signer_email,
            purpose,
            self_service: true,
        },
    });

    // Same status move the mail path makes after a successful send, and for the
    // same reason: `assertCanAct` accepts only `notified`, `viewed` or
    // `changes_requested`, so a still-`pending` signer would land on a refusal.
    // Guarded on `pending` so nobody walks backwards from `viewed`.
    if (purpose === "sign") {
        const { error: statusError } = await admin
            .from("signature_request_signers")
            .update({ status: "notified", notified_at: new Date().toISOString() })
            .eq("id", signer.id)
            .eq("status", "pending");

        if (statusError) {
            console.error(`Marking ${signer.id} notified failed:`, statusError);
        } else if (signer.status === "pending") {
            await logEnvelopeEvent(admin, {
                requestId: request.id,
                organizationId: request.organization_id,
                signerId: signer.id,
                actorUserId: user.id,
                eventType: "signer_notified",
                payload: {
                    signer_email: signer.signer_email,
                    signer_order: signer.signer_order,
                    self_service: true,
                },
            });
        }
    }

    return jsonResponse(
        {
            mode: "sign_link",
            url: `${getSignerPortalUrl().replace(/\/+$/, "")}/sign/${issued.token}`,
            // The path alone, for an in-app router that must not send the user to
            // another origin when the portal and the app are the same deployment.
            path: `/sign/${issued.token}`,
            expires_at: issued.expires_at,
            purpose,
        },
        200
    );
});
