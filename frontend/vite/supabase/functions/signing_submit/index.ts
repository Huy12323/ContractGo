/**
 * signing_submit — the signer commits.
 *
 * PUBLIC (`verify_jwt = false`); `resolveSignerToken` is the mandatory first
 * statement, `assertCanAct` the second and `assertSignerIdentity` the third.
 *
 * `verify_jwt` stays off because the token, not the JWT, is what identifies WHICH
 * signer is calling — the platform check would only prove that some session
 * exists, which is the less interesting half. The session is verified inside
 * `assertSignerIdentity` instead, where it can be matched against the signer this
 * particular link belongs to. Since CG-031 there may be no session at all: on an
 * `email_otp` envelope the identity proof is a passcode redeemed against the
 * token, and `verify_jwt = true` would have rejected those callers at the door.
 *
 * ORDER OF OPERATIONS, and why it is this order:
 *
 *   1. validate    — against the SNAPSHOT, never the live template. The signer
 *                    agreed to what they were sent.
 *   2. store       — signature image and field values land BEFORE the turn is
 *                    claimed, so a failed upload leaves the signer able to
 *                    retry with nothing consumed.
 *   3. claim       — `signature_claim_turn`, one statement asserting "in
 *                    flight, my order, not yet signed" and writing the result.
 *                    Two signers racing cannot both win; a check-then-write in
 *                    TypeScript would let them.
 *   4. capture     — write-once row. If it fails, `signature_release_turn`
 *                    hands the turn back (and refuses to if a capture somehow
 *                    exists, so a real signature is never silently undone).
 *   5. advance     — `signature_advance_after_signature`, one statement under a
 *                    row lock deciding hold / next order / finalize. Parallel
 *                    signers at one order serialize here and exactly one is
 *                    told to act; the others are told `superseded`.
 *   6. finalize    — burn, hash, store, complete. Only after the last signer,
 *                    and only for the caller holding step 5's claim. If it
 *                    fails, `signature_release_finalize` hands the claim back.
 *
 * Steps 3–6 are not one database transaction: PostgREST gives each call its
 * own. Each step that could be raced is therefore a single SQL statement or a
 * locked function rather than a read-decide-write in TypeScript, and each has a
 * compensating action for the gap that follows it — step 4's
 * `signature_release_turn`, step 5's `signature_release_finalize`. Everything
 * else is forward-recoverable, and every one of them is on the audit chain.
 */

import {
    assertCanAct,
    assertSignerIdentity,
    jsonResponse,
    logSignerEvent,
    resolveSignerToken,
    servePublicSigningFunction,
    SignerAuthError,
    type SignerContext,
} from "../_shared/signerAuth.ts";
import { signatureMethodOf } from "../_shared/auditEvidence.ts";
import { getStorageDriver } from "../_shared/storage.ts";
import { burnPdfDocument, FONT_R2_KEY, type SnapshotField } from "../_shared/pdfBurn.ts";
import type { Rpc_SignerTokenIssue } from "../_shared/rpcRows.ts";
import { notifyCcRecipients, notifySignersAtOrder } from "../_shared/envelopeNotify.ts";
import { notifyEnvelopeSender } from "../_shared/notify.ts";
import { getSignatureDriver } from "../_shared/signing.ts";

type Snapshot = {
    layout?: SnapshotField[];
    pdf_file_path?: string | null;
};

