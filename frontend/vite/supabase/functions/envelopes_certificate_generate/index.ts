/**
 * envelopes_certificate_generate — renders, stores and records the Certificate
 * of Completion for a finished document.
 *
 * AUTHENTICATED. Any member of the envelope's organization (CG-027), via the
 * same `resolveSender(…, "member")` gate as `envelopes_document-url`, and for
 * that function's stated reason: RLS already lets every org member SELECT
 * `signature_requests`, so gating the certificate more strictly than the row it
 * summarises is exactly the mismatch CG-027 fixed.
 *
 * ═══ WHY THIS IS NOT PART OF COMPLETION ═══
 *
 * `signing_submit`'s `finalizeRequest` is the most-verified function in the
 * repository and the one place a regression is unrecoverable, because the chain
 * entries it writes cannot be corrected afterwards. It already states the rule
 * this function inherits: a signing failure does NOT fail the completion,
 * because "refusing to complete because a certificate authority was unreachable
 * would strand a finished agreement over a property it never had".
 *
 * A certificate render failure deserves the same treatment, and putting the
 * render HERE rather than there makes that structural rather than a `try/catch`
 * a later author can tighten. It is also required regardless: every envelope
 * completed before v1.3.0 has no certificate, so an on-demand path has to exist,
 * and building generation at completion as well would be two code paths
 * producing one artifact.
 *
 * ═══ IDEMPOTENT ON THE CHAIN, NOT ON A FLAG ═══
 *
 * A stored certificate is returned unchanged while
 * `certificate_events_root_hash` still equals the chain's terminal `entry_hash`.
 * The moment the trail grows — a request-changes loop, a later download entry —
 * the stored PDF no longer describes the history it claims to summarise, so it
 * is re-rendered. A boolean "generated" flag could not express that, and would
 * hand people a certificate that quietly disagreed with the trail.
 *
 * When it returns the stored artifact it writes NO audit entry. Re-issuing
 * `certificate_generated` on every download would repeat exactly the mistake
 * `envelopes_document-url`'s header exists to prevent: a trail where an entry
 * appears fifty times because someone kept a tab open says nothing at all.
 *
 * ═══ FAILURE WRITES NOTHING ═══
 *
 * The six `certificate_*` columns are written in ONE UPDATE, after the object is
 * in storage. A render or storage failure returns 500 having changed no row and
 * appended no entry, so there is no state in which a failed certificate degrades
 * a completed document. That is why CG-043 deliberately declined to add a CHECK
 * tying the columns together — the all-or-nothing property comes from here.
 */

import { jsonResponse, sha256Bytes } from "../_shared/http.ts";
import { getStorageDriver } from "../_shared/storage.ts";
import {
    loadEnvelopeForSender,
    logSenderEvent,
    resolveSender,
    serveSenderFunction,
    SenderAuthError,
} from "../_shared/senderAuth.ts";
import { FONT_R2_KEY } from "../_shared/pdfBurn.ts";
import {
    defaultEventLabel,
    renderCompletionCertificate,
    type CertificateEvent,
    type CertificateSigner,
} from "../_shared/certificate.ts";

/** `RETURNS TABLE` shape of `signature_verify_chain`. See `_shared/rpcRows.ts` for why. */
type Rpc_SignatureVerifyChain = {
    chain_intact: boolean;
    broken_at_seq: number | null;
    entries_checked: number;
};

type AuditRow = {
    seq: number;
    event_type: string;
    signer_id: string | null;
    occurred_at: string;
    entry_hash: string | null;
    payload: Record<string, unknown> | null;
};

