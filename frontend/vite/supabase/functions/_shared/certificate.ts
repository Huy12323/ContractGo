/**
 * The Certificate of Completion — the audit chain, rendered for a human.
 *
 * WHY THIS EXISTS AS A SEPARATE ARTIFACT. A PDF's `/Sig` dictionary has room for
 * ONE signer (`signing_submit/index.ts:635` records the constraint), so a
 * multi-party agreement cannot state its own parties from inside the signed
 * document. Every counterparty after the first is invisible in the file itself.
 * This is where they become visible.
 *
 * IT INVENTS NOTHING. Every value printed here already exists in
 * `signature_requests`, `signature_request_signers` and `signature_audit_log` —
 * the last of which is append-only by trigger and hash-chained. This module is a
 * SECOND RENDERING of a dataset that is already trusted, which is exactly what
 * makes generating one safe to do at any time and safe to delete.
 *
 * ═══ WHY IT TAKES PLAIN DATA AND NOT A `SupabaseClient` ═══
 *
 * `docs/testing.md` is explicit and it is not negotiable: "Only import PURE
 * functions from `_shared`. Anything that needs a real `SupabaseClient` belongs
 * in the integration silo." A renderer that fetched its own rows could not be
 * tested at all — and the layout is precisely the part worth testing, because it
 * is the part a regulator reads. So the caller does the IO and this does the
 * paper.
 *
 * ═══ A BROKEN CHAIN IS RENDERED, NOT REFUSED ═══
 *
 * If `signature_verify_chain` reports the trail broken, this still produces a
 * certificate and says so at the top, in the most prominent box on the page.
 * Refusing to render would hide precisely the fact that matters most.
 *
 * ═══ ONE FONT, SO HIERARCHY IS SIZE AND COLOUR ═══
 *
 * The bucket ships `NotoSerif-Regular.ttf` and nothing else. Faking bold by
 * over-stamping text at an offset produces something that looks like a printing
 * fault, so headings are larger and grey rules separate sections instead.
 *
 * Consumers must map `pdf-lib` and `@pdf-lib/fontkit` in their own `deno.json`.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
    defaultEventLabel,
    formatCertificateDate,
    sanitizeForPdf,
    wrapText,
} from "./certificate.text.ts";

// Re-exported so callers import "the certificate module" rather than having to
// know which half a given helper lives in. The split exists for testability
// (see certificate.text.ts), not to give consumers two addresses.
export { defaultEventLabel } from "./certificate.text.ts";

// ============================================================
// Input contract
// ============================================================

export type CertificateSigner = {
    name: string;
    email: string;
    /** The snapshot role this party fulfilled. NULL for a row whose role was removed. */
    role: string | null;
    order: number;
    status: string;
    signed_at: string | null;
    /** From the chain's `signer_signed` entry — `email_link`, `otp`, `ekyc`, … */
    auth_methods: string[];
    ip: string | null;
    user_agent: string | null;
    declined_reason: string | null;
};

export type CertificateEvent = {
    seq: number;
    occurred_at: string;
    label: string;
    actor: string | null;
};

export type CertificateChain = {
    intact: boolean;
    broken_at_seq: number | null;
    entries_checked: number;
    /** The `entry_hash` of the last entry. NOT a Merkle root — see the CG-043 header. */
    terminal_hash: string | null;
    terminal_seq: number | null;
};

export type CertificateInput = {
    organization_name: string;
    document_title: string;
    envelope_id: string;
    completed_at: string | null;
    source_pdf_sha256: string;
    signed_pdf_sha256: string | null;
    /** `signatures.provider` as recorded on the chain's `document_signed` entry. */
    signature_provider: string | null;
    certificate_self_signed: boolean | null;
    chain: CertificateChain;
    signers: CertificateSigner[];
    events: CertificateEvent[];
    /** Where a third party can check the document. Printed as TEXT — no QR in v1.3. */
    verify_url: string | null;
    generated_at: string;
    fontBytes: Uint8Array;
};

/**
 * Binds a font and a size into the measurement callback `wrapText` takes.
 *
 * The wrapping algorithm does not need to know what a `PDFFont` is, and keeping
 * it that way is what lets it be tested without pdf-lib installed.
 */
const measurer =
    (font: PDFFont, size: number): ((text: string) => number) =>
    (text: string) =>
        font.widthOfTextAtSize(text, size);

// ============================================================
// Page geometry
// ============================================================

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = MARGIN + 24; // leaves room for the page footer

const INK = rgb(0.11, 0.12, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.86, 0.88);
const BRAND = rgb(0.39, 0.4, 0.945); // #6366f1, the app's colorPrimary
const DANGER = rgb(0.8, 0.15, 0.15);
const WARN_BG = rgb(1, 0.97, 0.9);
const DANGER_BG = rgb(0.99, 0.93, 0.93);

