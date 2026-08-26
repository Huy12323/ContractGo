/**
 * Turn an RPC failure into something worth showing a person — v1.4.0 Phase F.
 *
 * ═══ THE PROBLEM THIS SOLVES ═══
 *
 * The SECURITY DEFINER routines behind the integrations settings raise their
 * refusals in the imperative, for the reader of a migration:
 *
 *     RAISE EXCEPTION 'webhook_endpoint_update: unknown endpoint';
 *     RAISE EXCEPTION 'api_key_revoke: unknown api key';
 *
 * Those strings are exactly right where they live. They are wrong in a toast:
 * `err.message` reaches the browser verbatim, so an admin would be shown the
 * name of a Postgres function, which tells them nothing they can act on and
 * quietly advertises the shape of the schema.
 *
 * ═══ WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT ═══
 *
 * It replaces messages that are recognisably INTERNAL — a `routine_name: detail`
 * shape, or a raw Postgres error code — with the caller's own sentence. It
 * leaves everything else ALONE, because most of what reaches here is worth
 * reading: a CHECK constraint's message, an edge function's caller-safe refusal,
 * a network failure. Blanket-replacing every message with "Something went wrong"
 * would be the easy version and would throw away the half that helps.
 *
 * The raw error is always still logged by the caller. Nothing is lost, it is
 * just not put in front of someone who cannot use it.
 */

/**
 * `routine_name: detail` — the shape every one of this project's SECURITY
 * DEFINER refusals uses. Anchored, and the routine name must be a plausible
 * identifier, so a genuine sentence that happens to contain a colon ("Fill your
 * own required fields before sending: 2 remaining") is not caught.
 */
const INTERNAL_RAISE = /^[a-z_][a-z0-9_]*:\s/;

/** Postgres SQLSTATEs that reach the client as five-character codes. */
const RAW_SQLSTATE = /^[0-9A-Z]{5}$/;

export const Utils_Rpc_FriendlyError = (error: unknown, fallback: string): string => {
    const raw =
        error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : typeof (error as { message?: unknown })?.message === "string"
                ? (error as { message: string }).message
                : "";

    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    if (INTERNAL_RAISE.test(trimmed)) return fallback;
    if (RAW_SQLSTATE.test(trimmed)) return fallback;

    // Supabase surfaces a permission denial as this, which is true and useless.
    if (/^permission denied/i.test(trimmed)) return fallback;

    return trimmed;
};
