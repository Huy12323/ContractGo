// AHR-1954: Type surface for contract template kinds and snapshots.
//
// The `layout` JSONB column on contract_templates / contract_template_versions
// is intentionally left as `Json` at the DB-types level (no override in
// database.override.types.ts) — both kinds (`tiptap`, `pdf`) ride the same
// column and consumers cast at use sites based on the `type` discriminator.
// Same applies to template_snapshot on onboarding_invitations / contracts.

import type { JSONContent } from "@tiptap/core";

// ============================================================
// PDF kind — positioned-field layout shape
// ============================================================

export type Pdf_FieldType = "text" | "choice" | "date" | "signature";

/**
 * One positioned field on a PDF page. Coordinates are 0–1 floats relative to
 * the page dimensions — resolution-independent so PDF zoom doesn't break
 * placement and the same layout renders correctly across builder, filler,
 * and burn surfaces.
 */
export type PdfLayout_PositionedField = {
    key: string;          // employee_column id or universal field key
    page: number;         // 1-indexed
    x_pct: number;        // 0–1 (left edge from page left)
    y_pct: number;        // 0–1 (top edge from page top)
    w_pct: number;        // 0–1 (width relative to page width)
    h_pct: number;        // 0–1 (height relative to page height)
    type: Pdf_FieldType;
};

export type PdfLayout = PdfLayout_PositionedField[];

// ============================================================
// template_snapshot shapes
// ============================================================
// Both invitation.template_snapshot and contract.template_snapshot are
// self-sufficient: PDF-kind rows can be rendered + burned even if their
// source contract_template / contract_template_version is later hard-deleted
// (AHR-1487 self-sufficiency invariant).

/**
 * Shape of contract.template_snapshot. Bare layout payload + kind discriminator
 * + source PDF path. No validation metadata — those keys live on the invitation
 * snapshot only (signed contracts don't need to revalidate post-sign).
 */
export type ContractTemplate_Snapshot =
    | { type: "tiptap"; layout: JSONContent; pdf_file_path: null }
    | { type: "pdf"; layout: PdfLayout; pdf_file_path: string };

/**
 * Shape of onboarding_invitations.template_snapshot. Carries everything the
 * filler + submit-validation need: layout, kind, source PDF path, and the
 * three field-key sets (mandatory / hr / attachment).
 */
export type Invitation_TemplateSnapshot = ContractTemplate_Snapshot & {
    mandatory_field_keys: string[];
    hr_field_keys: string[];
    attachment_field_keys: string[];
};