servePublicSigningFunction("signing_submit", async (body, req) => {
    const ctx = await resolveSignerToken(req, body);
    await assertCanAct(ctx);
    // THIRD, and before a single byte is validated or stored: the act has to come
    // from the person the document names, not merely from whoever holds the link.
    // WHICH PROOF that takes is the sender's choice, pinned on the request — a
    // session on their own address, or a passcode emailed to it (CG-031). It
    // follows `assertCanAct` so a signer whose turn has passed is told that
    // rather than being sent to prove an identity that would not have helped.
    await assertSignerIdentity(ctx, req);

    const fieldValues = (body.field_values ?? {}) as Record<string, unknown>;
    const signatureBase64 = body.signature_base64;
    const captureMethod = body.capture_method;

    // Consent is a legal precondition, not a UI nicety: an electronic signature
    // is only binding if the signer agreed to sign electronically, and that
    // agreement has to be recorded as evidence rather than assumed.
    if (body.consent_accepted !== true) {
        throw new SignerAuthError(400, "You must agree to sign electronically.");
    }

    const snapshot = (ctx.request.template_snapshot ?? {}) as Snapshot;
    const layout = Array.isArray(snapshot.layout) ? snapshot.layout : [];
    const myFields = layout.filter((f) => f.role_id === ctx.signer.role_id);
    const mySignatureFields = myFields.filter(
        (f) => f.type === "signature" || f.type === "initials"
    );

    // Only this signer's own fields are writable. Values offered for anyone
    // else's fields are dropped rather than rejected — a stale client sending a
    // co-signer's prefilled value should not fail an otherwise valid signature,
    // but it must not be able to overwrite it either.
    const writableIds = new Set(
        myFields.filter((f) => f.type !== "signature" && f.type !== "initials").map((f) => f.id)
    );
    const acceptedValues = Object.fromEntries(
        Object.entries(fieldValues).filter(([id]) => writableIds.has(id))
    );

    const isMeaningful = (v: unknown) => v !== undefined && v !== null && v !== "" && v !== false;

    const missing = myFields
        .filter((f) => f.required)
        .filter((f) =>
            f.type === "signature" || f.type === "initials"
                ? typeof signatureBase64 !== "string" || !signatureBase64
                : !isMeaningful(acceptedValues[f.id])
        )
        .map((f) => ({ id: f.id, label: f.label }));

    if (missing.length > 0) {
        return jsonResponse(
            { error: "Some required fields are still empty.", missing_fields: missing },
            400
        );
    }

    if (mySignatureFields.length > 0 && typeof signatureBase64 !== "string") {
        throw new SignerAuthError(400, "A signature is required.");
    }

    const storage = getStorageDriver();

    // ---- 2. store ------------------------------------------------------
    let signatureKey: string | null = null;
    let signatureSha256: string | null = null;

    if (typeof signatureBase64 === "string" && signatureBase64) {
        const signatureBytes = decodeBase64Image(signatureBase64);
        signatureSha256 = await sha256Bytes(signatureBytes);
        // Timestamped key: a re-signature after a request-changes loop writes a
        // fresh object rather than overwriting evidence of the earlier one.
        signatureKey =
            `orgs/${ctx.request.organization_id}/signature-requests/${ctx.request.id}` +
            `/signers/${ctx.signer.id}/signature-${Date.now()}.png`;
        await storage.putObject({
            key: signatureKey,
            body: signatureBytes,
            contentType: "image/png",
        });
    }

    const { error: valuesError } = await ctx.admin
        .from("signature_request_signers")
        .update({ field_values: { ...(ctx.signer.field_values ?? {}), ...acceptedValues } })
        .eq("id", ctx.signer.id);

    if (valuesError) {
        console.error("Failed to persist field values:", valuesError);
        throw new SignerAuthError(500, "Could not save your entries. Please try again.");
    }
    await logSignerEvent(ctx, "signer_fields_saved", {
        field_ids: Object.keys(acceptedValues),
    });

    // ---- 3. claim ------------------------------------------------------
    const { data: claimed, error: claimError } = await ctx.admin.rpc("signature_claim_turn", {
        p_request_id: ctx.request.id,
        p_signer_id: ctx.signer.id,
    });

    if (claimError) {
        console.error("signature_claim_turn failed:", claimError);
        throw new SignerAuthError(500, "Could not record your signature. Please try again.");
    }
    if (claimed !== true) {
        // Lost the race, or the request moved underneath us. Not an error the
        // signer can fix by retrying — re-open the link to see current state.
        throw new SignerAuthError(
            409,
            "This document has changed since you opened it. Please reload the page."
        );
    }

    // ---- 4. capture ----------------------------------------------------
    if (signatureKey && signatureSha256) {
        const { error: captureError } = await ctx.admin.from("signature_captures").insert({
            signer_id: ctx.signer.id,
            request_id: ctx.request.id,
            // ALWAYS NULL. On an `email_otp` envelope there is no account to
            // record in the first place; on an `account` one there is, and it
            // still does not go here — the guard trigger requires this to equal
            // `signature_request_signers.signer_user_id`, which `envelopes_send`
            // writes as NULL for every external recipient (CG-011), so writing
            // the real id would raise on a signature that is otherwise valid.
            // Whatever identity was proved is recorded where it belongs — on the
            // audit chain, as `actor.user_id` and an `app_session` or `otp`
            // method.
            signer_user_id: null,
            signature_r2_key: signatureKey,
            signature_sha256: signatureSha256,
            capture_method: normalizeCaptureMethod(captureMethod),
            captured_ip: ctx.ip,
            captured_user_agent: ctx.userAgent,
        });

        if (captureError) {
            console.error("Capture insert failed, releasing turn:", captureError);
            await ctx.admin.rpc("signature_release_turn", {
                p_request_id: ctx.request.id,
                p_signer_id: ctx.signer.id,
            });
            throw new SignerAuthError(500, "Could not record your signature. Please try again.");
        }
    }

    await logSignerEvent(
        ctx,
        "signer_signed",
        {
            signature_sha256: signatureSha256,
            signature_r2_key: signatureKey,
            capture_method: normalizeCaptureMethod(captureMethod),
            field_ids: Object.keys(acceptedValues),
        },
        {
            // The mark's provenance is part of how this person authenticated the
            // act, not just a property of the image: "drew it" and "uploaded a
            // picture of it" are different evidentiary claims. Omitted entirely
            // when there is no mark — a witness role with no signature box
            // authenticated by the link alone, and listing a signature method
            // would overstate what happened.
            methods: signatureKey
                ? [signatureMethodOf(normalizeCaptureMethod(captureMethod))!]
                : [],
        }
    );

    // ---- 5. advance ----------------------------------------------------
    // One call, one transaction, one decision. This used to read the siblings,
    // conclude in TypeScript whether the batch was done, and then write — three
    // PostgREST calls, three transactions. CG-011 removed the unique key on
    // (request_id, signer_order) that had been keeping every batch at size 1,
    // which is what made that read-decide-write reachable: two parallel signers
    // could each observe the other `signed` and each finalize, burning the
    // document twice and appending `request_completed` to the hash chain twice.
    //
    // `signature_advance_after_signature` locks the request row, so exactly one
    // caller receives `advanced` or `finalize` and the rest receive `superseded`.
    const { data: advanceRows, error: advanceError } = await ctx.admin.rpc(
        "signature_advance_after_signature",
        { p_request_id: ctx.request.id, p_signer_id: ctx.signer.id }
    );

    const advance = Array.isArray(advanceRows) ? advanceRows[0] : advanceRows;

    if (advanceError || !advance) {
        console.error("signature_advance_after_signature failed:", advanceError);
        // The signature IS recorded — reporting failure here would invite a
        // duplicate submit. Routing is recoverable by the sender or by cron.
        return jsonResponse({ status: "signed", completed: false }, 200);
    }

    await ctx.admin.rpc("signer_token_consume", { p_token_id: ctx.tokenId });

    // A CREDENTIAL FOR THE RECEIPT, minted because the line above just killed the
    // one this request arrived on.
    //
    // Without it the signer has no way to take a copy of what they just signed:
    // `signer_token_redeem` requires `consumed_at IS NULL`, so every further call
    // on their link — including a download — is refused the moment the signature
    // lands. That is why closing the tab used to mean waiting for the completion
    // email or asking the sender to send the file.
    //
    // NOT A NEW GRANT, and deliberately the narrowest one that works. It is
    // `view`, so `assertCanAct` refuses it for any acting path; it is short-lived;
    // and it is handed to the party who has just proved, to whatever standard the
    // sender demanded, that they are the person the document names. They could
    // read this document a second ago. The only thing that changes is that they
    // no longer have to have kept the tab open.
    const downloadToken = await issueDownloadToken(ctx);

    // CG-018, app-only: nothing emails the sender when a party signs, so before
    // the bell existed "who has signed so far" was a page they had to go and
    // refresh. Raised on every outcome because the signature is recorded on
    // every outcome — including `superseded`, where the loser of a parallel
    // batch signed just as validly as the winner. Never throws (see notify.ts),
    // so it needs no try/catch of its own.
    await notifyEnvelopeSender({
        admin: ctx.admin,
        requestId: ctx.request.id,
        organizationId: ctx.request.organization_id,
        type: "envelope_signed_by_party",
        title: `${ctx.signer.signer_name} signed ${ctx.request.title}`,
        body: null,
        metadata: { signer_email: ctx.signer.signer_email, signer_order: ctx.signer.signer_order },
    });

    switch (advance.outcome) {
        case "advanced":
            // Hand the baton on: mint the next party's credential and mail it.
            // Phase G deferred this because nothing minted tokens yet; Phase H's
            // `_shared/envelopeNotify.ts` is the same code `envelopes_send`
            // runs, so "sent to the first signer" and "advanced to the second"
            // produce an identical email and an identical pair of audit entries.
            //
            // AFTER the token is consumed and never before: this signer's
            // signature is already recorded and must not depend on the next
            // one's mail server.
            await notifyNextOrder(ctx, advance.next_order);
            return jsonResponse(
                { status: "signed", completed: false, download_token: downloadToken },
                200
            );

        // ---- 6. finalize -----------------------------------------------
        case "finalize": {
            // The burn fetches a PDF and a font from object storage and renders
            // them; any of that can throw, and an uncaught throw here would
            // strand the claim as surely as a `false` would.
            const finalized = await finalizeRequest(ctx, layout, snapshot).catch((err) => {
                console.error("Finalize threw:", err);
                return false;
            });

            if (!finalized) {
                // The claim is held but unused, and `current_order` is parked
                // past the last signer where nobody can act. Hand it back so a
                // resend or a retry can claim it again, rather than leaving the
                // request in flight with no reachable next step.
                await ctx.admin.rpc("signature_release_finalize", {
                    p_request_id: ctx.request.id,
                    p_signer_id: ctx.signer.id,
                });
                return jsonResponse(
                    { status: "signed", completed: false, download_token: downloadToken },
                    200
                );
            }

            return jsonResponse(
                { status: "signed", completed: true, download_token: downloadToken },
                200
            );
        }

        // `superseded` is the ordinary outcome for the loser of a parallel
        // batch, not an error: their signature is recorded and a co-signer is
        // carrying the routing forward. `waiting` means the batch is still
        // open. Both look identical to this signer, and should.
        default:
            return jsonResponse(
                { status: "signed", completed: false, download_token: downloadToken },
                200
            );
    }
});

