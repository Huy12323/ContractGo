// Half of what makes duplicating `_shared/pdfBurn.ts` acceptable.
//
// The expected values here are TRANSCRIBED from that module's drawing loop, by
// hand, rather than computed with the same expressions this file is testing —
// a test that reuses the implementation's arithmetic proves only that the
// arithmetic equals itself. The other half is
// `tests/unit/edge/pdfBurn.geometryParity.test.ts`, which runs the real burn.

import { describe, expect, it } from "vitest";
import {
    utils_PdfBurn_FitImage,
    utils_PdfBurn_IsImageField,
    utils_PdfBurn_IsUndrawnField,
    utils_PdfBurn_Rect,
    utils_PdfBurn_TextForValue,
    utils_PdfBurn_TextLayout,
} from "./utils_PdfBurn_Geometry";

// US Letter at 72dpi — the page size the builder's percentages were tuned on.
const PAGE_W = 612;
const PAGE_H = 792;

describe("utils_PdfBurn_Rect", () => {
    it("flips the origin from top-left to bottom-left", () => {
        // A box 10% from the top, 5% tall, on a 792pt page: its TOP edge is at
        // 79.2 from the top, so its BOTTOM edge is 792 - 79.2 - 39.6 = 673.2
        // from the bottom.
        const rect = utils_PdfBurn_Rect(
            { x_pct: 0.25, y_pct: 0.1, w_pct: 0.2, h_pct: 0.05 },
            PAGE_W,
            PAGE_H
        );
        expect(rect.x).toBeCloseTo(153, 6);
        expect(rect.y).toBeCloseTo(673.2, 6);
        expect(rect.boxW).toBeCloseTo(122.4, 6);
        expect(rect.boxH).toBeCloseTo(39.6, 6);
    });

    it("puts a box at the very top flush against the page top", () => {
        const rect = utils_PdfBurn_Rect(
            { x_pct: 0, y_pct: 0, w_pct: 1, h_pct: 0.1 },
            PAGE_W,
            PAGE_H
        );
        expect(rect.x).toBe(0);
        expect(rect.y).toBeCloseTo(712.8, 6);
        expect(rect.y + rect.boxH).toBeCloseTo(PAGE_H, 6);
    });

    it("puts a box at the very bottom at y = 0", () => {
        const rect = utils_PdfBurn_Rect(
            { x_pct: 0, y_pct: 0.9, w_pct: 1, h_pct: 0.1 },
            PAGE_W,
            PAGE_H
        );
        expect(rect.y).toBeCloseTo(0, 6);
    });

    it("scales with the page rather than assuming Letter", () => {
        // A4 at 72dpi.
        const rect = utils_PdfBurn_Rect(
            { x_pct: 0.5, y_pct: 0.5, w_pct: 0.25, h_pct: 0.05 },
            595.28,
            841.89
        );
        expect(rect.x).toBeCloseTo(297.64, 6);
        expect(rect.boxW).toBeCloseTo(148.82, 6);
        expect(rect.y).toBeCloseTo(841.89 - 0.55 * 841.89, 6);
    });
});

describe("utils_PdfBurn_FitImage", () => {
    const rect = { x: 100, y: 200, boxW: 200, boxH: 50 };

    it("fits a wide image by width and centres it vertically", () => {
        // 400x100 into 200x50: min(200/400, 50/100) = 0.5 both ways, exact fit.
        const fit = utils_PdfBurn_FitImage(rect, 400, 100);
        expect(fit.width).toBe(200);
        expect(fit.height).toBe(50);
        expect(fit.x).toBe(100);
        expect(fit.y).toBe(200);
    });

    it("preserves aspect ratio rather than stretching to fill", () => {
        // 100x100 into 200x50: scale is 0.5, so 50x50 centred horizontally.
        const fit = utils_PdfBurn_FitImage(rect, 100, 100);
        expect(fit.width).toBe(50);
        expect(fit.height).toBe(50);
        expect(fit.x).toBe(100 + (200 - 50) / 2);
        expect(fit.y).toBe(200);
        expect(fit.width / fit.height).toBeCloseTo(1, 6);
    });

    it("scales a small image UP to fill the box", () => {
        // Not a no-op guard: the signature pad's 480px-wide PNG is often smaller
        // than the box it lands in, and `Math.min` of two ratios > 1 is > 1.
        const fit = utils_PdfBurn_FitImage(rect, 50, 25);
        expect(fit.width).toBe(100);
        expect(fit.height).toBe(50);
    });
});

