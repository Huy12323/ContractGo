/**
 * Scheduler authorization — the third caller shape, after `signerAuth.ts`
 * (a bearer token) and `senderAuth.ts` (a real user).
 *
 * A cron job is neither. It arrives from `net.http_post` inside Postgres with no
 * JWT and no session, so these functions deploy with `verify_jwt = false` like
 * the public signing surface — which means the secret check below is the WHOLE
 * of the authorization, exactly as `resolveSignerToken` is for a signer.
 *
 * Two rules follow, and both are enforced here rather than left to each
 * function:
 *
 *   1. `requireEnv`, never `Deno.env.get(x)!` or `?? "fallback"`. A silently
 *      absent cron secret would make the check `undefined === undefined`, which
 *      passes — an auth gate that opens when its configuration is missing is
 *      worse than no gate, because it looks like one.
 *   2. The comparison is CONSTANT-TIME. These endpoints are reachable by anyone
 *      who knows the URL, and `a === b` on strings returns early at the first
 *      differing byte, which is a byte-by-byte oracle for a secret that never
 *      rotates on its own.
 */

import { createClient, type SupabaseClient } from "supabase";
import { corsHeaders, jsonResponse, requireEnv } from "./http.ts";

/**
 * The service_role client the scheduled jobs run everything through.
 *
 * It lives here rather than in `senderAuth.ts` because a cron job has no sender
 * to resolve — importing a module named "senderAuth" for its client alone would
 * imply an authorization model these functions do not use. Cached per isolate,
 * exactly as `senderAuth`'s private one is.
 */
let cachedAdmin: SupabaseClient | null = null;
export function getCronAdminClient(): SupabaseClient {
    cachedAdmin ??= createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
    return cachedAdmin;
}

const CRON_SECRET_HEADER = "x-cron-secret";

/** Length-independent, early-exit-free comparison. */
function timingSafeEqual(a: string, b: string): boolean {
    const encoder = new TextEncoder();
    const left = encoder.encode(a);
    const right = encoder.encode(b);
    // Length is not itself secret — a mismatched length still walks the whole
    // longer buffer so the duration says nothing about WHERE the difference is.
    let diff = left.length ^ right.length;
    const max = Math.max(left.length, right.length);
    for (let i = 0; i < max; i++) {
        diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
    }
    return diff === 0;
}

export class CronAuthError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
        this.name = "CronAuthError";
    }
}

/**
 * The mandatory first statement of every scheduled function, in the same
 * position `resolveSignerToken` holds in the public signing functions.
 */
export function assertCronSecret(req: Request): void {
    const presented = req.headers.get(CRON_SECRET_HEADER);
    if (!presented) throw new CronAuthError(401, "Unauthorized");
    if (!timingSafeEqual(presented, requireEnv("CRON_SHARED_SECRET"))) {
        throw new CronAuthError(401, "Unauthorized");
    }
}

/**
 * Wraps a scheduled handler with the OPTIONS / method / secret / error
 * boilerplate. Mirrors `serveSenderFunction` and `servePublicSigningFunction`.
 *
 * Every rejection is one opaque "Unauthorized" — a caller probing this endpoint
 * must not learn whether the header was missing, wrong, or the deployment
 * unconfigured.
 *
 * The handler's own failures become a bare 500 with the detail in the log. The
 * only reader of these responses is `net.http_response`, which nobody watches;
 * the log is where a stalled job is actually diagnosed.
 */
export function serveCronFunction(name: string, handler: () => Promise<Response>) {
    Deno.serve(async (req) => {
        if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders });
        }
        if (req.method !== "POST") {
            return jsonResponse({ error: "Method not allowed" }, 405);
        }

        try {
            assertCronSecret(req);
        } catch (err) {
            if (!(err instanceof CronAuthError)) {
                // A missing CRON_SHARED_SECRET throws from `requireEnv`. That is
                // a deployment fault, not a caller fault, and it must be loud in
                // the log while staying a flat 401 on the wire.
                console.error(`${name}: cron secret is not configured:`, err);
            }
            return jsonResponse({ error: "Unauthorized" }, 401);
        }

        try {
            return await handler();
        } catch (err) {
            console.error(`${name} error:`, err);
            return jsonResponse({ error: "Internal error" }, 500);
        }
    });
}