/**
 * The short-lived `view` credential the receipt downloads with.
 *
 * ONE HOUR, which is the floor `signer_token_issue` can express (its TTL is in
 * whole hours) and comfortably longer than the seconds between "your signature
 * has been recorded" and a click on Download. A credential returned in a response
 * body should outlive the page that received it by as little as possible.
 *
 * NEVER THROWS. A receipt that cannot offer a download still has to render — the
 * signature is recorded and the routing has already moved on, and failing the
 * submit here would tell the signer their signature failed when it did not. The
 * client treats a null token as "no download offer" and says so.
 *
 * `signer_token_issue` revokes any other live `view` token for this signer, which
 * is the behaviour we want: the newest copy link is the only one that works.
 */
async function issueDownloadToken(ctx: SignerContext): Promise<string | null> {
    const { data: issued, error } = await ctx.admin
        .rpc("signer_token_issue", {
            p_signer_id: ctx.signer.id,
            p_purpose: "view",
            p_ttl_hours: 1,
        })
        .maybeSingle<Rpc_SignerTokenIssue>();

    if (error || !issued?.token) {
        console.error("signing_submit: could not issue a download token:", error);
        return null;
    }

    // The token ID, never the token — the same discipline the mail path follows.
    // That a credential was minted, for whom, and why is exactly the kind of fact
    // the trail exists to hold.
    await logSignerEvent(ctx, "signer_token_issued", {
        token_id: issued.token_id,
        purpose: "view",
        reason: "post_signature_copy",
    });

    return issued.token;
}

