// Runtime layout v1 -> v2 upgrade shim.
//
// Migration CG-001 converted every stored layout and snapshot in the database.
// This is belt-and-braces for the rows it could not reach: a snapshot written by
// an in-flight request while the migration ran, a row restored from an older
// backup, or a production environment where CG-001 partially failed.
//
// It deliberately CANNOT recover what the SQL migration could: labels, types and
// choice options lived in `employee_columns` / `employee_column_choices`, which
// no longer exist. A v1 row reaching this shim degrades to key-as-label rather
// than crashing the builder — visibly wrong, but recoverable by hand, which is
// the right failure mode for something that should never happen.
//
// Mirrors the resolution precedence of the CG-001 SQL function so the two paths
// cannot drift: universal key -> (column lookup, unavailable here) -> fallback.

import {
    const_Template_SenderRoleId,
    const_Template_SignerRoleId,
    type SignerRole,
    type TemplateField,
    type TemplateField_Type,
    type TemplateLayout,
} from "@/types/template.types";

/** The four keys that were never employee columns. Kept in sync with CG-001. */
const const_Templates_UniversalFields: Record<string, { label: string; type: TemplateField_Type }> =
    {
        email: { label: "Email", type: "text" },
        first_name: { label: "First Name", type: "text" },
        last_name: { label: "Last Name", type: "text" },
        birthday: { label: "Birthday", type: "date" },
        signature: { label: "Signature", type: "signature" },
    };

export const const_Templates_DefaultSignerRoles: SignerRole[] = [
    { id: const_Template_SenderRoleId, name: "Sender", order: 0, color: "#6366f1" },
    { id: const_Template_SignerRoleId, name: "Signer", order: 1, color: "#2d7a4f" },
];

type LayoutV1Field = {
    key: string;
    page: number;
    x_pct: number;
    y_pct: number;
    w_pct: number;
    h_pct: number;
    type?: string;
};

/**
 * A v1 entry is identified by the ABSENCE of the v2 marker fields. Checking for
 * a missing `id`/`label` is more robust than checking `layout_version`, which
 * older rows never carried at all.
 */
export const isLayoutV1 = (layout: unknown): boolean => {
    if (!Array.isArray(layout) || layout.length === 0) return false;
    const first = layout[0] as Record<string, unknown>;
    return typeof first?.key === "string" && (first.id === undefined || first.label === undefined);
};

const upgradeField = (
    field: LayoutV1Field,
    index: number,
    hrKeys: string[],
    mandatoryKeys: string[],
    attachmentKeys: string[]
): TemplateField => {
    const universal = const_Templates_UniversalFields[field.key];

    let type: TemplateField_Type = universal?.type ?? (field.type as TemplateField_Type) ?? "text";
    if (attachmentKeys.includes(field.key)) type = "attachment";
    else if (field.type === "signature") type = "signature";

    return {
        // Deterministic rather than random: re-running the shim on the same row
        // must not produce a different id each render.
        id: `tfd_v1_${field.key}_${index}`,
        key: field.key,
        label: universal?.label ?? field.key,
        type,
        role_id: hrKeys.includes(field.key)
            ? const_Template_SenderRoleId
            : const_Template_SignerRoleId,
        required: mandatoryKeys.includes(field.key),
        page: field.page,
        x_pct: field.x_pct,
        y_pct: field.y_pct,
        w_pct: field.w_pct,
        h_pct: field.h_pct,
    };
};

/**
 * Upgrades a v1 layout in memory. Returns v2 layouts untouched, so it is safe to
 * call unconditionally at every read site.
 */
export const utils_Templates_MigrateLayout = (
    layout: unknown,
    keyArrays?: {
        hr_field_keys?: string[];
        mandatory_field_keys?: string[];
        attachment_field_keys?: string[];
    }
): TemplateLayout => {
    if (!Array.isArray(layout)) return [];
    if (!isLayoutV1(layout)) return layout as TemplateLayout;

    console.warn(
        "[ContractGo] layout v1 encountered at runtime — CG-001 did not reach this row. " +
            "Labels and choice options cannot be recovered client-side; re-check this template."
    );

    const hrKeys = keyArrays?.hr_field_keys ?? [];
    const mandatoryKeys = keyArrays?.mandatory_field_keys ?? [];
    const attachmentKeys = keyArrays?.attachment_field_keys ?? [];

    return (layout as LayoutV1Field[]).map((field, index) =>
        upgradeField(field, index, hrKeys, mandatoryKeys, attachmentKeys)
    );
};