serveSenderFunction("envelopes_certificate_generate", async (body, req) => {
    const ctx = await resolveSender(req, String(body.organization_id ?? ""), "member");
    const envelope = await loadEnvelopeForSender(ctx, String(body.envelope_id ?? ""));

    // A certificate of COMPLETION. Issuing one for a document still in flight
    // would be a statement about an agreement that does not yet exist, and the
    // recipient list it printed could still change underneath it.
    if (envelope.status !== "completed") {
        throw new SenderAuthError(
            409,
            `This document is ${envelope.status}. A Certificate of Completion can only be issued once every party has signed.`
        );
    }

    const admin = ctx.admin;

    // ---- the chain, which is both the content and the cache key -------------
    const { data: auditData, error: auditError } = await admin
        .from("signature_audit_log")
        .select("seq, event_type, signer_id, occurred_at, entry_hash, payload")
        .eq("request_id", envelope.id)
        .order("seq", { ascending: true });

    if (auditError) {
        console.error("certificate: could not load the audit trail:", auditError);
        throw new SenderAuthError(500, "Could not read the audit trail");
    }
    const audit = (auditData ?? []) as AuditRow[];

    // THE COMMITMENT DELIBERATELY EXCLUDES `certificate_generated` ENTRIES, and
    // without this the feature does not converge.
    //
    // Issuing a certificate appends to the very chain the certificate commits
    // to. If the commitment were the raw last entry, then: generate (appends
    // E1) → the stored root hash is E0 → the next call sees terminal E1 ≠ E0 →
    // regenerates, appending E2 → and so on, forever, one new entry per press of
    // a button, in an append-only log that cannot be pruned.
    //
    // So the certificate commits to the last SUBSTANTIVE entry — everything that
    // happened to the agreement — and its own issuance is bookkeeping ABOUT the
    // certificate rather than about the document. That is a genuine fixed point:
    // issuing twice in a row is a no-op, while any real event (a signature, a
    // decline, a download, a request-changes loop) moves the commitment and
    // correctly makes the stored certificate stale.
    //
    // The certificate itself says "at issue" beside this hash rather than
    // implying it is the final row of the live log, because after issuance it is
    // not — and an evidentiary document must not overstate what it commits to.
    const substantive = audit.filter((e) => e.event_type !== "certificate_generated");
    const terminal = substantive.length ? substantive[substantive.length - 1] : null;

    // ---- idempotency ---------------------------------------------------------
    const { data: current, error: currentError } = await admin
        .from("signature_requests")
        .select(
            "certificate_r2_key, certificate_sha256, certificate_generated_at, certificate_events_root_hash, certificate_events_seq, certificate_chain_intact, source_pdf_sha256, completed_at, template_snapshot"
        )
        .eq("id", envelope.id)
        .maybeSingle();

    if (currentError || !current) {
        console.error("certificate: could not load the request:", currentError);
        throw new SenderAuthError(500, "Could not read the document");
    }

    if (
        current.certificate_r2_key &&
        terminal &&
        current.certificate_events_root_hash === terminal.entry_hash
    ) {
        return jsonResponse(
            {
                regenerated: false,
                certificate_sha256: current.certificate_sha256,
                generated_at: current.certificate_generated_at,
                events_seq: current.certificate_events_seq,
                chain_intact: current.certificate_chain_intact,
            },
            200
        );
    }

    // ---- verify the chain ----------------------------------------------------
    // The service_role primitive, NOT `signature_verify_chain_for_member`: this
    // runs as service_role, which is not a member of anything, so the wrapper's
    // `is_org_member` guard would return NO ROWS for a perfectly healthy
    // envelope. Authorization already happened at `resolveSender`.
    const { data: chainData, error: chainError } = await admin
        .rpc("signature_verify_chain", { p_request_id: envelope.id })
        .maybeSingle<Rpc_SignatureVerifyChain>();

    if (chainError) {
        console.error("certificate: chain verification failed:", chainError);
        throw new SenderAuthError(500, "Could not verify the audit trail");
    }

    const chain = {
        intact: chainData?.chain_intact ?? false,
        broken_at_seq: chainData?.broken_at_seq ?? null,
        entries_checked: chainData?.entries_checked ?? audit.length,
        terminal_hash: terminal?.entry_hash ?? null,
        terminal_seq: terminal?.seq ?? null,
    };

    // ---- parties -------------------------------------------------------------
    const { data: signerData, error: signerError } = await admin
        .from("signature_request_signers")
        .select(
            "id, signer_name, signer_email, role_id, signer_order, status, signed_at, decline_reason, recipient_type"
        )
        .eq("request_id", envelope.id)
        .order("signer_order", { ascending: true });

    if (signerError) {
        console.error("certificate: could not load recipients:", signerError);
        throw new SenderAuthError(500, "Could not read the recipients");
    }

    // Live captures only, matching `finalizeRequest`'s filter. A superseded
    // capture belongs to a signature that was replaced through the
    // request-changes loop; printing its IP beside a party's CURRENT signature
    // would attribute the wrong act to the right person.
    const { data: captureData } = await admin
        .from("signature_captures")
        .select("signer_id, captured_ip, captured_user_agent")
        .eq("request_id", envelope.id)
        .is("superseded_at", null);

    const captures = new Map<string, { ip: string | null; ua: string | null }>();
    for (const c of (captureData ?? []) as Array<Record<string, unknown>>) {
        captures.set(String(c.signer_id), {
            ip: (c.captured_ip as string | null) ?? null,
            ua: (c.captured_user_agent as string | null) ?? null,
        });
    }

    // How each party proved who they were, taken from their own `signer_signed`
    // entry rather than from the signer row. The row records the CURRENT
    // requirement; the chain records what was actually satisfied at the moment
    // they signed, which is the only one of the two that is evidence.
    const methodsBySigner = new Map<string, string[]>();
    for (const entry of audit) {
        if (entry.event_type !== "signer_signed" || !entry.signer_id) continue;
        const auth = (entry.payload?.auth ?? null) as { methods?: unknown } | null;
        if (Array.isArray(auth?.methods)) {
            methodsBySigner.set(entry.signer_id, auth.methods.map(String));
        }
    }

    const roleNames = roleNameMap(current.template_snapshot);

    const signers: CertificateSigner[] = ((signerData ?? []) as Array<Record<string, unknown>>)
        .filter((s) => s.recipient_type === "signer")
        .map((s) => ({
            name: String(s.signer_name ?? ""),
            email: String(s.signer_email ?? ""),
            role: s.role_id ? (roleNames.get(String(s.role_id)) ?? String(s.role_id)) : null,
            order: Number(s.signer_order ?? 0),
            status: String(s.status ?? ""),
            signed_at: (s.signed_at as string | null) ?? null,
            auth_methods: methodsBySigner.get(String(s.id)) ?? [],
            ip: captures.get(String(s.id))?.ip ?? null,
            user_agent: captures.get(String(s.id))?.ua ?? null,
            declined_reason: (s.decline_reason as string | null) ?? null,
        }));

    // ---- events --------------------------------------------------------------
    const events: CertificateEvent[] = audit.map((e) => {
        const actor = (e.payload?.actor ?? null) as { name?: unknown; email?: unknown } | null;
        const name = actor?.name ? String(actor.name) : null;
        return {
            seq: e.seq,
            occurred_at: e.occurred_at,
            label: defaultEventLabel(e.event_type),
            actor: name,
        };
    });

    // ---- signing provenance --------------------------------------------------
    // From `document_signed`, which is absent when the signing driver failed —
    // `finalizeRequest` chains `document_burned` first precisely so completion
    // survives that. A certificate for such a document says "none recorded"
    // rather than implying a signature that was never produced.
    const signedEntry = audit.find((e) => e.event_type === "document_signed");
    const signedPayload = (signedEntry?.payload ?? {}) as Record<string, unknown>;

    // ---- render --------------------------------------------------------------
    const storage = getStorageDriver();
    const fontBytes = await storage.getObject(FONT_R2_KEY);

    const generatedAt = new Date().toISOString();
    const verifyUrl = buildVerifyUrl();

    const pdfBytes = await renderCompletionCertificate({
        organization_name: ctx.organizationName,
        document_title: envelope.title,
        envelope_id: envelope.id,
        completed_at: (current.completed_at as string | null) ?? null,
        source_pdf_sha256: String(current.source_pdf_sha256 ?? ""),
        signed_pdf_sha256: envelope.signed_pdf_sha256,
        signature_provider: (signedPayload.provider as string | null) ?? null,
        certificate_self_signed: (signedPayload.certificate_self_signed as boolean | null) ?? null,
        chain,
        signers,
        events,
        verify_url: verifyUrl,
        generated_at: generatedAt,
        fontBytes,
    });

    const certificateSha256 = await sha256Bytes(pdfBytes);

    // Mirrors `signed.pdf`'s key shape. Overwritten in place on regeneration,
    // which is why CG-043 gives the certificate no `files` row: a row carrying a
    // size and a hash would be falsified by every regeneration.
    const key = `orgs/${envelope.organization_id}/signature-requests/${envelope.id}/certificate.pdf`;

    await storage.putObject({ key, body: pdfBytes, contentType: "application/pdf" });

    const { error: updateError } = await admin
        .from("signature_requests")
        .update({
            certificate_r2_key: key,
            certificate_sha256: certificateSha256,
            certificate_generated_at: generatedAt,
            certificate_events_root_hash: chain.terminal_hash,
            certificate_events_seq: chain.terminal_seq,
            certificate_chain_intact: chain.intact,
        })
        .eq("id", envelope.id);

    if (updateError) {
        console.error("certificate: could not record the certificate:", updateError);
        throw new SenderAuthError(500, "Could not record the certificate");
    }

    // AFTER the row is written, never before: an entry claiming a certificate
    // exists must not outlive a failed UPDATE, in a log that cannot be corrected.
    //
    // This entry appends to the chain the certificate just committed to, which
    // is unavoidable in an append-only log: recording the act changes the
    // history. It is handled rather than ignored — the commitment is computed
    // over substantive entries only (see the filter above), so issuing a
    // certificate cannot invalidate the certificate it just issued.
    await logSenderEvent(ctx, {
        envelopeId: envelope.id,
        eventType: "certificate_generated",
        payload: {
            certificate_sha256: certificateSha256,
            events_root_hash: chain.terminal_hash,
            events_seq: chain.terminal_seq,
            chain_intact: chain.intact,
        },
    });

    return jsonResponse(
        {
            regenerated: true,
            certificate_sha256: certificateSha256,
            generated_at: generatedAt,
            events_seq: chain.terminal_seq,
            chain_intact: chain.intact,
        },
        200
    );
});