/**
 * Emails the next order's parties their signing links.
 *
 * Never throws. The current signer's submission is complete and acknowledged by
 * the time this runs; a mail failure here is the sender's problem to resend, not
 * a reason to tell someone who just signed that their signature failed.
 */
async function notifyNextOrder(ctx: SignerContext, nextOrder: number): Promise<void> {
    try {
        const { data: org } = await ctx.admin
            .from("organizations")
            .select("name")
            .eq("id", ctx.request.organization_id)
            .maybeSingle();

        await notifySignersAtOrder({
            admin: ctx.admin,
            requestId: ctx.request.id,
            organizationId: ctx.request.organization_id,
            organizationName: org?.name ?? "ContractGo",
            documentTitle: ctx.request.title,
            order: nextOrder,
            // No `auth.users` row — routing advanced as a consequence of an
            // external signer's action, and the signer id is already on the
            // preceding `signer_signed` entry.
            actorUserId: null,
            // What that makes the performer of the resulting `signer_notified`
            // entries: the routing rule, not the person who signed. They asked to
            // sign, not to email the next party (CG-016).
            systemTask: "routing_advance_after_signature",
        });
    } catch (err) {
        console.error("Notifying the next order failed:", err);
    }
}

/**
 * Last signer done: burn every signer's marks onto the source PDF, hash it,
 * store it, and close the request.
 *
 * The burn is deliberately NOT incremental — it renders the whole document from
 * the snapshot and the accumulated values in one pass, so the finished artifact
 * is a pure function of evidence that is all on the audit chain. Burning each
 * signature as it arrives would make the final PDF depend on the order the
 * writes happened to land in.
 *
 * Cryptographic signing (`_shared/pades.ts`, behind the driver seam) consumes
 * this flattened output and lands in Phase I, when `_shared/signing.ts` exists.
 * Until then the document carries hashes and the audit chain but no `/Sig`
 * dictionary — which is why the mock driver's provenance must be surfaced in
 * the UI (plan risk 6) rather than left implicit.
 *
 * Returns whether the request actually reached `completed`. The caller holds an
 * exclusive finalize claim while this runs (CG-012) and must release it if this
 * returns false, so every early exit below has to be distinguishable from
 * success — which is why this no longer returns void.
 */
