import { describe, expect, it } from "vitest";
import {
    utils_Dashboard_FormatHours,
    utils_Dashboard_Kpis,
} from "@/pages/Page_Dashboard/utils_Dashboard_Kpis";
import type { Tables_Envelopes_Record } from "@/hooks/useQ_Tables_Envelopes";

const env = (over: Partial<Tables_Envelopes_Record>) =>
    ({
        id: "sgr_1",
        title: "Doc",
        status: "completed",
        current_order: 1,
        template_id: null,
        sent_at: "2026-08-01T00:00:00.000Z",
        completed_at: "2026-08-02T00:00:00.000Z",
        expires_at: null,
        reminder_days: [],
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
        signed_pdf_r2_key: "k",
        signed_pdf_sha256: "s",
        certificate_sha256: null,
        certificate_generated_at: null,
        signature_request_signers: [],
        ...over,
    }) as Tables_Envelopes_Record;

describe("utils_Dashboard_Kpis", () => {
    // The empty and single-sample cases lead, because a metric that divides by
    // zero or reports "100%" from one document is the failure mode that actually
    // reaches a screen.
    it("reports nothing and divides by nothing when there is no history", () => {
        const kpis = utils_Dashboard_Kpis([]);
        expect(kpis.finished).toBe(0);
        expect(kpis.completionRate).toBeNull();
        expect(kpis.medianHoursToComplete).toBeNull();
        expect(kpis.hasEnoughData).toBe(false);
        expect(kpis.byMonth).toEqual([]);
    });

    it("refuses to call one completed document a 100% completion rate", () => {
        // Arithmetically it IS 100%. `hasEnoughData` is what stops the UI
        // printing a number somebody would quote.
        const kpis = utils_Dashboard_Kpis([env({})]);
        expect(kpis.completionRate).toBe(100);
        expect(kpis.hasEnoughData).toBe(false);
    });

    it("reports rates once there is a real sample", () => {
        const rows = [
            ...Array.from({ length: 4 }, (_, i) => env({ id: `c${i}` })),
            env({ id: "d", status: "declined", completed_at: null }),
        ];
        const kpis = utils_Dashboard_Kpis(rows);
        expect(kpis.finished).toBe(5);
        expect(kpis.completed).toBe(4);
        expect(kpis.declined).toBe(1);
        expect(kpis.completionRate).toBe(80);
        expect(kpis.hasEnoughData).toBe(true);
    });

    it("ignores documents still in flight — they have not finished, not failed", () => {
        const kpis = utils_Dashboard_Kpis([
            env({ id: "a" }),
            env({ id: "b", status: "in_progress", completed_at: null }),
            env({ id: "c", status: "draft", completed_at: null, sent_at: null }),
        ]);
        expect(kpis.finished).toBe(1);
        expect(kpis.completed).toBe(1);
    });

    it("counts each terminal state separately", () => {
        const kpis = utils_Dashboard_Kpis([
            env({ id: "a" }),
            env({ id: "b", status: "declined", completed_at: null }),
            env({ id: "c", status: "expired", completed_at: null }),
            env({ id: "d", status: "cancelled", completed_at: null }),
        ]);
        expect(kpis).toMatchObject({
            completed: 1,
            declined: 1,
            expired: 1,
            voided: 1,
            finished: 4,
        });
    });

    describe("median time to complete", () => {
        const withDuration = (id: string, hours: number) =>
            env({
                id,
                sent_at: "2026-08-01T00:00:00.000Z",
                completed_at: new Date(
                    Date.parse("2026-08-01T00:00:00.000Z") + hours * 3_600_000
                ).toISOString(),
            });

        it("is the MEDIAN, so one straggler cannot define it", () => {
            // The whole reason this is not a mean. Mean here is 250h; the median
            // says what actually usually happens.
            const kpis = utils_Dashboard_Kpis([
                withDuration("a", 1),
                withDuration("b", 2),
                withDuration("c", 3),
                withDuration("d", 994),
            ]);
            expect(kpis.medianHoursToComplete).toBe(2.5);
        });

        it("averages the middle pair on an even count", () => {
            const kpis = utils_Dashboard_Kpis([withDuration("a", 2), withDuration("b", 4)]);
            expect(kpis.medianHoursToComplete).toBe(3);
        });

        it("takes the middle value on an odd count", () => {
            const kpis = utils_Dashboard_Kpis([
                withDuration("a", 1),
                withDuration("b", 5),
                withDuration("c", 99),
            ]);
            expect(kpis.medianHoursToComplete).toBe(5);
        });

        it("drops a row whose timestamps disagree rather than letting it define the median", () => {
            const backwards = env({
                id: "bad",
                sent_at: "2026-08-10T00:00:00.000Z",
                completed_at: "2026-08-01T00:00:00.000Z",
            });
            const kpis = utils_Dashboard_Kpis([withDuration("a", 4), backwards]);
            expect(kpis.medianHoursToComplete).toBe(4);
            // The document still counts as completed — only its duration is unusable.
            expect(kpis.completed).toBe(2);
        });

        it("is null when nothing was ever sent", () => {
            const kpis = utils_Dashboard_Kpis([env({ sent_at: null })]);
            expect(kpis.medianHoursToComplete).toBeNull();
        });
    });

    it("groups completions by month, oldest first", () => {
        const kpis = utils_Dashboard_Kpis([
            env({ id: "a", completed_at: "2026-07-15T00:00:00.000Z" }),
            env({ id: "b", completed_at: "2026-08-02T00:00:00.000Z" }),
            env({ id: "c", completed_at: "2026-08-20T00:00:00.000Z" }),
        ]);
        expect(kpis.byMonth).toEqual([
            { month: "2026-07", completed: 1 },
            { month: "2026-08", completed: 2 },
        ]);
    });
});

describe("utils_Dashboard_FormatHours", () => {
    it("renders an em dash for nothing to report", () => {
        expect(utils_Dashboard_FormatHours(null)).toBe("—");
    });

    it("does not pretend to sub-hour precision", () => {
        expect(utils_Dashboard_FormatHours(0.4)).toBe("under an hour");
    });

    it("uses hours, then days, then weeks", () => {
        expect(utils_Dashboard_FormatHours(5)).toBe("5h");
        expect(utils_Dashboard_FormatHours(72)).toBe("3d");
        expect(utils_Dashboard_FormatHours(24 * 21)).toBe("3w");
    });
});
