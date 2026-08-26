// Signer-role colours and role factory.
//
// Roles replace the old fixed tri-state (`hr` / `mandatory` / `optional`), which
// hard-coded exactly one non-employee filler and could never express a second
// counterparty. A role's colour is the only way a builder user tells at a glance
// who fills which box, so it is stored on the role (`SignerRole.color`) and
// snapshotted with it — a sent document must render its legend after the
// template is gone.
//
// Hex literals, not ANTD tokens: these values are persisted into `signer_roles`
// JSONB and into every snapshot, so they have to be stable across theme changes
// and readable by the server-side burn. They are chosen to stay distinguishable
// on both light and dark page backgrounds.

import type { SignerRole } from "@/types/template.types";

export const const_TemplateSignerRoleColors = [
    "#1677ff", // blue
    "#52c41a", // green
    "#fa8c16", // orange
    "#722ed1", // purple
    "#eb2f96", // magenta
    "#13c2c2", // cyan
    "#a0522d", // brown
    "#595959", // grey
] as const satisfies readonly string[];

/** Next unused colour, wrapping once the palette is exhausted. */
export const utils_TemplateRoles_NextColor = (existing: readonly SignerRole[]): string => {
    const taken = new Set(existing.map((r) => r.color));
    const unused = const_TemplateSignerRoleColors.find((c) => !taken.has(c));
    if (unused) return unused;
    // Palette exhausted — wrap. Duplicate colours are worse than an error here:
    // the builder must not refuse to add a ninth role.
    return const_TemplateSignerRoleColors[
        existing.length % const_TemplateSignerRoleColors.length
    ] as string;
};

/**
 * Mints a role whose `id` is unique within the template.
 *
 * Ids are generated client-side and never reused, because `TemplateField.role_id`
 * points at them: reordering or renaming a role must not rewrite the layout.
 */
export const utils_TemplateRoles_Create = (existing: readonly SignerRole[]): SignerRole => {
    const taken = new Set(existing.map((r) => r.id));
    let id = "";
    for (let n = existing.length + 1; ; n += 1) {
        id = `rol_${n}`;
        if (!taken.has(id)) break;
    }
    const order = existing.length === 0 ? 1 : Math.max(...existing.map((r) => r.order)) + 1;
    return { id, name: `Signer ${order}`, order, color: utils_TemplateRoles_NextColor(existing) };
};

/** Fallback for a field pointing at a role that no longer exists. */
export const const_TemplateRole_OrphanColor = "#bfbfbf";