async function finalizeRequest(
    ctx: SignerContext,
    layout: SnapshotField[],
    snapshot: Snapshot
): Promise<boolean> {
    const storage = getStorageDriver();

    const { data: allSigners, error: signersError } = await ctx.admin
        .from("signature_request_signers")
        .select("id, role_id, field_values")
        .eq("request_id", ctx.request.id);

    if (signersError || !allSigners) {
        console.error("Finalize: could not load signers:", signersError);
        return false;
    }

    // LIVE captures only. CG-014 keeps a superseded capture rather than deleting
    // it — a signature that was genuinely made is evidence even after it is
    // replaced — so a signer who went through the review loop has two rows here.
    // Without this filter the burn would pick whichever came back first and stamp
    // a REPLACED signature onto the final document, then hash that document and
    // record the hash as the completed agreement. The partial unique index
    // guarantees at most one live row per signer, which is what makes the
    // `signer_id` keying below unambiguous again.
    const { data: captures, error: capturesError } = await ctx.admin
        .from("signature_captures")
        .select("signer_id, signature_r2_key")
        .eq("request_id", ctx.request.id)
        .is("superseded_at", null);

    if (capturesError) {
        console.error("Finalize: could not load captures:", capturesError);
        return false;
    }

    // The sender's compose-time entries (CG-007) are the base layer, then every
    // signer's own values on top. No layer can overwrite another in practice —
    // each party may only write field ids belonging to their own role, which
    // `signing_submit` enforces above and the sender role has no signer for —
    // so the merge is a union, and the ordering only fixes what would happen if
    // a template were ever edited into an overlap.
    const mergedValues = allSigners.reduce<Record<string, unknown>>(
        (acc, signer) => ({ ...acc, ...((signer.field_values ?? {}) as object) }),
        { ...((ctx.request.prefilled_values ?? {}) as Record<string, unknown>) }
    );

    // Each capture belongs to one signer, and therefore to that signer's role's
    // signature boxes — never to another role's.
    const roleBySignerId = new Map(allSigners.map((s) => [s.id, s.role_id]));
    const signatureImages: Record<string, Uint8Array> = {};
    for (const capture of captures ?? []) {
        const roleId = roleBySignerId.get(capture.signer_id);
        if (!roleId) continue;
        const bytes = await storage.getObject(capture.signature_r2_key);
        for (const field of layout) {
            if (
                field.role_id === roleId &&
                (field.type === "signature" || field.type === "initials")
            ) {
                signatureImages[field.id] = bytes;
            }
        }
    }

    const sourceKey = snapshot.pdf_file_path || ctx.request.source_pdf_r2_key;
    const [sourcePdfBytes, fontBytes] = await Promise.all([
        storage.getObject(sourceKey),
        storage.getObject(FONT_R2_KEY),
    ]);

    const burned = await burnPdfDocument({
        sourcePdfBytes,
        fontBytes,
        layout,
        fieldValues: mergedValues,
        signatureImages,
    });

    // The burned artifact is hashed and logged BEFORE any cryptographic signing,
    // and that ordering is deliberate. `document_burned` records the flattened
    // document — the thing every party actually saw and agreed to — and a
    // signature is a statement ABOUT those bytes. If signing fails, the chain
    // still contains the digest of what was agreed.
    const burnedSha256 = await sha256Bytes(burned);
    await logSignerEvent(ctx, "document_burned", {
        signed_pdf_sha256: burnedSha256,
        source_pdf_sha256: ctx.request.source_pdf_sha256,
    });

    // ---- cryptographic signing (driver seam) ----------------------------
    // Phase G deferred this: "`signing_submit` burns, hashes, stores and
    // completes; it does not yet call `signPdf`." `_shared/signing.ts` now
    // exists, so it does.
    //
    // A signing failure does NOT fail the completion. The document is burned,
    // every signature is captured, and the audit chain is intact — refusing to
    // complete because a certificate authority was unreachable would strand a
    // finished agreement over a property it never had before this phase.
    const { signedBytes, signedSha256, signatureMeta } = await signBurnedDocument(
        ctx,
        burned,
        burnedSha256
    );

    const signedKey = `orgs/${ctx.request.organization_id}/signature-requests/${ctx.request.id}/signed.pdf`;

    await storage.putObject({
        key: signedKey,
        body: signedBytes,
        contentType: "application/pdf",
    });

    if (signatureMeta) {
        await logSignerEvent(
            ctx,
            "document_signed",
            {
                ...signatureMeta,
                signed_pdf_sha256: signedSha256,
                signed_pdf_r2_key: signedKey,
            },
            {
                // The CA signature, stated in the authentication block as well as
                // in the payload's driver metadata. The payload says what the
                // driver did; this says which verification method the document
                // now carries, in the same vocabulary as `otp` and `ekyc`, so
                // "which methods were used on this envelope" is one question over
                // one field rather than three shapes to reconcile.
                //
                // `self_signed` travels with it deliberately: the mock driver's
                // certificate is not a CA's, and an audit block that called it
                // one would be the single most misleading field in the product.
                methods: ["ca_digital_signature"],
                ca_signature: {
                    provider: String(signatureMeta.provider ?? "unknown"),
                    certificate_subject:
                        (signatureMeta.certificate_subject as string | null) ?? null,
                    certificate_serial: (signatureMeta.certificate_serial as string | null) ?? null,
                    self_signed: (signatureMeta.certificate_self_signed as boolean | null) ?? null,
                },
            }
        );
    }

    // The CHECK constraint `signature_requests_completed_has_pdf` refuses a
    // completed row without both of these, so this single UPDATE either records
    // a verifiable completion or none at all.
    const { error: completeError } = await ctx.admin
        .from("signature_requests")
        .update({
            status: "completed",
            signed_pdf_r2_key: signedKey,
            signed_pdf_sha256: signedSha256,
            completed_at: new Date().toISOString(),
        })
        .eq("id", ctx.request.id);

    if (completeError) {
        console.error("Finalize: could not complete request:", completeError);
        return false;
    }

    await logSignerEvent(ctx, "request_completed", {
        signed_pdf_sha256: signedSha256,
    });

    // The observers' copy, and the reason CC defaults to notify-on-completion:
    // this is the moment there is a finished artifact to observe. Exactly one
    // caller reaches here — the CG-012 finalize claim guarantees it — so the
    // copies cannot be sent twice by a parallel batch.
    //
    // After the completion is committed and after the chain entry, never before.
    // A mail provider outage must not be able to leave a document that every
    // party signed sitting un-completed.
    await notifyCcObservers(ctx);

    // CG-018. A separate row from the `envelope_signed_by_party` above rather
    // than a replacement for it: "the last party signed" and "the document is
    // finished and there is a signed artifact" are two different facts, and only
    // the second one is reached after the burn actually succeeded.
    await notifyEnvelopeSender({
        admin: ctx.admin,
        requestId: ctx.request.id,
        organizationId: ctx.request.organization_id,
        type: "envelope_completed",
        title: `${ctx.request.title} is fully signed`,
        body: "Every party has signed. The completed document is ready to download.",
        metadata: { signed_pdf_sha256: signedSha256 },
    });

    return true;
}

