/**
 * signing_session_open — everything the signer surface needs to render, in one
 * call, for someone who may not have an account yet.
 *
 * READ-ONLY, AND THEREFORE UNGATED. `signing_submit` and `signing_decline`
 * require the caller to be signed in as the signer's own address; this does not,
 * for two reasons. It is what serves the CC observer's read-only link, and those
 * recipients never sign and may have no account at all. And it is what tells the
 * signing page WHICH address to demand — a page that had to be signed in before
 * it could learn whose document it is could only say "sign in", not "sign in as
 * this person".
 *
 * The consequence is deliberate and worth stating: `Page_Sign` refuses to render
 * the document to a signer who is not signed in, but that is a courtesy of the
 * page, not a property of this endpoint. Anyone holding the token can still read
 * this response. Confidentiality here rests on the token; only ACTING rests on
 * the account.
 *
 * PUBLIC: deployed with `verify_jwt = false` (enumerated explicitly in
 * config.toml, never disabled globally). The access token in the POST body is
 * the only credential, and `resolveSignerToken` is the mandatory first
 * statement.
 *
 * This endpoint is deliberately READ-ONLY apart from two side effects that are
 * part of the evidence record: the token's use counter advances (inside
 * `signer_token_redeem`), and a first view flips the signer to `viewed` and
 * appends `signer_viewed` to the hash chain. It never consumes the token — a
 * signer legitimately opens the link, reads, closes it and comes back.
 *
 * Fields come from `signature_requests.template_snapshot`, filtered by the
 * signer's `role_id` — never from `contract_templates`. The template may have
 * been edited or hard-deleted since the request was sent; what the signer is
 * shown must be what they were sent (AHR-1487/1490/1954).
 */

import {
    isOtpFresh,
    jsonResponse,
    logSignerEvent,
    resolveEffectiveIdentityCheck, // [ekyc]
    resolveEffectiveSignerAuth,
    resolveSignerToken,
    servePublicSigningFunction,
} from "../_shared/signerAuth.ts";
import { getStorageDriver } from "../_shared/storage.ts";
import { getAiDriverName } from "../_shared/ai.ts";

type SnapshotField = {
    id: string;
    key: string;
    label: string;
    type: string;
    role_id: string;
    required: boolean;
    options?: { label: string; value: string }[];
    default_value?: string;
    read_only?: boolean;
    page: number;
    x_pct: number;
    y_pct: number;
    w_pct: number;
    h_pct: number;
};

type Snapshot = {
    type?: string;
    layout?: SnapshotField[];
    pdf_file_path?: string | null;
    signer_roles?: { id: string; name: string; order: number; color: string }[];
};

const PDF_READ_URL_TTL_SECONDS = 60 * 30;