describe("utils_PdfBurn_TextLayout", () => {
    it("caps the font at 14pt in a tall box", () => {
        const layout = utils_PdfBurn_TextLayout({ x: 10, y: 20, boxW: 100, boxH: 100 });
        expect(layout.size).toBe(14);
        expect(layout.y).toBe(20 + (100 - 14) / 2);
    });

    it("uses 80% of the box height in a short box", () => {
        const layout = utils_PdfBurn_TextLayout({ x: 10, y: 20, boxW: 100, boxH: 10 });
        expect(layout.size).toBeCloseTo(8, 6);
        expect(layout.y).toBeCloseTo(20 + (10 - 8) / 2, 6);
    });

    it("insets x by 2 and maxWidth by 4 so glyphs clear the border", () => {
        const layout = utils_PdfBurn_TextLayout({ x: 10, y: 20, boxW: 100, boxH: 20 });
        expect(layout.x).toBe(12);
        expect(layout.maxWidth).toBe(96);
    });
});

describe("utils_PdfBurn_TextForValue", () => {
    it("draws nothing for an unfilled field", () => {
        expect(utils_PdfBurn_TextForValue("text", undefined)).toBeNull();
        expect(utils_PdfBurn_TextForValue("text", null)).toBeNull();
        expect(utils_PdfBurn_TextForValue("text", "")).toBeNull();
    });

    it("draws a zero, which is a value and not an empty field", () => {
        expect(utils_PdfBurn_TextForValue("number", 0)).toBe("0");
    });

    it("draws X for a ticked checkbox and nothing for an unticked one", () => {
        expect(utils_PdfBurn_TextForValue("checkbox", true)).toBe("X");
        expect(utils_PdfBurn_TextForValue("checkbox", "true")).toBe("X");
        expect(utils_PdfBurn_TextForValue("checkbox", false)).toBeNull();
        // The string "false" arrives from form serialisation and must not tick.
        expect(utils_PdfBurn_TextForValue("checkbox", "false")).toBeNull();
    });

    it("resolves a choice to its label", () => {
        const options = [
            { label: "Annual", value: "annual" },
            { label: "Monthly", value: "monthly" },
        ];
        expect(utils_PdfBurn_TextForValue("choice", "monthly", options)).toBe("Monthly");
    });

    it("falls back to the raw value when the option is gone", () => {
        // A layout can outlive an options list; showing the stored value beats
        // showing nothing on a contract.
        expect(utils_PdfBurn_TextForValue("choice", "legacy", [])).toBe("legacy");
        expect(utils_PdfBurn_TextForValue("choice", "legacy")).toBe("legacy");
    });

    it("stringifies everything else", () => {
        expect(utils_PdfBurn_TextForValue("date", "2026-08-28")).toBe("2026-08-28");
        expect(utils_PdfBurn_TextForValue("text", "Nguyễn Tuấn Huy")).toBe("Nguyễn Tuấn Huy");
    });
});

describe("field-type predicates", () => {
    it("treats signature and initials as images", () => {
        expect(utils_PdfBurn_IsImageField("signature")).toBe(true);
        expect(utils_PdfBurn_IsImageField("initials")).toBe(true);
        expect(utils_PdfBurn_IsImageField("text")).toBe(false);
    });

    it("draws nothing for an attachment", () => {
        expect(utils_PdfBurn_IsUndrawnField("attachment")).toBe(true);
        expect(utils_PdfBurn_IsUndrawnField("text")).toBe(false);
    });
});
