import { describe, expect, it } from "vitest";
import type { TemplateField, TemplateLayout } from "@/types/template.types";
import {
    const_Trial_Steps,
    utils_Trial_BlockedReason,
    utils_Trial_FillableFields,
    utils_Trial_StepIndex,
} from "./utils_Trial_Steps";
import { const_Trial_MaxFields, const_Trial_MaxPages } from "@/utils/pdf/const_TrialLimits";

const makeField = (over: Partial<TemplateField> = {}): TemplateField => ({
    id: "tfd_1",
    key: "text_1",
    label: "Text",
    type: "text",
    role_id: "rol_signer",
    required: false,
    page: 1,
    x_pct: 0.1,
    y_pct: 0.1,
    w_pct: 0.2,
    h_pct: 0.025,
    ...over,
});

const base = {
    hasFile: true,
    layout: [makeField()] as TemplateLayout,
    numPages: 2,
    signature: "data:image/png;base64,xxx",
};

describe("step order", () => {
    it("runs upload → place → sign", () => {
        expect(const_Trial_Steps).toEqual(["upload", "place", "sign"]);
        expect(utils_Trial_StepIndex("place")).toBe(1);
    });
});

describe("utils_Trial_BlockedReason", () => {
    it("blocks the upload step until there is a file", () => {
        expect(utils_Trial_BlockedReason({ ...base, step: "upload", hasFile: false })).toBe(
            "Upload a PDF to continue"
        );
        expect(utils_Trial_BlockedReason({ ...base, step: "upload" })).toBeNull();
    });

    it("blocks the place step until a field is placed", () => {
        expect(utils_Trial_BlockedReason({ ...base, step: "place", layout: [] })).toBe(
            "Place at least one field on the document"
        );
        expect(utils_Trial_BlockedReason({ ...base, step: "place" })).toBeNull();
    });

    it("blocks on too many fields", () => {
        const layout = Array.from({ length: const_Trial_MaxFields + 1 }, (_, i) =>
            makeField({ id: `tfd_${i}` })
        );
        expect(utils_Trial_BlockedReason({ ...base, step: "place", layout })).toContain(
            String(const_Trial_MaxFields)
        );
    });

    it("allows exactly the maximum number of fields", () => {
        const layout = Array.from({ length: const_Trial_MaxFields }, (_, i) =>
            makeField({ id: `tfd_${i}` })
        );
        expect(utils_Trial_BlockedReason({ ...base, step: "place", layout })).toBeNull();
    });

    it("blocks a document with too many pages, on advance rather than on upload", () => {
        // The page count is only known after pdf.js parses the file, so this
        // check belongs here — refusing at upload time is not possible, and
        // refusing later would throw away work already done.
        expect(
            utils_Trial_BlockedReason({
                ...base,
                step: "place",
                numPages: const_Trial_MaxPages + 1,
            })
        ).toContain(String(const_Trial_MaxPages));
    });

    it("blocks the sign step until a signature is captured", () => {
        expect(utils_Trial_BlockedReason({ ...base, step: "sign", signature: null })).toBe(
            "Add your signature to continue"
        );
        expect(utils_Trial_BlockedReason({ ...base, step: "sign" })).toBeNull();
    });
});

describe("utils_Trial_FillableFields", () => {
    it("excludes signature and initials — those are the sign step's job", () => {
        const layout = [
            makeField({ id: "a", type: "text" }),
            makeField({ id: "b", type: "signature" }),
            makeField({ id: "c", type: "initials" }),
            makeField({ id: "d", type: "date" }),
        ];
        expect(utils_Trial_FillableFields(layout).map((f) => f.id)).toEqual(["a", "d"]);
    });

    it("orders by page, then down the page, then across it", () => {
        const layout = [
            makeField({ id: "p2", page: 2, y_pct: 0.1, x_pct: 0.1 }),
            makeField({ id: "low", page: 1, y_pct: 0.8, x_pct: 0.1 }),
            makeField({ id: "high-right", page: 1, y_pct: 0.2, x_pct: 0.9 }),
            makeField({ id: "high-left", page: 1, y_pct: 0.2, x_pct: 0.1 }),
        ];
        expect(utils_Trial_FillableFields(layout).map((f) => f.id)).toEqual([
            "high-left",
            "high-right",
            "low",
            "p2",
        ]);
    });

    it("does not mutate the layout it is given", () => {
        // It sorts, and `Array.prototype.sort` is in-place — the copy matters
        // because this runs on the page's own React state.
        const layout = [makeField({ id: "b", y_pct: 0.9 }), makeField({ id: "a", y_pct: 0.1 })];
        utils_Trial_FillableFields(layout);
        expect(layout.map((f) => f.id)).toEqual(["b", "a"]);
    });
});