servePublicSigningFunction("signing_session_open", async (body, req) => {
    const ctx = await resolveSignerToken(req, body);

    // First view is a state transition and an audit event; subsequent reloads
    // are neither. The RPC's WHERE clause (status = 'notified') makes the
    // transition idempotent, so `changed` is a reliable "this was the first".
    let firstView = false;
    if (ctx.signer.status === "notified") {
        const { error } = await ctx.admin.rpc("signature_mark_viewed_by_signer", {
            p_signer_id: ctx.signer.id,
        });
        if (error) console.error("signature_mark_viewed_by_signer failed:", error);
        else firstView = true;
    }
    if (firstView) await logSignerEvent(ctx, "signer_viewed");

    const snapshot = (ctx.request.template_snapshot ?? {}) as Snapshot;
    const layout = Array.isArray(snapshot.layout) ? snapshot.layout : [];

    // The signer sees the WHOLE document — hiding other roles' boxes would make
    // the page they are signing differ from the page that gets burned. They can
    // only EDIT their own, which the `editable` flag drives.
    const fields = layout.map((field) => ({
        ...field,
        editable:
            field.role_id === ctx.signer.role_id && !field.read_only && field.type !== "signature",
    }));

    // One organizations read, serving both the CG-049 AI flag and CG-050's
    // branding. See `loadOrgPresentation` — this endpoint is polled, so the
    // number of queries per call is a thing worth counting.
    const presentation = await loadOrgPresentation(ctx);

    const pdfKey = snapshot.pdf_file_path || ctx.request.source_pdf_r2_key;
    const pdfUrl = await getStorageDriver().createReadUrl({
        key: pdfKey,
        expiresIn: PDF_READ_URL_TTL_SECONDS,
        claims: {
            // No auth.users row exists; the signer id is the identity the URL is
            // issued against, and it is what the audit trail records.
            userId: `signer:${ctx.signer.id}`,
            orgId: ctx.request.organization_id,
            resourceId: ctx.request.id,
            resourceType: "envelope_document",
        },
    });

    return jsonResponse(
        {
            request: {
                id: ctx.request.id,
                title: ctx.request.title,
                status: ctx.request.status,
                current_order: ctx.request.current_order,
            },
            signer: {
                id: ctx.signer.id,
                name: ctx.signer.signer_name,
                email: ctx.signer.signer_email,
                role_id: ctx.signer.role_id,
                signer_order: ctx.signer.signer_order,
                status: ctx.signer.status === "notified" ? "viewed" : ctx.signer.status,
                // The sender's own words, shown on the welcome step when a signer
                // returns through the review loop (CG-014). It is what tells them
                // what to do differently, and a re-sign screen that looks
                // identical to the first one is a re-sign that changes nothing.
                //
                // Note the status flip above does NOT apply to
                // `changes_requested`: `signature_mark_viewed_by_signer` only
                // matches `notified`, so a returning signer stays
                // `changes_requested` and the sender's list keeps showing that
                // this turn is a second attempt.
                changes_requested_reason: ctx.signer.changes_requested_reason,
            },
            signer_roles: snapshot.signer_roles ?? [],
            fields,
            // Values already entered by this signer, keyed by field id. Other
            // signers' values are merged in read-only so the document reads as a
            // whole — see the `editable` flag above.
            field_values: ctx.signer.field_values ?? {},
            other_field_values: {
                // The sender's own entries (CG-007) sit UNDER the co-signers'.
                // They are filled first, at compose time, and a signer can only
                // ever write ids belonging to their own role — so the layers
                // cannot actually collide, and this order simply states which
                // one would win if a template were ever edited into overlap.
                ...((ctx.request.prefilled_values ?? {}) as Record<string, unknown>),
                ...(await loadOtherSignerValues(ctx)),
            },
            pdf_url: pdfUrl,
            can_sign: ctx.isMyTurn && ctx.purpose === "sign",
            // CG-031. WHICH proof this document's signers owe, so the page knows
            // which gate to render rather than discovering it by attempting a
            // commit and reading the refusal. Advisory exactly like `can_sign`
            // above: `assertSignerIdentity` is the enforcement, this is the
            // courtesy that stops the surface offering a button the server will
            // refuse.
            // CG-032: resolved per RECIPIENT, so a witness excepted onto
            // `account` is told to sign in while the buyer on the same envelope
            // is offered a passcode. Same key, same two values, same wire shape
            // — the page cannot tell whether the answer came from the request or
            // the signer row, and must not need to.
            auth_requirement: resolveEffectiveSignerAuth(ctx),
            // Whether a passcode has been answered on THIS token recently enough
            // to still count. Computed here rather than sent raw so the page and
            // the server agree on the window — a boolean cannot drift, a
            // timestamp the client re-judges can.
            otp_verified: isOtpFresh(ctx.otpVerifiedAt),
            // [ekyc] CG-033. NESTED rather than four sibling flat keys, and the
            // nesting IS the removal seam: taking eKYC out is deleting one
            // property, not disentangling four from among their neighbours.
            //
            // Advisory exactly like `can_sign` and `auth_requirement` above. The
            // server states what is required and whether it is satisfied; the
            // client never re-judges, and `assertSignerIdentity` remains the
            // enforcement.
            identity_check: await loadIdentityCheck(ctx),
            // CG-047. The ONE origin this session may postMessage its progress
            // to, or null for every emailed credential — which is every token
            // this product issued before v1.4.0 and every one `envelopes_send`
            // issues today.
            //
            // NULL IS SILENCE, NEVER A WILDCARD. The embed bridge emits nothing
            // at all when this is absent, so a page framed by an origin the
            // sender never registered gets no events rather than a broadcast —
            // and `/sign/{token}` opened in an ordinary tab, which is the
            // overwhelming majority of ceremonies, is unaffected.
            //
            // Resolved once by `resolveSignerToken` and simply passed on here.
            // It lives on the context rather than being fetched by this function
            // because the same value also decides what `logSignerEvent` records
            // as the authentication method — an embed credential must not claim
            // `email_link`, which asserts a mailbox was reached.
            // CG-049. Whether to render the AI reading assistant beside the
            // document. Advisory exactly like `can_sign` and `auth_requirement`
            // above — `signer_ai_message_begin` re-checks the org flag and is
            // the authority, because a page that has not reloaded still thinks
            // the feature is on.
            //
            // ABSENT MEANS OFF on the client, the strict default `embed_origin`
            // and `identity_check` already follow.
            assistant_enabled: presentation.assistantEnabled,
            // CG-050. WHO SENT THIS. The signing page carried no sender identity
            // at all before — a counterparty could not tell at a glance whether
            // the contract came from the firm they were expecting, which is both
            // a trust problem and the thing branding exists to fix.
            //
            // ADDITIVE AND ABSENCE-TOLERANT, exactly like `embed_origin`: an
            // older client ignores it and renders as it always did. A
            // PRESENTATION HINT ONLY — `brand_color` must never gate behaviour,
            // and a garbage value must leave the ceremony fully working.
            branding: presentation.branding,
            embed_origin: ctx.embedOrigin,
            // What a party who has ALREADY SIGNED is entitled to read back: the
            // finished document, and the mark they made on it.
            //
            // BOTH ARE NULL FOR MOST CALLS, each for its own reason.
            // `signed_pdf_url` exists only once the LAST signer has signed and
            // the burn has run — before that there is no finished document, and
            // offering the source PDF under that name would call a draft an
            // agreement. `my_signature_url` exists only once THIS signer has
            // signed.
            //
            // Neither is a new grant. The holder of this token can already read
            // the document and already drew the mark; what is new is that they
            // no longer have to have kept the tab open to see either.
            signed_pdf_url: await loadSignedPdfUrl(ctx),
            my_signature_url: await loadMySignatureUrl(ctx),
        },
        200
    );
});