/**
 * Role id → the human name the sender gave it, out of the pinned snapshot.
 *
 * Falls back to the raw id at the call site rather than throwing: a snapshot
 * whose roles cannot be read still yields a certificate, and an opaque role id
 * is a cosmetic loss beside a missing document.
 */
function roleNameMap(snapshot: unknown): Map<string, string> {
    const out = new Map<string, string>();
    const roles = (snapshot as { signer_roles?: unknown } | null)?.signer_roles;
    if (!Array.isArray(roles)) return out;
    for (const role of roles) {
        const r = role as { id?: unknown; name?: unknown };
        if (r?.id) out.set(String(r.id), String(r.name ?? r.id));
    }
    return out;
}

/**
 * The public verification address, built SERVER-SIDE from configuration.
 *
 * Never from the request body. This string is printed into an evidentiary
 * document that gets forwarded to counterparties, so a body-supplied value would
 * let any org member mint a certificate directing third parties at an address of
 * their choosing — the same reasoning that keeps `signing_identity_start`'s
 * redirect out of the body.
 *
 * Absent configuration yields no line at all rather than a broken link.
 */
function buildVerifyUrl(): string | null {
    const base = Deno.env.get("SIGNER_PORTAL_URL") ?? Deno.env.get("APP_URL") ?? "";
    if (!base) return null;
    return `${base.replace(/\/+$/, "")}/verify`;
}
