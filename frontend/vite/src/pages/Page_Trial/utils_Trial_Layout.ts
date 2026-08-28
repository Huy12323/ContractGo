// Adapters between the trial's own state and the shapes the reused components
// expect.
//
// The trial gets its preview for almost free by handing `App_DocumentFiller` —
// the real signing filler, 675 lines with no supabase, auth or query imports —
// a locally synthesized session. That is the highest-value reuse in this
// feature: what the visitor sees on the last step is pixel-for-pixel the
// experience they would be buying, not a mock-up of it.

import type { SignerRole, TemplateField, TemplateLayout } from "@/types/template.types";
import { const_Template_SignerRoleId } from "@/types/template.types";
import type { Signing_Field } from "@/hooks/useQ_Signing_Session";
import { const_TemplateSignerRoleColors } from "@/components/templates/const_TemplateSignerRoleColors";

/**
 * The trial's one and only party.
 *
 * Synthesized, never mutated, and the role editor is hidden (see the workspace's
 * `showRoleManager`). Named "You" rather than "Signer 1" because with a single
 * party the number is noise, and because the sentence the visitor is reading is
 * "these are the fields you fill".
 *
 * It reuses `const_Template_SignerRoleId` so a layout built here has the same
 * `role_id` the product's own default signer role does — which is what would let
 * a future "continue this in your account" path accept it unchanged.
 */
export const const_Trial_SignerRole: SignerRole = {
    id: const_Template_SignerRoleId,
    name: "You",
    order: 1,
    color: const_TemplateSignerRoleColors[0],
};

export const const_Trial_RoleColors: Record<string, string> = {
    [const_Trial_SignerRole.id]: const_Trial_SignerRole.color,
};

/**
 * `TemplateLayout` → the `Signing_Field[]` the filler renders.
 *
 * `editable` IS THE SUBTLE PART, and getting it backwards is a visible bug.
 * `signing_session_open` reports `editable: false` for every signature and
 * initials field, because those are captured on the sign step and never typed
 * into — the filler relies on that to render a signature box as a MARK rather
 * than as a text input. Mirror it here, or the trial draws an input inside the
 * signature box and nothing the visitor types will ever burn.
 *
 * See the invariant spelled out in `useQ_Signing_Session.ts`.
 */
export const utils_Trial_ToSigningFields = (layout: TemplateLayout): Signing_Field[] =>
    layout.map((field) => ({
        ...field,
        editable: field.type !== "signature" && field.type !== "initials",
    }));

/**
 * A new field's defaults, for the fields the trial's palette can place.
 *
 * `required: false` throughout: a required field the visitor has not filled
 * would block the download, and the trial has no reason to withhold their
 * document over a field they chose to leave empty.
 */
export const utils_Trial_NormalizeField = (field: TemplateField): TemplateField => ({
    ...field,
    role_id: const_Trial_SignerRole.id,
    required: false,
});