/** Roles are seeded when a pre-v2 row has none. */
export const utils_Templates_MigrateSignerRoles = (signerRoles: unknown): SignerRole[] =>
    Array.isArray(signerRoles) && signerRoles.length > 0
        ? (signerRoles as SignerRole[])
        : const_Templates_DefaultSignerRoles;

/**
 * Write-boundary upgrade: folds the legacy key sets INTO a positioned layout,
 * producing self-describing v2 fields.
 *
 * The inverse of `utils_Templates_DeriveKeySets`. The form builder still keeps
 * its internal model as "a bare layout plus three key sets", so this converts at
 * the moment of saving — nothing v1-shaped ever reaches the database.
 *
 * `resolveLabel` supplies the label/type the builder would previously have
 * looked up at render time. Inlining it here is the whole point: once written,
 * the field no longer depends on `employee_columns` existing.
 *
 * Non-array layouts (the retired tiptap kind's ProseMirror doc) pass through.
 */
export const utils_Templates_ApplyKeySetsToLayout = (
    layout: unknown,
    keySets: {
        mandatory_field_keys: string[];
        hr_field_keys: string[];
        attachment_field_keys: string[];
    },
    resolveLabel: (key: string) => { label: string; type: string }
): unknown => {
    if (!Array.isArray(layout)) return layout;

    return (layout as LayoutV1Field[]).map((field, index) => {
        const resolved = resolveLabel(field.key);
        const existing = field as Partial<TemplateField>;

        let type: TemplateField_Type;
        if (keySets.attachment_field_keys.includes(field.key)) type = "attachment";
        else if (field.type === "signature") type = "signature";
        else type = normalizeFieldType(resolved.type ?? field.type);

        return {
            id: existing.id ?? `tfd_${field.key}_${index}`,
            key: field.key,
            label: existing.label ?? resolved.label ?? field.key,
            type,
            role_id: keySets.hr_field_keys.includes(field.key)
                ? const_Template_SenderRoleId
                : const_Template_SignerRoleId,
            required: keySets.mandatory_field_keys.includes(field.key),
            ...(existing.options ? { options: existing.options } : {}),
            page: field.page,
            x_pct: field.x_pct,
            y_pct: field.y_pct,
            w_pct: field.w_pct,
            h_pct: field.h_pct,
        } satisfies TemplateField;
    });
};

/** Maps an employee_column type (or a raw layout type) onto the v2 field types. */
const normalizeFieldType = (raw: string | undefined): TemplateField_Type => {
    switch (raw) {
        case "number":
            return "number";
        case "date":
        case "birthday":
            return "date";
        case "boolean":
            return "checkbox";
        case "single_select":
        case "multi_select":
        case "choice":
            return "choice";
        case "file":
        case "attachment":
            return "attachment";
        case "signature":
            return "signature";
        case "initials":
            return "initials";
        default:
            return "text";
    }
};

/**
 * Derives the legacy `hr` / `mandatory` / `attachment` key sets from a v2 layout.
 *
 * CG-001 dropped those three columns because they conflated "who fills this"
 * with "is this required" and duplicated facts the layout already carries. The
 * facts themselves did not go away — they are now `role_id` and `required` on
 * each field, so the old sets are a pure projection of the layout.
 *
 * This exists so the pre-v2 consumers (`App_FormBuilderModal`,
 * `App_OnboardingWizardModal`, `App_ContractTemplateVersionsModal`) keep working
 * unchanged while sourcing truth from v2. It is a BRIDGE, not the destination —
 * those components are rewritten onto roles directly in the builder/filler
 * generalization, at which point this can go.
 */
export const utils_Templates_DeriveKeySets = (
    layout: unknown
): { mandatory_field_keys: string[]; hr_field_keys: string[]; attachment_field_keys: string[] } => {
    const fields = utils_Templates_MigrateLayout(layout);

    return {
        mandatory_field_keys: fields.filter((f) => f.required).map((f) => f.key),
        hr_field_keys: fields
            .filter((f) => f.role_id === const_Template_SenderRoleId)
            .map((f) => f.key),
        attachment_field_keys: fields.filter((f) => f.type === "attachment").map((f) => f.key),
    };
};
