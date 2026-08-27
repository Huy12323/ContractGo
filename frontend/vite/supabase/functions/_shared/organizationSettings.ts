/**
 * The organization row as the rest of the edge functions need to see it.
 *
 * CG-050 gave `organizations` nine settable columns: branding, a presentation
 * timezone, and three envelope defaults. Two very different code paths need
 * them — `senderAuth.ts` for a human sender, `apiAuth.ts` for an API key — and
 * both of those ALREADY SELECT the organizations row, purely to read `name`.
 * Widening those two selects costs nothing; adding a third query per request
 * would cost every send.
 *
 * The select list and the type live here together on purpose. They are one
 * fact stated twice, and a column added to one but not the other is a silent
 * `undefined` at compose time rather than a type error.
 */

import type { SignerAuth } from "./envelopeCompose.ts";

export type { SignerAuth };

/**
 * Columns to add to an existing `organizations` select. Callers prefix their
 * own `id, name` — those two predate CG-050 and several call sites destructure
 * them by name.
 */
export const ORGANIZATION_SETTINGS_SELECT =
    "timezone, brand_color, email_sender_name, logo_file_id, " +
    "default_expiry_days, default_reminder_days, default_signer_auth";

export type OrganizationSettings = {
    /**
     * Presentation only. Its one consumer is the deadline line in reminder and
     * expiry mail. The completion certificate stays UTC forever — see
     * `certificate.text.ts` on why a bare local timestamp in an evidentiary
     * document is a timestamp nobody can reason about later.
     */
    timezone: string;
    /** `#RRGGBB` or null. A PRESENTATION HINT — it must never gate behaviour. */
    brand_color: string | null;
    /** Display name for the `from:` header. The address never changes. */
    email_sender_name: string | null;
    logo_file_id: string | null;
    default_expiry_days: number | null;
    default_reminder_days: number[];
    default_signer_auth: SignerAuth;
};

/**
 * Normalizes a widened `organizations` row into `OrganizationSettings`.
 *
 * Absence-tolerant by design: this runs in functions that may be deployed
 * against a database where the migration has not landed yet, and an unbranded
 * envelope is strictly better than a 500 on send.
 */
export function readOrganizationSettings(
    row: Record<string, unknown> | null
): OrganizationSettings {
    return {
        timezone: typeof row?.timezone === "string" ? row.timezone : "UTC",
        brand_color: typeof row?.brand_color === "string" ? row.brand_color : null,
        email_sender_name:
            typeof row?.email_sender_name === "string" ? row.email_sender_name : null,
        logo_file_id: typeof row?.logo_file_id === "string" ? row.logo_file_id : null,
        default_expiry_days:
            typeof row?.default_expiry_days === "number" ? row.default_expiry_days : null,
        default_reminder_days: Array.isArray(row?.default_reminder_days)
            ? (row.default_reminder_days as number[])
            : [],
        default_signer_auth: row?.default_signer_auth === "email_otp" ? "email_otp" : "account",
    };
}
