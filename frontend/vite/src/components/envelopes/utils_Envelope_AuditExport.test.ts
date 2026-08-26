import { describe, expect, it } from "vitest";
import {
    utils_Envelope_AuditExportCsv,
    utils_Envelope_AuditExportFilename,
    utils_Envelope_AuditExportJson,
    type AuditExportMeta,
} from "@/components/envelopes/utils_Envelope_AuditExport";
import type { Tables_EnvelopeAuditLog_Entry } from "@/hooks/useQ_Tables_EnvelopeAuditLog";

const META: AuditExportMeta = {
    envelopeId: "sgr_test0001",
    documentTitle: "Mutual NDA",
    organizationName: "Northwind Legal",
    exportedAt: "2026-08-24T13:05:00.000Z",
    exportedBy: "admin@test.com",
    chain: { chain_intact: true, broken_at_seq: null, entries_checked: 2 },
};

const entry = (over: Partial<Tables_EnvelopeAuditLog_Entry> = {}) =>
    ({
        id: "sal_1",
        seq: 1,
        event_type: "signer_signed",
        signer_id: "sgs_1",
        actor_user_id: null,
        occurred_at: "2026-08-24T12:00:00.000Z",
        entry_hash: "a".repeat(64),
        prev_hash: null,
        payload: {
            actor: { kind: "signer", name: "Ada Lovelace", email: "ada@example.com" },
            auth: { methods: ["email_link", "otp"] },
            ip: "1.2.3.4",
        },
        ...over,
    }) as Tables_EnvelopeAuditLog_Entry;

describe("utils_Envelope_AuditExportCsv", () => {
    // The two injection cases lead, because they are the only way this file can
    // do harm. `payload` carries free text a stranger wrote — decline reasons,
    // vendor rejection strings — and it is length-capped by the server but never
    // sanitised, because the chain hashes it VERBATIM.
    // The party NAME is the real injection surface: it lands in its own cell
    // verbatim, unlike anything inside `payload`, which is JSON-encoded behind a
    // `key=` prefix and so never begins a cell with a formula character.
    const named = (name: string) =>
        entry({ payload: { actor: { kind: "signer", name, email: "x@y.co" } } as never });

    it("neutralises a party name a spreadsheet would execute as a formula", () => {
        const csv = utils_Envelope_AuditExportCsv([named("=cmd|'/c calc'!A1")], META);
        // The apostrophe is deliberately visible: this is an evidence file, and
        // silently rewriting its contents would be worse than showing the reader
        // that one character was added for safety.
        expect(csv).toContain(`"'=cmd`);
    });

    it("neutralises the other three formula leaders", () => {
        for (const lead of ["+", "-", "@"]) {
            expect(utils_Envelope_AuditExportCsv([named(`${lead}danger`)], META)).toContain(
                `"'${lead}danger`
            );
        }
    });

    it("neutralises a formula hidden behind leading whitespace", () => {
        // Spreadsheets strip a leading tab or CR before deciding whether a cell
        // is a formula, so a naive `startsWith("=")` check would miss this.
        expect(utils_Envelope_AuditExportCsv([named("\t=danger")], META)).toContain(`"'\t=danger`);
    });

    it("leaves an ordinary name alone", () => {
        const csv = utils_Envelope_AuditExportCsv([named("Ada Lovelace")], META);
        expect(csv).toContain('"Ada Lovelace"');
        expect(csv).not.toContain(`"'Ada`);
    });

    it("round-trips a name containing commas and quotes", () => {
        const csv = utils_Envelope_AuditExportCsv([named('He said "no", twice')], META);
        // Quote-doubled, so a naive split on commas cannot tear the field apart.
        expect(csv).toContain('"He said ""no"", twice"');
    });

    it("carries a header block naming the document, the export and the chain verdict", () => {
        const csv = utils_Envelope_AuditExportCsv([entry()], META);
        expect(csv).toContain("Mutual NDA");
        expect(csv).toContain("sgr_test0001");
        expect(csv).toContain("2026-08-24T13:05:00.000Z");
        expect(csv).toContain("intact");
    });

    it("says the chain was NOT checked when nobody pressed Verify", () => {
        // The one lie this file cannot afford: reporting a healthy chain because
        // the question was never asked.
        const csv = utils_Envelope_AuditExportCsv([entry()], { ...META, chain: null });
        expect(csv).toContain("not checked");
        expect(csv).not.toContain('"intact"');
    });

    it("names a broken chain and where it broke", () => {
        const csv = utils_Envelope_AuditExportCsv([entry()], {
            ...META,
            chain: { chain_intact: false, broken_at_seq: 7, entries_checked: 9 },
        });
        expect(csv).toContain("BROKEN at entry 7");
    });

    it("writes both hashes for every row", () => {
        const csv = utils_Envelope_AuditExportCsv(
            [
                entry({ seq: 1, entry_hash: "h1", prev_hash: null }),
                entry({ seq: 2, entry_hash: "h2", prev_hash: "h1" }),
            ],
            META
        );
        expect(csv).toContain('"h1"');
        expect(csv).toContain('"h2"');
    });

    it("flattens the actor out of the payload into its own columns", () => {
        const csv = utils_Envelope_AuditExportCsv([entry()], META);
        expect(csv).toContain("Ada Lovelace");
        expect(csv).toContain("ada@example.com");
        expect(csv).toContain("email_link otp");
    });

    it("produces a header row and one row per entry, and nothing else", () => {
        const csv = utils_Envelope_AuditExportCsv([entry({ seq: 1 }), entry({ seq: 2 })], META);
        const rows = csv.split("\r\n");
        expect(rows.filter((r) => r.startsWith('"1"') || r.startsWith('"2"'))).toHaveLength(2);
    });
});

