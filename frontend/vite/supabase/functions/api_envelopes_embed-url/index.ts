/**
 * api_envelopes_embed-url — a signing URL for a named recipient, to be framed on
 * the integrator's own page.
 *
 * `send_documents`, not `member`. Minting a credential that can commit a
 * signature is a write in every sense that matters, even though this endpoint
 * changes no document state: whoever holds the returned URL can sign, and a
 * read-only key must not be able to manufacture that.
 *
 * ═══ NO EMAIL IS SENT, AND THAT IS THE WHOLE DIFFERENCE ═══
 *
 * `envelopes_resend` mails a link and gives it a fortnight, because the person
 * who has to click it may be on holiday and the mailbox is the delivery channel.
 * Here the caller is a program that is about to put the pane on a screen someone
 * is already looking at, so the credential can live for fifteen minutes and be
 * capped at three uses. Nothing about this token ever travels through a mail
 * server, which is why the short TTL is reasonable rather than hostile.
 *
 * ═══ THE ORIGIN COMES FROM THE KEY, NEVER FROM THE FRAME ═══
 *
 * The caller names an origin; it is checked against `api_keys.allowed_embed_
 * origins` and stamped onto the credential itself (CG-047). So the signing page
 * learns where it may speak by reading its OWN token, not by being told by the
 * page framing it. A caller who leaks their key still cannot aim signing events
 * at an origin the key's owner never registered — and a key that registered no
 * origins at all is refused outright, because an empty allowlist is the answer
 * "this key was never enabled for embedding", not "any origin will do".
 *
 * ═══ WHAT THIS ENDPOINT REFUSES ═══
 *
 * A recipient who is not at the current signing order, has already signed or
 * declined, or is a CC observer. All of those would produce a URL that renders a
 * "you cannot sign this" screen inside the integrator's iframe — a working link
 * to a dead end, which is worse than an error at the point of the call, where the
 * integrator can still do something about it.
 */

import { jsonResponse } from "../_shared/http.ts";
import { ApiAuthError, resolveApiClient, serveApiFunction } from "../_shared/apiAuth.ts";
import { loadEnvelopeForSender, logSenderEvent } from "../_shared/senderAuth.ts";
import { getSignerPortalUrl } from "../_shared/envelopeNotify.ts";
import { isOriginAllowed, normalizeOrigin } from "../_shared/embedOrigin.ts";

/** Fifteen minutes. Long enough to read a contract, short enough to be a session. */
const DEFAULT_TTL_SECONDS = 900;
/** Mirrored in `signer_token_issue_embed`, which clamps independently. */
const MAX_TTL_SECONDS = 3600;
const MIN_TTL_SECONDS = 60;