/**
 * A write cursor that owns pagination.
 *
 * Every draw goes through `ensure(h)` first, so no caller has to know where the
 * page ends. That is the whole reason this is a class and not a pile of
 * functions taking a `y`: a four-party envelope with a request-changes loop runs
 * to twenty-plus events, and a renderer that assumed one page would silently
 * draw the tail of the trail underneath the bottom edge — losing evidence in the
 * document whose job is to preserve it.
 */
class Cursor {
    doc: PDFDocument;
    font: PDFFont;
    page: PDFPage;
    y: number;
    pages: PDFPage[] = [];

    constructor(doc: PDFDocument, font: PDFFont) {
        this.doc = doc;
        this.font = font;
        this.page = doc.addPage([PAGE_W, PAGE_H]);
        this.pages.push(this.page);
        this.y = PAGE_H - MARGIN;
    }

    ensure(height: number) {
        if (this.y - height < BOTTOM) {
            this.page = this.doc.addPage([PAGE_W, PAGE_H]);
            this.pages.push(this.page);
            this.y = PAGE_H - MARGIN;
        }
    }

    text(value: string, opts: { size?: number; color?: typeof INK; indent?: number } = {}) {
        const size = opts.size ?? 9.5;
        const indent = opts.indent ?? 0;
        for (const line of wrapText(value, measurer(this.font, size), CONTENT_W - indent)) {
            this.ensure(size + 4);
            this.page.drawText(line, {
                x: MARGIN + indent,
                y: this.y - size,
                size,
                font: this.font,
                color: opts.color ?? INK,
            });
            this.y -= size + 4;
        }
    }

    gap(h: number) {
        this.ensure(h);
        this.y -= h;
    }

    rule() {
        this.ensure(10);
        this.y -= 4;
        this.page.drawLine({
            start: { x: MARGIN, y: this.y },
            end: { x: PAGE_W - MARGIN, y: this.y },
            thickness: 0.75,
            color: RULE,
        });
        this.y -= 8;
    }

    heading(value: string) {
        this.gap(8);
        this.ensure(26);
        this.text(value.toUpperCase(), { size: 10.5, color: BRAND });
        this.rule();
    }

    /**
     * A label/value row. The label column is fixed so the values line up down the
     * page — a certificate is scanned for one fact, not read start to finish.
     */
    row(label: string, value: string, color = INK) {
        const size = 9.5;
        const labelW = 132;
        const lines = wrapText(value || "—", measurer(this.font, size), CONTENT_W - labelW);
        this.ensure(lines.length * (size + 4));
        this.page.drawText(label, {
            x: MARGIN,
            y: this.y - size,
            size,
            font: this.font,
            color: MUTED,
        });
        let first = true;
        for (const line of lines) {
            if (!first) this.ensure(size + 4);
            this.page.drawText(line, {
                x: MARGIN + labelW,
                y: this.y - size,
                size,
                font: this.font,
                color,
            });
            this.y -= size + 4;
            first = false;
        }
    }

    /** A filled callout. Used only where the reader must not skim past. */
    notice(title: string, body: string, tone: "warn" | "danger") {
        const size = 9.5;
        const inner = CONTENT_W - 20;
        const measure = measurer(this.font, size);
        const lines = [...wrapText(title, measure, inner), ...wrapText(body, measure, inner)];
        const boxH = lines.length * (size + 4) + 16;
        this.ensure(boxH + 10);
        this.page.drawRectangle({
            x: MARGIN,
            y: this.y - boxH,
            width: CONTENT_W,
            height: boxH,
            color: tone === "danger" ? DANGER_BG : WARN_BG,
            borderColor: tone === "danger" ? DANGER : rgb(0.85, 0.6, 0.1),
            borderWidth: 0.75,
        });
        let ty = this.y - 12;
        for (const line of lines) {
            this.page.drawText(line, {
                x: MARGIN + 10,
                y: ty - size,
                size,
                font: this.font,
                color: tone === "danger" ? DANGER : INK,
            });
            ty -= size + 4;
        }
        this.y -= boxH + 10;
    }
}

// ============================================================
// The renderer
// ============================================================