/**
 * Copies the CC observers on the finished document.
 *
 * Never throws, for the same reason `notifyNextOrder` does not: the request is
 * completed and recorded by the time this runs, and a failed copy is a delivery
 * the sender can retry — not a reason to tell the last signer their signature
 * failed, or to hand back a finalize claim whose work is already done.
 */
async function notifyCcObservers(ctx: SignerContext): Promise<void> {
    try {
        const { data: org } = await ctx.admin
            .from("organizations")
            .select("name")
            .eq("id", ctx.request.organization_id)
            .maybeSingle();

        await notifyCcRecipients({
            admin: ctx.admin,
            requestId: ctx.request.id,
            organizationId: ctx.request.organization_id,
            organizationName: org?.name ?? "ContractGo",
            documentTitle: ctx.request.title,
            stage: "completed",
            actorUserId: null,
            systemTask: "completion_cc_distribution",
        });
    } catch (err) {
        console.error("Notifying the CC observers failed:", err);
    }
}

/**
 * Runs the burned document through the configured signature driver.
 *
 * Returns the ORIGINAL bytes unchanged if signing fails, so the caller stores a
 * valid — if uncertified — PDF either way. The distinction is recorded: a
 * `document_signed` event exists only when a signature was actually produced,
 * so "was this document cryptographically signed" is answerable from the chain
 * rather than inferred from the absence of an error.
 */