describe("utils_Envelope_AuditExportJson", () => {
    it("carries entry_hash and prev_hash for EVERY row, so the chain can be re-linked", () => {
        // The whole point of the JSON export: a third party can verify the linkage
        // without trusting this application.
        const json = JSON.parse(
            utils_Envelope_AuditExportJson(
                [
                    entry({ seq: 1, entry_hash: "h1", prev_hash: null }),
                    entry({ seq: 2, entry_hash: "h2", prev_hash: "h1" }),
                ],
                META
            )
        );
        expect(json.entries).toHaveLength(2);
        expect(json.entries[0].entry_hash).toBe("h1");
        expect(json.entries[1].prev_hash).toBe("h1");
    });

    it("keeps the payload whole rather than summarising it", () => {
        const json = JSON.parse(utils_Envelope_AuditExportJson([entry()], META));
        expect(json.entries[0].payload.auth.methods).toEqual(["email_link", "otp"]);
    });

    it("records the chain verdict and the export provenance", () => {
        const json = JSON.parse(utils_Envelope_AuditExportJson([entry()], META));
        expect(json.export.envelope_id).toBe("sgr_test0001");
        expect(json.export.exported_by).toBe("admin@test.com");
        expect(json.export.chain_verification.chain_intact).toBe(true);
        expect(json.export.entry_count).toBe(1);
    });

    it("records a null verdict rather than omitting it when nobody verified", () => {
        const json = JSON.parse(
            utils_Envelope_AuditExportJson([entry()], { ...META, chain: null })
        );
        expect(json.export.chain_verification).toBeNull();
    });
});

describe("utils_Envelope_AuditExportFilename", () => {
    it("names its subject and sorts chronologically", () => {
        expect(
            utils_Envelope_AuditExportFilename("sgr_abc", "2026-08-24T13:05:00.000Z", "csv")
        ).toBe("contractgo-audit-sgr_abc-2026-08-24.csv");
    });

    it("uses the requested extension", () => {
        expect(
            utils_Envelope_AuditExportFilename("sgr_abc", "2026-08-24T13:05:00.000Z", "json")
        ).toBe("contractgo-audit-sgr_abc-2026-08-24.json");
    });
});