export async function renderCompletionCertificate(input: CertificateInput): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(input.fontBytes, { subset: false });

    doc.setTitle(`Certificate of Completion — ${sanitizeForPdf(input.document_title)}`);
    doc.setProducer("ContractGo");
    doc.setCreator("ContractGo");

    const c = new Cursor(doc, font);

    // ---- Header ---------------------------------------------------------
    c.text("CERTIFICATE OF COMPLETION", { size: 17, color: BRAND });
    c.gap(2);
    c.text(input.document_title, { size: 12 });
    c.text(input.organization_name, { size: 9.5, color: MUTED });
    c.gap(10);

    // ---- The two things a reader must not skim past ---------------------
    // Order matters: a broken chain invalidates everything below it, so it is
    // stated before the reader has invested any attention in the detail.
    if (!input.chain.intact) {
        c.notice(
            "THE AUDIT TRAIL FOR THIS DOCUMENT DOES NOT VERIFY.",
            `The hash chain failed verification at entry ${input.chain.broken_at_seq ?? "unknown"}. ` +
                "Entries at or after that point may have been altered or removed. This certificate " +
                "is issued anyway, because withholding it would conceal the discrepancy — but the " +
                "history below must not be relied on until the cause is established.",
            "danger"
        );
    }

    const isMock = input.signature_provider === "mock" || input.certificate_self_signed === true;
    if (isMock) {
        c.notice(
            "SIGNATURES ON THIS DEPLOYMENT ARE SIMULATED.",
            `This document was signed using the "${input.signature_provider ?? "mock"}" provider ` +
                "against a self-signed development certificate. The cryptographic signature is " +
                "structurally valid but is NOT issued by a certificate authority and is NOT legally " +
                "binding. This certificate records what happened; it does not attest to legal effect.",
            "warn"
        );
    }

    // ---- Summary --------------------------------------------------------
    c.heading("Document");
    c.row("Reference", input.envelope_id);
    c.row("Completed", formatCertificateDate(input.completed_at));
    c.row("Parties", String(input.signers.length));
    c.row("Certificate issued", formatCertificateDate(input.generated_at));

    // ---- Integrity ------------------------------------------------------
    c.heading("Document integrity");
    c.row("Algorithm", "SHA-256");
    c.row("Original document", input.source_pdf_sha256);
    c.row("Signed document", input.signed_pdf_sha256 ?? "not available");
    c.row("Signing provider", input.signature_provider ?? "none recorded", isMock ? DANGER : INK);
    if (input.verify_url) {
        c.gap(4);
        c.text(
            "Anyone holding the signed document can confirm it is unaltered at the address below. " +
                "The check compares the SHA-256 of the file in their possession against the value " +
                "recorded above; the file itself is never uploaded.",
            { size: 9, color: MUTED }
        );
        c.gap(2);
        c.text(input.verify_url, { size: 9.5, color: BRAND });
    }

    // ---- Parties --------------------------------------------------------
    c.heading("Parties");
    if (input.signers.length === 0) {
        c.text("No recipients recorded.", { size: 9.5, color: MUTED });
    }
    for (const s of input.signers) {
        // Keep a party's identity line with at least its first detail row rather
        // than letting a name orphan at the foot of a page.
        c.ensure(56);
        c.text(`${s.name}  ·  ${s.email}`, { size: 10.5 });
        c.row("Role", s.role ?? "—");
        c.row("Order", String(s.order));
        c.row("Status", s.status);
        c.row("Signed", formatCertificateDate(s.signed_at));
        c.row("Verified by", s.auth_methods.length ? s.auth_methods.join(", ") : "not recorded");
        c.row("IP address", s.ip ?? "not recorded");
        if (s.user_agent) c.row("Device", s.user_agent);
        if (s.declined_reason) c.row("Declined because", s.declined_reason, DANGER);
        c.gap(6);
    }

    // ---- History --------------------------------------------------------
    c.heading("Event history");
    c.text(
        "Every entry below is sealed into a hash chain: each one commits to the entry before it, " +
            "so an entry cannot be altered, inserted or removed without breaking every entry after it.",
        { size: 9, color: MUTED }
    );
    c.gap(6);
    for (const e of input.events) {
        c.row(
            `#${e.seq}  ${formatCertificateDate(e.occurred_at).slice(0, 16)}`,
            e.actor ? `${e.label} — ${e.actor}` : e.label
        );
    }

    // ---- Verification ---------------------------------------------------
    c.heading("Chain verification");
    c.row("Verified at", formatCertificateDate(input.generated_at));
    c.row("Entries checked", String(input.chain.entries_checked));
    c.row(
        "Result",
        input.chain.intact
            ? "Intact — every entry rehashed to its recorded value"
            : `BROKEN at entry ${input.chain.broken_at_seq ?? "unknown"}`,
        input.chain.intact ? INK : DANGER
    );
    c.row(
        "Committed to entry",
        input.chain.terminal_seq !== null ? `#${input.chain.terminal_seq}` : "—"
    );
    c.row("Entry hash", input.chain.terminal_hash ?? "—");
    c.gap(4);
    c.text(
        "That hash commits to the entire history up to and including that entry: comparing it " +
            "against the live record detects any change to any earlier entry. Entries recording " +
            "the issue of this certificate itself are appended afterwards and are outside the " +
            "commitment, which is why the trail may contain entries numbered above it.",
        { size: 9, color: MUTED }
    );

    // ---- Footers --------------------------------------------------------
    // Drawn last, when the total is known. A certificate that does not say "1 of
    // 3" is a certificate somebody can hand over two thirds of.
    const total = c.pages.length;
    c.pages.forEach((page, i) => {
        page.drawText(`ContractGo · Certificate of Completion · ${input.envelope_id}`, {
            x: MARGIN,
            y: MARGIN - 12,
            size: 8,
            font,
            color: MUTED,
        });
        const label = `Page ${i + 1} of ${total}`;
        page.drawText(label, {
            x: PAGE_W - MARGIN - font.widthOfTextAtSize(label, 8),
            y: MARGIN - 12,
            size: 8,
            font,
            color: MUTED,
        });
    });

    return await doc.save();
}
