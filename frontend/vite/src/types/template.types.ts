// ContractGo template type surface (layout v2).
//
// Replaces the AHR-1954 `contractTemplate.types.ts`, which described fields by
// BARE KEY and resolved their label / type / options at render time by looking
// up `employee_columns` + `employee_column_choices`. That coupling is gone:
// v2 fields are SELF-DESCRIBING, so a template — or a snapshot of one — renders
// with no reference to any other table. This is what lets a sent document
// outlive the template it came from (the AHR-1487/1490/1954 self-sufficiency
// invariant), and it is what allows the HR domain to be dropped.
//
// The other half of the change: v1 encoded "who fills this" and "is this
// required" as a single tri-state spread across three parallel key arrays
// (`hr_field_keys` / `mandatory_field_keys` / `attachment_field_keys`). Those
// are two orthogonal facts and are now two fields — `role_id` and `required`.
//
// Migration CG-001 converted every stored layout and snapshot; see
// `utils_Templates_MigrateLayout.ts` for the defensive runtime shim.

import type { JSONContent } from "@tiptap/core";

// ============================================================
// Signer roles
// ============================================================

/**
 * A named party a template expects. Stored on `contract_templates.signer_roles`
 * and copied into every snapshot. `id` is referenced by
 * `TemplateField.role_id` — never the array index, so roles can be reordered
 * without rewriting the layout.
 */
export type SignerRole = {
    id: string;
    name: string;
    /** Signing position. Roles sharing an order sign in parallel. */
    order: number;
    /** Badge colour in the builder and filler. */
    color: string;
};

/** Seeded by CG-001 for every pre-existing template. */
export const const_Template_SenderRoleId = "rol_sender";
export const const_Template_SignerRoleId = "rol_signer";

// ============================================================
// Fields
// ============================================================

export type TemplateField_Type =
    | "text"
    | "number"
    | "date"
    | "choice"
    | "checkbox"
    | "signature"
    | "initials"
    | "attachment";

export type TemplateField_Option = {
    label: string;
    value: string;
};

/**
 * One positioned, self-describing field on a PDF page.
 *
 * Coordinates are 0–1 floats relative to the page box — resolution-independent,
 * so zoom level and page size never affect placement, and the builder, filler
 * and server-side burn all agree.
 */
export type TemplateField = {
    /** Stable identity (`tfd_*`). Field lookup keys on this, not on `key`. */
    id: string;
    /** Machine key — stable, human-meaningful, unique within a template. */
    key: string;
    /** Inlined. Never resolved by lookup. */
    label: string;
    type: TemplateField_Type;
    /** Which signer role fills this — see `SignerRole.id`. */
    role_id: string;
    required: boolean;
    /** Present for `choice` fields only. Inlined, replacing employee_column_choices. */
    options?: TemplateField_Option[];
    default_value?: string;
    /** Pre-filled by the sender; visible to the signer but not editable. */
    read_only?: boolean;

    page: number; // 1-indexed
    x_pct: number; // 0–1 from page left
    y_pct: number; // 0–1 from page top
    w_pct: number; // 0–1 of page width
    h_pct: number; // 0–1 of page height
};

export type TemplateLayout = TemplateField[];

// ============================================================
// Snapshots
// ============================================================
// Both snapshot shapes must be self-sufficient: everything needed to render,
// validate and burn the document has to be inside the snapshot itself.

/**
 * `pdf` is the supported kind. `tiptap` is retained only so pre-existing rows
 * still type-check — creation is blocked and the UI is gone. Its `layout` is a
 * ProseMirror document, not a field array.
 */
export type Template_Snapshot =
    | {
          type: "pdf";
          layout: TemplateLayout;
          pdf_file_path: string;
          signer_roles: SignerRole[];
          /** Absent on un-migrated v1 rows — see isLayoutV1(). */
          layout_version?: 2;
      }
    | {
          type: "tiptap";
          layout: JSONContent;
          pdf_file_path: null;
          signer_roles: SignerRole[];
          layout_version?: 2;
      };

/** Narrowing helper — the PDF kind is the only one with positioned fields. */
export const isPdfSnapshot = (
    snapshot: Template_Snapshot
): snapshot is Extract<Template_Snapshot, { type: "pdf" }> => snapshot.type === "pdf";

/** Fields this role is responsible for, in page then vertical order. */
export const utils_Template_FieldsForRole = (
    layout: TemplateLayout,
    roleId: string
): TemplateLayout =>
    layout
        .filter((field) => field.role_id === roleId)
        .sort((a, b) => a.page - b.page || a.y_pct - b.y_pct);

export const utils_Template_RequiredFieldsForRole = (
    layout: TemplateLayout,
    roleId: string
): TemplateLayout => utils_Template_FieldsForRole(layout, roleId).filter((f) => f.required);