async function signBurnedDocument(
    ctx: SignerContext,
    burned: Uint8Array,
    burnedSha256: string
): Promise<{
    signedBytes: Uint8Array;
    signedSha256: string;
    signatureMeta: Record<string, unknown> | null;
}> {
    try {
        const driver = await getSignatureDriver();

        // The signer whose submission triggered finalization is the one named in
        // the signature panel. With multiple parties no single name is complete,
        // which is what the Certificate of Completion (v1.3) exists to express —
        // the /Sig dictionary has room for one.
        const result = await driver.signPdf({
            pdfBytes: burned,
            signer: {
                name: ctx.signer.signer_name,
                email: ctx.signer.signer_email,
                reason: `Signed via ContractGo — ${ctx.request.title}`,
            },
        });

        return {
            signedBytes: result.signedPdfBytes,
            signedSha256: result.signedDocumentHash,
            signatureMeta: {
                provider: result.provider,
                legally_binding: driver.legallyBinding,
                pades_level: result.achievedLevel,
                ltv_status: result.ltvStatus,
                byte_range: result.byteRange,
                certificate_subject: result.certificate.subject,
                certificate_serial: result.certificate.serialNumber,
                certificate_self_signed: result.certificate.selfSigned,
                burned_pdf_sha256: burnedSha256,
            },
        };
    } catch (err) {
        console.error("Cryptographic signing failed; storing the burned PDF unsigned:", err);
        return { signedBytes: burned, signedSha256: burnedSha256, signatureMeta: null };
    }
}

// ============================================================
// Helpers
// ============================================================

function decodeBase64Image(dataUrl: string): Uint8Array {
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
    const raw = match ? match[2]! : dataUrl;
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
    // See `_shared/http.ts` — `BufferSource` narrowed in TypeScript 5.7 and no
    // longer admits a plain `Uint8Array`. Type-level only.
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/** Unknown provenance is recorded as `drawn` rather than rejected — but the
 *  client is the only source for this, so it is a claim, not a fact. */
function normalizeCaptureMethod(value: unknown): "drawn" | "uploaded" | "typed" {
    return value === "uploaded" || value === "typed" ? value : "drawn";
}
