import { describe, expect, it, vi } from "vitest";
import { const_Template_SenderRoleId, const_Template_SignerRoleId } from "@/types/template.types";
import {
    const_Templates_DefaultSignerRoles,
    isLayoutV1,
    utils_Templates_MigrateLayout,
    utils_Templates_MigrateSignerRoles,
} from "./utils_Templates_MigrateLayout";

/**
 * The belt-and-braces v1 -> v2 layout shim. It runs on rows CG-001 could not
 * reach, which by definition are rows nobody has looked at — so its behaviour is
 * only ever observed when something has already gone wrong. The determinism
 * claim in particular is asserted in a comment and nowhere else.
 */

const v1Field = (over: Record<string, unknown> = {}) => ({
    key: "first_name",
    page: 1,
    x_pct: 10,
    y_pct: 20,
    w_pct: 30,
    h_pct: 5,
    ...over,
});

describe("isLayoutV1", () => {
    it("detects v1 by the ABSENCE of id/label, not by layout_version", () => {
        // Older rows never carried layout_version at all, so checking it would
        // misclassify exactly the rows this shim exists for.
        expect(isLayoutV1([v1Field()])).toBe(true);
        expect(isLayoutV1([{ ...v1Field(), id: "tfd_1", label: "First Name" }])).toBe(false);
    });

    it("is false for non-arrays and empty arrays", () => {
        expect(isLayoutV1([])).toBe(false);
        expect(isLayoutV1(null)).toBe(false);
        expect(isLayoutV1({})).toBe(false);
        expect(isLayoutV1("[]")).toBe(false);
    });
});

describe("utils_Templates_MigrateLayout", () => {
    // The shim warns on every v1 row it sees; that is intended, and noisy here.
    const migrate = (...args: Parameters<typeof utils_Templates_MigrateLayout>) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            return utils_Templates_MigrateLayout(...args);
        } finally {
            warn.mockRestore();
        }
    };

    it("returns v2 layouts untouched, so it is safe to call unconditionally", () => {
        const v2 = [{ ...v1Field(), id: "tfd_1", label: "First Name", type: "text" }];
        expect(utils_Templates_MigrateLayout(v2)).toBe(v2);
    });

    it("returns [] for a non-array", () => {
        expect(utils_Templates_MigrateLayout(null)).toEqual([]);
        expect(utils_Templates_MigrateLayout({ doc: "prosemirror" })).toEqual([]);
    });

    it("resolves the five universal keys to canonical labels and types", () => {
        const keys = ["email", "first_name", "last_name", "birthday", "signature"];
        const out = migrate(keys.map((key) => v1Field({ key })));
        expect(out.map((f) => f.label)).toEqual([
            "Email",
            "First Name",
            "Last Name",
            "Birthday",
            "Signature",
        ]);
        expect(out.map((f) => f.type)).toEqual(["text", "text", "text", "date", "signature"]);
    });

    it("degrades an unknown key to key-as-label rather than throwing", () => {
        // Visibly wrong but recoverable by hand — the right failure mode for
        // something that should never happen. Labels lived in employee_columns,
        // which no longer exists, so they genuinely cannot be recovered here.
        const [field] = migrate([v1Field({ key: "tax_file_number" })]);
        expect(field!.label).toBe("tax_file_number");
        expect(field!.type).toBe("text");
    });

    it("produces deterministic ids — running the shim twice is identical", () => {
        const layout = [v1Field({ key: "a" }), v1Field({ key: "b" }), v1Field({ key: "a" })];
        expect(migrate(layout)).toEqual(migrate(layout));
        expect(migrate(layout).map((f) => f.id)).toEqual([
            "tfd_v1_a_0",
            "tfd_v1_b_1",
            "tfd_v1_a_2",
        ]);
    });

    it("preserves geometry verbatim", () => {
        const [field] = migrate([v1Field({ page: 3, x_pct: 1.5, y_pct: 2.5, w_pct: 4, h_pct: 6 })]);
        expect(field).toMatchObject({ page: 3, x_pct: 1.5, y_pct: 2.5, w_pct: 4, h_pct: 6 });
    });

    it("routes hr keys to the sender role and everything else to the signer role", () => {
        const out = migrate([v1Field({ key: "company" }), v1Field({ key: "first_name" })], {
            hr_field_keys: ["company"],
        });
        expect(out[0]!.role_id).toBe(const_Template_SenderRoleId);
        expect(out[1]!.role_id).toBe(const_Template_SignerRoleId);
    });

    it("marks mandatory keys required and attachment keys as attachments", () => {
        const out = migrate([v1Field({ key: "id_doc" }), v1Field({ key: "first_name" })], {
            mandatory_field_keys: ["id_doc"],
            attachment_field_keys: ["id_doc"],
        });
        expect(out[0]).toMatchObject({ required: true, type: "attachment" });
        expect(out[1]).toMatchObject({ required: false, type: "text" });
    });

    it("defaults the key arrays to empty when omitted", () => {
        const [field] = migrate([v1Field({ key: "anything" })]);
        expect(field!.required).toBe(false);
        expect(field!.role_id).toBe(const_Template_SignerRoleId);
    });
});

describe("utils_Templates_MigrateSignerRoles", () => {
    it("seeds the default roles when a pre-v2 row has none", () => {
        expect(utils_Templates_MigrateSignerRoles(null)).toBe(const_Templates_DefaultSignerRoles);
        expect(utils_Templates_MigrateSignerRoles([])).toBe(const_Templates_DefaultSignerRoles);
    });

    it("leaves existing roles alone", () => {
        const roles = [{ id: "rol_x", name: "X", order: 1, color: "#000" }];
        expect(utils_Templates_MigrateSignerRoles(roles)).toBe(roles);
    });

    it("seeds a sender at order 0 and a signer at order 1", () => {
        expect(const_Templates_DefaultSignerRoles.map((r) => r.order)).toEqual([0, 1]);
    });
});
