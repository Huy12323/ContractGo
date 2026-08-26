import { describe, expect, it } from "vitest";
import { buildRequestRow } from "../../../supabase/functions/_shared/envelopeCompose.ts";

/**
 * CG-044 gave the product a second way to send a document, and this is the row
 * both ways write.
 *
 * THE KEY SET IS THE ASSERTION. `envelopes_send` still builds this literal
 * inline (v1.4.0 is additive-only and that function is on the untouched list),
 * so the two definitions agree by review plus this test rather than by sharing
 * code. Pinning the exact key set is what turns "someone added a column to one
 * of them" from an invisible divergence into a failing test.
 *
 * Note the asymmetry, which is real and is recorded in `buildRequestRow`'s own
 * docblock: this catches a field added HERE and not to `envelopes_send`. It
 * cannot catch the reverse. When `envelopes_send` is next legitimately touched,
 * switch it to call this and the asymmetry goes away.
 */

const RESOLVED = {
    template: { id: "tpl_1", name: "Offer letter", entity_id: "ent_1" },
    version: {
        id: "tvr_9",
        version_number: 4,
        pdf_file_path: "org_1/templates/tpl_1/v4.pdf",
        default_expiry_days: 14,
        default_reminder_days: [3, 7],
    },
    layout: [{ id: "tfd_a" }],
    signerRoles: [{ id: "rol_sender", name: "Sender", order: 0, color: "#000" }],
} as never as Parameters<typeof buildRequestRow>[0]["resolved"];

const build = (overrides: Record<string, unknown> = {}) =>
    buildRequestRow({
        body: {
            organization_id: "org_1",
            template_id: "tpl_1",
            title: "  Offer letter  ",
            prefilled_values: { tfd_a: "Acme" },
            ...overrides,
        } as never,
        resolved: RESOLVED,
        schedule: { expiresAt: "2026-09-08T00:00:00.000Z", reminderDays: [3, 7] },
        signerAuth: "email_otp",
        requireIdentityCheck: true,
        sourcePdfSha256: "a".repeat(64),
        sentAt: new Date("2026-08-25T09:00:00.000Z"),
    });

describe("buildRequestRow", () => {
    it("writes exactly the columns envelopes_send writes — no more, no fewer", () => {
        expect(Object.keys(build()).sort()).toEqual(
            [
                "entity_id",
                "expires_at",
                "organization_id",
                "prefilled_values",
                "reminder_days",
                "require_identity_check",
                "signer_auth",
                "source_pdf_r2_key",
                "source_pdf_sha256",
                "status",
                "sent_at",
                "template_id",
                "template_snapshot",
                "template_version_id",
                "title",
            ].sort()
        );
    });

    it("pins the resolved VERSION, not the template", () => {
        // The self-sufficiency invariant's anchor: what was sent is a fixed fact
        // even if the template is edited a second later, or hard-deleted.
        const row = build();
        expect(row.template_version_id).toBe("tvr_9");
        expect(row.source_pdf_r2_key).toBe("org_1/templates/tpl_1/v4.pdf");
    });

    it("embeds a v2 snapshot carrying the layout, the roles and the PDF path", () => {
        // AHR-1487/1490/1954. If this is ever emptied, a completed document stops
        // rendering the day its template is deleted — and nothing fails until then.
        const snapshot = build().template_snapshot as Record<string, unknown>;
        expect(snapshot.type).toBe("pdf");
        expect(snapshot.layout_version).toBe(2);
        expect(snapshot.pdf_file_path).toBe("org_1/templates/tpl_1/v4.pdf");
        expect(Array.isArray(snapshot.layout)).toBe(true);
        expect(Array.isArray(snapshot.signer_roles)).toBe(true);
    });

    it("trims the title", () => {
        expect(build().title).toBe("Offer letter");
    });

    it("takes the schedule and auth as given, never re-reading the template", () => {
        // These four are absolute facts about THIS send. A template corrected next
        // week must not retroactively change this document's deadline or how it
        // may be signed — so they come from the resolved schedule, not from
        // `resolved.version.default_*`, which deliberately differ here.
        const row = build();
        expect(row.expires_at).toBe("2026-09-08T00:00:00.000Z");
        expect(row.reminder_days).toEqual([3, 7]);
        expect(row.signer_auth).toBe("email_otp");
        expect(row.require_identity_check).toBe(true);
    });

    it("always starts in_progress with the send instant recorded", () => {
        const row = build();
        expect(row.status).toBe("in_progress");
        expect(row.sent_at).toBe("2026-08-25T09:00:00.000Z");
    });

    it("defaults prefilled_values to an empty object rather than null", () => {
        // The column is the BASE LAYER of the burn merge. A null would make
        // `finalizeRequest` merge against nothing; an empty object merges to the
        // signers' values, which is what "the sender filled nothing" means.
        expect(build({ prefilled_values: undefined }).prefilled_values).toEqual({});
    });
});
