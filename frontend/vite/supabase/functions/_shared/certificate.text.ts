/**
 * The Certificate of Completion's pure text logic — labels, sanitising, wrapping
 * and date formatting.
 *
 * ═══ WHY IT IS A SEPARATE FILE ═══
 *
 * `certificate.ts` imports `pdf-lib` and `@pdf-lib/fontkit` at module scope.
 * Neither is in the app's `node_modules` (they are edge-only `npm:` specifiers
 * resolved by each function's `deno.json`), and there is no TTF fixture in the
 * repository — so reaching any function inside that module from vitest would
 * mean adding two dependencies and a font file purely to defeat a module graph.
 * `docs/testing.md` names that abuse directly, and v1.2.0's CG-033 hotfix already
 * set the precedent by extracting `signing.identity.mock.ts` for exactly this
 * reason.
 *
 * Everything here is a string in, a string out. The PDF assembly stays next door
 * and is covered by an end-to-end smoke against the real stack, which is the only
 * thing that can meaningfully assert "this renders".
 */

// ============================================================
// Event labels
// ============================================================

/**
 * Human copy for an audit event type.
 *
 * DELIBERATELY A SECOND COPY of the labels in `App_EnvelopeTimeline.tsx`'s
 * `EVENT_META`, and it cannot be otherwise: that file is Vite/React app code and
 * this is a separate Deno program with its own import map. Sharing would mean
 * importing JSX into an edge function, or extracting a third module that both
 * import across a runtime boundary this repo does not otherwise cross.
 *
 * The wording is intentionally NOT identical. The timeline is read by a sender
 * who has the envelope open in front of them; this is read by a third party
 * holding only the certificate, so entries name the document rather than assuming
 * it ("Document sent for signature", not "Sent for signature").
 *
 * An unknown type falls through to the raw enum value rather than being dropped.
 * The chain is append-only and complete by construction, and a certificate that
 * silently omitted an entry it did not recognise would break the one property the
 * sequence numbers exist to make checkable.
 */
export function defaultEventLabel(eventType: string): string {
    return EVENT_LABELS[eventType] ?? eventType;
}

const EVENT_LABELS: Record<string, string> = {
    request_created: "Document created",
    request_updated: "Draft edited",
    request_sent: "Document sent for signature",
    signer_token_issued: "Signing link issued",
    signer_notified: "Recipient emailed",
    signer_token_redeemed: "Signing link opened",
    signer_viewed: "Document viewed",
    signer_fields_saved: "Entries saved",
    signer_signed: "Signed",
    signer_declined: "Declined",
    signer_access_denied: "Access denied",
    signer_reminded: "Reminder sent",
    signer_otp_issued: "Passcode emailed",
    signer_otp_verified: "Passcode confirmed",
    signer_otp_failed: "Wrong passcode entered",
    signer_identity_started: "Identity check started",
    signer_identity_verified: "Identity verified",
    signer_identity_failed: "Identity check failed",
    signer_token_revoked: "Signing link revoked",
    sender_requested_changes: "Changes requested by sender",
    capture_superseded: "Earlier signature superseded",
    cc_notified: "Observer emailed a copy",
    document_burned: "Final document generated",
    document_signed: "Document cryptographically signed",
    request_completed: "Completed",
    request_expired: "Expired",
    request_cancelled: "Voided",
    integrity_verified: "Document downloaded",
    certificate_generated: "Certificate issued",
};

// ============================================================
// Sanitising
// ============================================================

/** What replaces a character the embedded font cannot draw. */
export const CERTIFICATE_REPLACEMENT = "�";

/**
 * Strips what the font cannot draw.
 *
 * `pdf-lib` THROWS on a codepoint missing from the embedded font, and this
 * document renders user-supplied text: party names, decline reasons, vendor
 * rejection strings, user agents. An emoji in a decline reason must not be able to
 * stop a completed agreement producing its certificate.
 *
 * Written as an explicit codepoint walk rather than a chain of regexes. The
 * patterns involved are C0 control ranges and the astral plane, which are exactly
 * the two things easy to get subtly wrong in an escape sequence and impossible to
 * eyeball in a diff afterwards — three attempts to write them as character
 * classes put literal control bytes into the source and broke `deno check`.
 */
export function sanitizeForPdf(value: string): string {
    let out = "";
    for (const ch of value ?? "") {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp === 0x0d) continue; // CR: normalised away, LF is the break
        if (cp === 0x0a) {
            out += ch; // the one control character that means something
            continue;
        }
        if (cp < 0x20 || cp === 0x7f) continue; // other C0 controls, and DEL
        if (cp > 0xffff) {
            out += CERTIFICATE_REPLACEMENT; // astral plane: emoji, mostly
            continue;
        }
        out += ch;
    }
    return out;
}

// ============================================================
// Wrapping
// ============================================================

/** Width of a string at the size being drawn. Supplied by the caller's font. */
export type TextMeasure = (text: string) => number;

/**
 * Greedy word wrap against a real measurement function.
 *
 * Takes a `measure` callback rather than a `PDFFont` so the algorithm is
 * separable from the renderer — which is the point of this file, and also makes
 * the one genuinely tricky case assertable: a single "word" longer than the
 * column falls back to a HARD CHARACTER BREAK. That is not an edge case here.
 * Every hash on this document is 64 unbroken characters, and without it they
 * would run straight off the page — losing the exact values a reader came to
 * check.
 */
export function wrapText(value: string, measure: TextMeasure, width: number): string[] {
    const clean = sanitizeForPdf(value);
    if (!clean) return [""];

    const out: string[] = [];
    for (const paragraph of clean.split("\n")) {
        let line = "";
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
            const candidate = line ? `${line} ${word}` : word;
            if (measure(candidate) <= width) {
                line = candidate;
                continue;
            }
            if (line) out.push(line);
            if (measure(word) <= width) {
                line = word;
                continue;
            }
            let chunk = "";
            for (const ch of word) {
                if (measure(chunk + ch) > width) {
                    out.push(chunk);
                    chunk = ch;
                } else {
                    chunk += ch;
                }
            }
            line = chunk;
        }
        out.push(line);
    }
    return out;
}

// ============================================================
// Dates
// ============================================================

/**
 * `2026-08-24 12:37:33 UTC`.
 *
 * UTC and explicit about it. A certificate is read in a jurisdiction the server
 * knows nothing about, and a bare local timestamp in an evidentiary document is
 * a timestamp nobody can reason about later.
 *
 * An unparseable value is returned VERBATIM rather than rendered as an error: it
 * came out of the database, and showing it is more useful than hiding it.
 */
export function formatCertificateDate(iso: string | null): string {
    if (!iso) return "—";
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return `${parsed.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}