/**
 * The finished, burned PDF — every party's values and marks on the page — for a
 * signer looking back at what they signed.
 *
 * NULL UNTIL THE DOCUMENT IS COMPLETE, and that is the whole rule. The CHECK
 * constraint `signature_requests_completed_has_pdf` ties the key's presence to
 * `status = 'completed'`, so testing the key is testing the status: a missing
 * key means the burn has not run, never that something was lost.
 *
 * The SAME window as `pdf_url` (30 minutes) rather than the tighter one
 * `envelopes_download-signed` uses, because this URL is not handed out on a
 * click — it is already in the response when the receipt renders, and outliving
 * the page the signer is reading is the only thing it has to do.
 */
async function loadSignedPdfUrl(
    ctx: Awaited<ReturnType<typeof resolveSignerToken>>
): Promise<string | null> {
    if (!ctx.request.signed_pdf_r2_key) return null;

    return await getStorageDriver().createReadUrl({
        key: ctx.request.signed_pdf_r2_key,
        expiresIn: PDF_READ_URL_TTL_SECONDS,
        claims: {
            userId: `signer:${ctx.signer.id}`,
            orgId: ctx.request.organization_id,
            resourceId: ctx.request.id,
            resourceType: "envelope_document",
        },
    });
}

/**
 * This signer's own signature image, so a receipt opened in a browser that never
 * ran the ceremony can still show the mark in the boxes it was made for.
 *
 * The ceremony itself needs nothing from here — it is holding the mark in local
 * state. A party returning through `signing_link_for_me` has no such state, and
 * without this their own signature boxes would render as empty dashed outlines
 * on a document they demonstrably signed.
 *
 * `superseded_at IS NULL` is not optional: CG-014 keeps a replaced capture as
 * evidence, and the partial unique index makes exactly one row live per signer.
 * Dropping the filter would let a receipt show a mark that is no longer on the
 * document.
 *
 * THIS SIGNER'S ONLY, never a co-signer's. `FieldBox` previews a mark only in
 * boxes belonging to the signer at the keyboard, so a co-signer's image would
 * have nowhere to render — and the document where every mark does belong is
 * `signed_pdf_url`.
 */