serveApiFunction("api_envelopes_embed-url", async (body, req) => {
    const ctx = await resolveApiClient(req, String(body.organization_id ?? ""), "send_documents");

    // ─── The origin, before anything else ────────────────────────────────────
    // Checked first because it is the only precondition that is a property of the
    // KEY rather than of the document. A key with no registered origins cannot
    // produce a usable embed URL for any envelope, so discovering that after
    // three queries would be work done to reach a refusal already known.
    const requestedOrigin = typeof body.origin === "string" ? body.origin : "";
    if (!requestedOrigin) {
        throw new ApiAuthError(
            400,
            "invalid_request",
            "origin is required — an embedded session must know which origin it may report to"
        );
    }
    if (ctx.allowedEmbedOrigins.length === 0) {
        throw new ApiAuthError(
            403,
            "embed_not_enabled",
            "This API key has no registered embed origins. Add them to the key before requesting an embed URL."
        );
    }
    if (!isOriginAllowed(requestedOrigin, ctx.allowedEmbedOrigins)) {
        // NAMED, unlike an authentication refusal. By this point the caller has
        // proved it holds a live credential for this organization, so it is
        // entitled to know that its own configuration is the problem — and it
        // cannot learn anything about anyone else from being told which of the
        // origins IT registered it failed to match.
        throw new ApiAuthError(
            403,
            "origin_not_allowed",
            `${requestedOrigin} is not one of this key's registered embed origins`
        );
    }
    // Non-null: `isOriginAllowed` returned true, which required it to normalize.
    const origin = normalizeOrigin(requestedOrigin)!;

    // ─── The document ────────────────────────────────────────────────────────
    const envelope = await loadEnvelopeForSender(ctx, String(body.envelope_id ?? ""));

    if (envelope.status !== "in_progress") {
        throw new ApiAuthError(
            409,
            "invalid_status",
            `This document is ${envelope.status}; only a document in progress can be signed.`
        );
    }

    // ─── The recipient ───────────────────────────────────────────────────────
    const signerId = typeof body.signer_id === "string" ? body.signer_id.trim() : "";
    const signerEmail = typeof body.signer_email === "string" ? body.signer_email.trim() : "";
    if (!signerId && !signerEmail) {
        throw new ApiAuthError(
            400,
            "invalid_request",
            "one of signer_id or signer_email is required"
        );
    }

    const { data: signers, error: signersError } = await ctx.admin
        .from("signature_request_signers")
        // ONE STRING LITERAL — a concatenation degrades the inferred row type to
        // `GenericStringError` and every field access below becomes an error.
        .select("id, recipient_type, signer_order, signer_name, signer_email, status")
        .eq("request_id", envelope.id);

    if (signersError) {
        console.error("api_envelopes_embed-url: recipients lookup failed:", signersError);
        throw new ApiAuthError(500, "internal_error", "Could not load the recipients");
    }

    // Email is matched case-insensitively, exactly as `assertSignerAccount` does
    // server-side. An integrator storing an address in a different case from the
    // one the envelope was sent with is not a different person.
    const wanted = signerEmail.toLowerCase();
    const matches = (signers ?? []).filter((s) =>
        signerId ? s.id === signerId : s.signer_email.trim().toLowerCase() === wanted
    );

    if (matches.length === 0) {
        throw new ApiAuthError(404, "not_found", "No such recipient on this document");
    }
    // Two recipients can legitimately share an address on one envelope — a person
    // signing in two capacities. Refusing beats guessing: minting for the wrong
    // one of the two produces a pane that signs the wrong role's fields.
    if (matches.length > 1) {
        throw new ApiAuthError(
            409,
            "ambiguous_recipient",
            "That address appears more than once on this document. Use signer_id instead."
        );
    }

    const signer = matches[0];

    if (signer.recipient_type !== "signer") {
        throw new ApiAuthError(
            409,
            "not_a_signer",
            "That recipient is a copy observer and is not asked to sign."
        );
    }
    if (signer.status === "signed") {
        throw new ApiAuthError(409, "already_signed", "That recipient has already signed.");
    }
    if (signer.status === "declined") {
        throw new ApiAuthError(409, "already_declined", "That recipient declined to sign.");
    }
    if (signer.signer_order !== envelope.current_order) {
        // The same fact `Page_Sign` renders as "Not your turn yet", surfaced at
        // the point where an integrator can act on it rather than after they have
        // already put an iframe on a page.
        throw new ApiAuthError(
            409,
            "not_their_turn",
            "This document is being signed in order and has not reached that recipient yet."
        );
    }

    // ─── Mint ────────────────────────────────────────────────────────────────
    const requestedTtl = Number(body.ttl_seconds);
    const ttlSeconds = Number.isFinite(requestedTtl)
        ? Math.min(Math.max(Math.trunc(requestedTtl), MIN_TTL_SECONDS), MAX_TTL_SECONDS)
        : DEFAULT_TTL_SECONDS;

    // ⚠ NEVER `.maybeSingle()` HERE. `signer_token_issue_embed` WRITES, and
    // PostgREST answers 406 on zero rows by ROLLING THE TRANSACTION BACK —
    // discarding the insert — while supabase-js swallows the whole thing into
    // `{data: null, error: null}` (CG-043). The array form is the only safe
    // shape for an RPC with a side effect.
    const { data: issuedRows, error: issueError } = await ctx.admin.rpc(
        "signer_token_issue_embed",
        {
            p_signer_id: signer.id,
            p_origin: origin,
            p_ttl_seconds: ttlSeconds,
            p_max_uses: 3,
        }
    );

    if (issueError) {
        console.error("api_envelopes_embed-url: token issue failed:", issueError);
        throw new ApiAuthError(500, "internal_error", "Could not create the signing session");
    }

    const issued = Array.isArray(issuedRows) ? issuedRows[0] : null;
    if (!issued?.token) {
        console.error("api_envelopes_embed-url: token issue returned no row");
        throw new ApiAuthError(500, "internal_error", "Could not create the signing session");
    }

    // Same event type an emailed link produces, because it is the same fact: a
    // credential now exists for this recipient. `via` is what tells a reader of
    // the trail which door it came out of, and it is the only difference.
    //
    // The token id is recorded and the token itself never is — the plaintext
    // exists exactly once, in this response.
    await logSenderEvent(ctx, {
        envelopeId: envelope.id,
        signerId: signer.id,
        eventType: "signer_token_issued",
        payload: {
            via: "embed",
            token_id: issued.token_id,
            purpose: "sign",
            expires_at: issued.expires_at,
            ttl_seconds: ttlSeconds,
            max_uses: 3,
            embed_origin: origin,
        },
    });

    // `/embed/sign/{token}`, NOT `/sign/{token}`. The two routes render the same
    // ceremony and differ in chrome and in framing policy: `/embed/*` is the only
    // path `public/_headers` permits to be framed at all.
    const base = getSignerPortalUrl().replace(/\/+$/, "");

    return jsonResponse(
        {
            url: `${base}/embed/sign/${issued.token}`,
            expires_at: issued.expires_at,
            expires_in_seconds: ttlSeconds,
            signer_id: signer.id,
            embed_origin: origin,
        },
        201
    );
});
