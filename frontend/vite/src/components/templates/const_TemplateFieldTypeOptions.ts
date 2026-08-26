// Intrinsic field types a template can place.
//
// NOT derived from a Postgres enum: field definitions live inside the `layout`
// JSONB (see `template.types.ts`), so there is no `{table}_{column}_enum` to
// feed `Utils_Options_EnumsToOptions`. The union in `TemplateField_Type` is the
// source of truth and this catalogue is checked against it at compile time.
//
// This list replaces the old palette, which offered one entry per
// `employee_columns` row. That coupling is what tied templates to the HR domain:
// you could only place a field that already existed as an employee column. Field
// types are intrinsic to documents, so a template now owns its own fields.

import type { TemplateField_Type } from "@/types/template.types";

export type TemplateFieldTypeOption = {
    value: TemplateField_Type;
    label: string;
    /** Shown in the palette under the label. */
    hint: string;
    /** Default box size as a fraction of the page. */
    defaultSize: { w_pct: number; h_pct: number };
};

// Single-line inputs approximate one line of text on US Letter at fit-to-width.
const const_TemplateField_SingleLineSize = { w_pct: 0.2, h_pct: 0.025 };

export const const_TemplateFieldTypeOptions: TemplateFieldTypeOption[] = [
    {
        value: "text",
        label: "Text",
        hint: "Any short free text",
        defaultSize: const_TemplateField_SingleLineSize,
    },
    {
        value: "number",
        label: "Number",
        hint: "Numeric value",
        defaultSize: const_TemplateField_SingleLineSize,
    },
    {
        value: "date",
        label: "Date",
        hint: "Calendar date",
        defaultSize: const_TemplateField_SingleLineSize,
    },
    {
        value: "choice",
        label: "Choice",
        hint: "Pick from a fixed list",
        defaultSize: const_TemplateField_SingleLineSize,
    },
    {
        value: "checkbox",
        label: "Checkbox",
        hint: "Tick to agree or confirm",
        defaultSize: { w_pct: 0.03, h_pct: 0.02 },
    },
    {
        value: "signature",
        label: "Signature",
        hint: "Drawn or uploaded signature",
        defaultSize: { w_pct: 0.3, h_pct: 0.08 },
    },
    {
        value: "initials",
        label: "Initials",
        hint: "Short initials mark",
        defaultSize: { w_pct: 0.08, h_pct: 0.04 },
    },
    {
        value: "attachment",
        label: "Attachment",
        hint: "Signer uploads a file",
        defaultSize: const_TemplateField_SingleLineSize,
    },
];

export const const_TemplateFieldTypeMap: Record<TemplateField_Type, TemplateFieldTypeOption> =
    Object.fromEntries(const_TemplateFieldTypeOptions.map((o) => [o.value, o])) as Record<
        TemplateField_Type,
        TemplateFieldTypeOption
    >;

/**
 * Types whose box is one line of text tall. They resize on the horizontal axis
 * only — a taller box would misrepresent how the value burns onto the page.
 */
export const const_TemplateField_SingleLineTypes = new Set<TemplateField_Type>([
    "text",
    "number",
    "date",
    "choice",
    "attachment",
]);

/**
 * Mints a field id unique within the template.
 *
 * Ids are the layout's identity (`TemplateField.id`) — v1 keyed fields by their
 * bare `key`, which is why a template could hold one field per employee column
 * and no more. Two date fields on one page is the whole point of the change, so
 * identity had to stop being the human-facing key.
 */
export const utils_Templates_NewFieldId = (existingIds: readonly string[]): string => {
    const taken = new Set(existingIds);
    for (let n = 1; ; n += 1) {
        const candidate = `tfd_${n}`;
        if (!taken.has(candidate)) return candidate;
    }
};

/**
 * Generates a key that is unique within the template.
 *
 * Keys stay human-meaningful (`text_1`, `signature_2`) because they are the
 * merge-field surface the API and any future document-generation path address
 * fields by — a random id would be unusable there. Identity for lookup is
 * `TemplateField.id`; this is for humans and integrations.
 */
export const utils_Templates_NextFieldKey = (
    type: TemplateField_Type,
    existingKeys: readonly string[]
): string => {
    const taken = new Set(existingKeys);
    for (let n = 1; ; n += 1) {
        const candidate = `${type}_${n}`;
        if (!taken.has(candidate)) return candidate;
    }
};
