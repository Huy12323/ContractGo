import { describe, expect, it } from "vitest";
import type { TemplateField } from "@/types/template.types";
import { const_Template_SignerRoleId } from "@/types/template.types";
import {
    const_Trial_SignerRole,
    utils_Trial_NormalizeField,
    utils_Trial_ToSigningFields,
} from "./utils_Trial_Layout";

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

describe("utils_Trial_ToSigningFields", () => {
    it("marks signature and initials as NOT editable", () => {
        // The invariant `signing_session_open` maintains, mirrored locally: the
        // filler renders a non-editable signature box as a mark. Invert this and
        // a text input appears inside the signature box and nothing burns.
        const fields = utils_Trial_ToSigningFields([
            makeField({ id: "sig", type: "signature" }),
            makeField({ id: "ini", type: "initials" }),
        ]);
        expect(fields.every((f) => f.editable)).toBe(false);
        expect(fields.map((f) => f.editable)).toEqual([false, false]);
    });

    it("marks every other type as editable", () => {
        const fields = utils_Trial_ToSigningFields([
            makeField({ id: "t", type: "text" }),
            makeField({ id: "d", type: "date" }),
            makeField({ id: "c", type: "checkbox" }),
        ]);
        expect(fields.map((f) => f.editable)).toEqual([true, true, true]);
    });

    it("carries the geometry through untouched", () => {
        const field = makeField({ x_pct: 0.42, y_pct: 0.61, w_pct: 0.25, h_pct: 0.09, page: 3 });
        const [signing] = utils_Trial_ToSigningFields([field]);
        expect(signing).toMatchObject({
            page: 3,
            x_pct: 0.42,
            y_pct: 0.61,
            w_pct: 0.25,
            h_pct: 0.09,
        });
    });
});

describe("const_Trial_SignerRole", () => {
    it("reuses the product's default signer role id", () => {
        // So a trial layout is structurally a layout the real product would
        // accept, rather than one carrying a role id nothing else knows.
        expect(const_Trial_SignerRole.id).toBe(const_Template_SignerRoleId);
    });
});

describe("utils_Trial_NormalizeField", () => {
    it("pins every field to the single trial role", () => {
        expect(utils_Trial_NormalizeField(makeField({ role_id: "rol_other" })).role_id).toBe(
            const_Trial_SignerRole.id
        );
    });

    it("never marks a field required", () => {
        // A required-but-empty field would block the download, and the trial has
        // no reason to withhold the visitor's own document over one.
        expect(utils_Trial_NormalizeField(makeField({ required: true })).required).toBe(false);
    });
});