async function loadMySignatureUrl(
    ctx: Awaited<ReturnType<typeof resolveSignerToken>>
): Promise<string | null> {
    const { data: capture, error } = await ctx.admin
        .from("signature_captures")
        .select("signature_r2_key")
        .eq("signer_id", ctx.signer.id)
        .is("superseded_at", null)
        .maybeSingle<{ signature_r2_key: string }>();

    if (error) {
        // A receipt without the mark still says everything else it has to say,
        // so this is logged and swallowed rather than failing the session open.
        console.error("Failed to load signature capture:", error);
        return null;
    }
    if (!capture) return null;

    return await getStorageDriver().createReadUrl({
        key: capture.signature_r2_key,
        expiresIn: PDF_READ_URL_TTL_SECONDS,
        claims: {
            userId: `signer:${ctx.signer.id}`,
            orgId: ctx.request.organization_id,
            resourceId: ctx.signer.id,
            resourceType: "signature_capture",
        },
    });
}

/**
 * [ekyc] What the surface needs to know about this signer's identity check —
 * CG-033.
 *
 * RETURNS `undefined` WHEN NONE IS REQUIRED, so the key is absent from the
 * response for every document that predates CG-033 and every one that does not
 * ask for a check. That absence is what
 * `utils_PageSign_IdentityCheckReady(undefined) === true` reads, and it is the
 * whole additive-safety claim of this arm on the client side.
 *
 * ONE QUERY, and only when the flag is on: this endpoint is polled, and putting
 * an unconditional read here would tax every ceremony for a feature most of them
 * do not use.
 */
async function loadIdentityCheck(ctx: Awaited<ReturnType<typeof resolveSignerToken>>): Promise<
    | {
          required: true;
          satisfied: boolean;
          status: "not_started" | "pending" | "approved" | "rejected" | "expired";
          reason?: string;
      }
    | undefined
