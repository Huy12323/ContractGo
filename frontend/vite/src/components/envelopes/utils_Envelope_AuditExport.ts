import type { Tables_EnvelopeAuditLog_Entry } from "@/hooks/useQ_Tables_EnvelopeAuditLog";

// Taking the audit trail out of the product.
//
// The trail is the legal artifact, and until now the only way to hand it to
// anyone was a screenshot. These two serialisers are what make it evidence
// somebody else can hold: the JSON carries `entry_hash` and `prev_hash` for every
// row plus the chain verdict, so a third party can re-link the chain themselves
// without this application; the CSV is for a human reading it in a spreadsheet.
//
// PURE FUNCTIONS over rows the page already has. No fetch, no download, no
// `Blob` — the caller does that. This file is the part worth testing, and it is
// testable without rendering anything.
//
// NO AUDIT ENTRY IS WRITTEN FOR AN EXPORT, and that is deliberate rather than an
// omission. `envelopes_download-signed` records taking a copy of the DOCUMENT,
// because possessing the signed artifact is a fact about the agreement. Reading
// the trail is not — and an export that appended to the very log it was exporting
// would change the thing it claims to have copied, every time.

export type AuditExportMeta = {
    envelopeId: string;
    documentTitle: string;
    organizationName?: string | null;
    exportedAt: string;
    exportedBy?: string | null;
    chain?: {
        chain_intact: boolean;
        broken_at_seq: number | null;
        entries_checked: number;
    } | null;
};

/**
 * Neutralises a value that a spreadsheet would otherwise execute.
 *
 * The payloads in this trail carry free text a stranger wrote — decline reasons,
 * changes-requested reasons, vendor rejection strings. They are length-capped by
 * the server but never sanitised, because the chain hashes them VERBATIM and
 * sanitising before hashing would break verification.
 *
 * So the escaping has to happen here, at the only point where the text stops
 * being data and becomes a formula: Excel, Sheets and LibreOffice all evaluate a
 * cell beginning `=`, `+`, `-` or `@`. A leading tab or carriage return counts
 * too, because those are stripped before the leading character is examined.
 *
 * Prefixing with an apostrophe is the standard neutralisation and is visible in
 * the cell — which is correct here. This is an evidence file; silently altering
 * its contents would be worse than showing the reader that one character was
 * added for safety.
 */
const neutralise = (value: string): string => (/^[\t\r]*[=+\-@]/.test(value) ? `'${value}` : value);

/** Quote-and-double, unconditionally. A field that never needs it loses nothing. */
const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '""';
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    return `"${neutralise(raw).replace(/"/g, '""')}"`;
};

/** The payload minus the evidence block every entry carries, flattened for reading. */
const summarisePayload = (payload: unknown): string => {
    if (!payload || typeof payload !== "object") return "";
    const {
        actor: _actor,
        auth: _auth,
        ip: _ip,
        user_agent: _ua,
        ...rest
    } = payload as Record<string, unknown>;
    const keys = Object.keys(rest);
    if (keys.length === 0) return "";
    return keys.map((k) => `${k}=${JSON.stringify(rest[k])}`).join("; ");
};

const actorOf = (payload: unknown): { name: string; email: string; kind: string } => {
    const actor = (payload as { actor?: Record<string, unknown> } | null)?.actor;
    return {
        name: String(actor?.name ?? ""),
        email: String(actor?.email ?? ""),
        kind: String(actor?.kind ?? ""),
    };
};

const methodsOf = (payload: unknown): string => {
    const methods = (payload as { auth?: { methods?: unknown } } | null)?.auth?.methods;
    return Array.isArray(methods) ? methods.map(String).join(" ") : "";
};

/**
 * The human-readable export.
 *
 * It opens with a header block naming the document, the export and the chain
 * verdict. An evidence file that does not say what it is and when it was taken is
 * worth little more than the screenshot it replaces.
 */
export const utils_Envelope_AuditExportCsv = (
    entries: Tables_EnvelopeAuditLog_Entry[],
    meta: AuditExportMeta
): string => {
    const lines: string[] = [
        `${cell("ContractGo audit trail export")}`,
        `${cell("Document")},${cell(meta.documentTitle)}`,
        `${cell("Reference")},${cell(meta.envelopeId)}`,
        `${cell("Organization")},${cell(meta.organizationName ?? "")}`,
        `${cell("Exported at")},${cell(meta.exportedAt)}`,
        `${cell("Exported by")},${cell(meta.exportedBy ?? "")}`,
        `${cell("Entries")},${cell(entries.length)}`,
        `${cell("Chain verified")},${cell(
            meta.chain
                ? meta.chain.chain_intact
                    ? "intact"
                    : `BROKEN at entry ${meta.chain.broken_at_seq ?? "unknown"}`
                : "not checked"
        )}`,
        "",
        [
            "seq",
            "occurred_at",
            "event_type",
            "actor_kind",
            "actor_name",
            "actor_email",
            "auth_methods",
            "details",
            "prev_hash",
            "entry_hash",
        ]
            .map(cell)
            .join(","),
    ];

    for (const entry of entries) {
        const actor = actorOf(entry.payload);
        lines.push(
            [
                entry.seq,
                entry.occurred_at,
                entry.event_type,
                actor.kind,
                actor.name,
                actor.email,
                methodsOf(entry.payload),
                summarisePayload(entry.payload),
                entry.prev_hash ?? "",
                entry.entry_hash ?? "",
            ]
                .map(cell)
                .join(",")
        );
    }

    return lines.join("\r\n");
};

/**
 * The machine-readable export.
 *
 * Every row goes out WHOLE, payload included, with both hashes — because the
 * point of this file is that someone can re-link the chain without trusting us.
 * A summarised JSON export would be a prettier CSV, which is not a second format
 * worth having.
 */
export const utils_Envelope_AuditExportJson = (
    entries: Tables_EnvelopeAuditLog_Entry[],
    meta: AuditExportMeta
): string =>
    JSON.stringify(
        {
            export: {
                product: "ContractGo",
                kind: "audit_trail",
                envelope_id: meta.envelopeId,
                document_title: meta.documentTitle,
                organization_name: meta.organizationName ?? null,
                exported_at: meta.exportedAt,
                exported_by: meta.exportedBy ?? null,
                entry_count: entries.length,
                chain_verification: meta.chain ?? null,
                // Stated so a reader does not have to infer the linkage rule from
                // the data. It is the same formula `signature_audit_entry_hash`
                // applies, named rather than reproduced — reproducing it here
                // would create a second definition that can drift.
                chain_note:
                    "Each entry_hash is derived from the preceding entry_hash together with the entry's own fields, so the final entry commits to the whole sequence.",
            },
            entries,
        },
        null,
        2
    );

/** `contractgo-audit-{id}-{date}.{ext}` — sorts chronologically, names its subject. */
export const utils_Envelope_AuditExportFilename = (
    envelopeId: string,
    exportedAt: string,
    extension: "csv" | "json"
): string => `contractgo-audit-${envelopeId}-${exportedAt.slice(0, 10)}.${extension}`;