> {
    if (!resolveEffectiveIdentityCheck(ctx)) return undefined;

    const { data: row } = await ctx.admin
        .from("signer_identity_checks")
        .select("status, rejection_reason, expires_at")
        .eq("signer_id", ctx.signer.id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle<{
            status: "pending" | "approved" | "rejected";
            rejection_reason: string | null;
            expires_at: string | null;
        }>();

    if (!row) return { required: true, satisfied: false, status: "not_started" };

    const expired = !!row.expires_at && Date.parse(row.expires_at) <= Date.now();

    // An expired PENDING check is an abandoned attempt; an expired APPROVAL is a
    // verdict that has gone stale. Both leave the signer needing to start again,
    // so both read as `expired` — the same collapsing `assertMailboxIdentity`
    // does for "never answered a code" and "answered one an hour ago".
    if (expired) return { required: true, satisfied: false, status: "expired" };

    return {
        required: true,
        satisfied: row.status === "approved",
        status: row.status,
        // Only on a rejection, and it is the vendor's already-truncated text.
        // Never the score.
        reason: row.status === "rejected" ? (row.rejection_reason ?? undefined) : undefined,
    };
}

/**
 * Values entered by the OTHER signers on this request, merged into one map.
 * Read-only context for the current signer: a co-signer's already-entered name
 * or date is part of the document they are agreeing to.
 */
async function loadOtherSignerValues(
    ctx: Awaited<ReturnType<typeof resolveSignerToken>>
): Promise<Record<string, unknown>> {
    const { data, error } = await ctx.admin
        .from("signature_request_signers")
        .select("id, field_values")
        .eq("request_id", ctx.request.id)
        .neq("id", ctx.signer.id);

    if (error) {
        console.error("Failed to load co-signer values:", error);
        return {};
    }

    return (data ?? []).reduce<Record<string, unknown>>(
        (acc, row) => ({ ...acc, ...((row.field_values ?? {}) as object) }),
        {}
    );
}

/**
 * [CG-049] Whether this document's signers get the AI reading assistant.
 *
 * THREE CONDITIONS, AND THE THIRD IS THE INTERESTING ONE:
 *   - the deployment has a driver at all (`AI_DRIVER` is not `off`);
 *   - the sender's organization has not switched it off;
 *   - a previous extraction attempt did not conclude the document is unreadable.
 *
 * That last one is why this is a query rather than a flag. A scanned contract
 * cannot be answered from, and the honest failure is a panel that never appears
 * — not one that appears, accepts a question, and refuses it. A row that does
 * not exist yet is NOT a refusal: nobody has asked, so the panel shows and the
 * first question does the extraction.
 */
type OrgPresentation = {
    assistantEnabled: boolean;
    branding: { org_name: string; logo_url: string | null; brand_color: string | null } | null;
};

/**
 * CG-050. ONE organizations read serving both the AI flag and the branding.
 *
 * ═══ WHY THE TWO ARE FETCHED TOGETHER ═══
 *
 * This endpoint is POLLED. Before CG-050 the org row was read only when the AI
 * driver was on — the branch existed precisely so a deployment with AI off did
 * not pay for a query on every ceremony. Branding cannot live behind that
 * branch: a signer must see who sent them the document whether or not an
 * unrelated feature is enabled. Merging the two keeps it at ONE query rather
 * than the two a separate branding lookup would have cost.
 *
 * ═══ BRANDING IS A PRESENTATION HINT AND MUST NEVER GATE BEHAVIOUR ═══
 *
 * The whole block is ADDITIVE and ABSENCE-TOLERANT, the same contract
 * `embed_origin` follows: a client built before this shipped renders exactly as
 * it did, and a garbage `brand_color` must leave the ceremony fully working. It
 * is not authorization, it is not identity, and nothing downstream may branch on
 * it.
 *
 * A failed read degrades to `branding: null` — the product's own look — rather
 * than failing the session. Being unable to render a logo is not a reason a
 * signer cannot sign.
 */
async function loadOrgPresentation(
    ctx: Awaited<ReturnType<typeof resolveSignerToken>>
): Promise<OrgPresentation> {
    const { data: org } = await ctx.admin
        .from("organizations")
        .select(
            "name, ai_assistant_enabled, brand_color, logo_file_id, files:logo_file_id (r2_key)"
        )
        .eq("id", ctx.request.organization_id)
        .maybeSingle();

    let logoUrl: string | null = null;
    const file = Array.isArray(org?.files) ? org?.files[0] : org?.files;
    const r2Key = (file as { r2_key?: string } | null)?.r2_key ?? null;
    if (r2Key) {
        // Unsigned and permanent — the Worker serves `orgs/{id}/branding/**` with
        // no token, which is the only thing that works for a signer who holds a
        // signing credential and nothing else.
        try {
            logoUrl = getStorageDriver().publicUrl(r2Key);
        } catch (err) {
            console.error("signing_session_open: could not build logo URL:", err);
        }
    }

    const branding = org
        ? {
              org_name: (org.name as string) ?? "",
              logo_url: logoUrl,
              brand_color: (org.brand_color as string | null) ?? null,
          }
        : null;

    return {
        assistantEnabled: await loadAssistantEnabled(ctx, org?.ai_assistant_enabled === true),
        branding,
    };
}

async function loadAssistantEnabled(
    ctx: Awaited<ReturnType<typeof resolveSignerToken>>,
    orgEnabled: boolean
): Promise<boolean> {
    if (getAiDriverName() === "off") return false;
    if (!orgEnabled) return false;

    const { data: context } = await ctx.admin
        .from("signer_ai_document_context")
        .select("extraction_status, source_pdf_sha256")
        .eq("request_id", ctx.request.id)
        .maybeSingle<{ extraction_status: string; source_pdf_sha256: string }>();

    // A stale row describes a document that has since been replaced, so its
    // verdict says nothing about the one on screen.
    if (!context || context.source_pdf_sha256 !== ctx.request.source_pdf_sha256) return true;

    return context.extraction_status === "ready";
}
