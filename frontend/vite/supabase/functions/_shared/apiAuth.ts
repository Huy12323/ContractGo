/**
 * API-key authorization — the fourth `serve*` seam.
 *
 * This product has three ways in, and each one has exactly one module that owns
 * its mandatory first statement:
 *
 *   `senderAuth.resolveSender`      a human with a Supabase session
 *   `signerAuth.resolveSignerToken` an external party with an emailed token
 *   `cronAuth.assertCronSecret`     the scheduler
 *
 * CG-044 adds the fourth: a program with an API key. It is a separate module for
 * the reason the other three are — the check IS the authorization, because these
 * functions run under service_role and RLS does not protect them.
 *
 * ═══ WHY THIS RETURNS A `SenderContext` AND NOT A NEW SHAPE ═══
 *
 * Every existing sender-side handler touches exactly five things on its context:
 * `admin`, `organizationId`, `userId`, `capabilities` and `evidence`. So a
 * resolver that returns the same shape costs nothing at the call sites, and the
 * whole downstream library — `loadEnvelopeForSender`, `logSenderEvent`,
 * `envelopeCompose`, `envelopeNotify` — works unchanged against a machine
 * principal. That is what makes v1.4.0's API a thin front door rather than a
 * second implementation of sending, and it is the single decision keeping the
 * two doors from drifting apart.
 *
 * ═══ A KEY IS NEVER MORE THAN A MEMBER WITH GRANTS ═══
 *
 * `capabilities.role` is synthesized as `"member"`, ALWAYS — never the role of
 * the human who minted the key. An owner's key is not an owner. Any handler that
 * branches on `role === "admin"` therefore denies a key without having to know
 * that api keys exist, which is the correct default for a permission nobody
 * deliberately granted a machine.
 *
 * ═══ THE ACTOR IS `api_client`, THE USER ID IS REAL ═══
 *
 * See `auditEvidence.ts`'s `AuditActor.api_key_id`. Both facts are true and both
 * are recorded: whose authority was used, and what actually used it.
 */

import { createClient, type SupabaseClient } from "supabase";
import { corsHeaders, getRequestIp, jsonResponse, requireEnv, sha256Bytes } from "./http.ts";
import { type AuditEvidence, resolveUserIdentity } from "./auditEvidence.ts";
import { SenderAuthError, type SenderContext, type SenderRequirement } from "./senderAuth.ts";
import { ORGANIZATION_SETTINGS_SELECT, readOrganizationSettings } from "./organizationSettings.ts";

/**
 * The only error class whose message reaches an API caller. Carries a stable
 * machine-readable `code` beside the sentence, because the consumer here is a
 * program: an integrator branching on prose is an integrator whose code breaks
 * when the prose is improved.
 */
export class ApiAuthError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly retryAfterSeconds?: number
    ) {
        super(message);
        this.name = "ApiAuthError";
    }
}

/**
 * ONE OPAQUE REFUSAL FOR EVERY CREDENTIAL FAILURE.
 *
 * An unknown key, a revoked key, an expired key and a key belonging to another
 * organization all produce exactly this. Distinguishing them would turn the
 * endpoint into an oracle for "is this key live" and "does this organization
 * exist" — the same reasoning `resolveSignerToken` applies to its four token
 * failure modes, and `api_key_resolve` already returns no rows for the first
 * three without saying which.
 *
 * The scope refusal below is deliberately NOT opaque: by then the caller has
 * proved it holds a live credential, so naming what it lacks leaks nothing and
 * is the difference between a fixable message and a dead end.
 */
const unauthorized = () => new ApiAuthError(401, "invalid_api_key", "Invalid or expired API key");

/** Mirrors `public.api_keys_scopes_enum`. */
export type ApiScope = "member" | "send_documents" | "manage_templates";

export type ApiClientContext = SenderContext & {
    apiKeyId: string;
    apiKeyName: string;
    scopes: ApiScope[];
    /** Origins this key may target with an embedded signing session (Phase E). */
    allowedEmbedOrigins: string[];
};

/**
 * The same implication ordering `senderAuth.satisfies` applies, over an array
 * instead of a capabilities row.
 *
 * `admin` is unconditionally false and that is not an oversight: the scope is
 * absent from `api_keys_scopes_enum`, so no key can carry it. Stated here as
 * well so that a handler asking for `"admin"` fails closed rather than falling
 * through a `switch` with no matching case.
 */
export function satisfiesScope(scopes: ApiScope[], requires: SenderRequirement): boolean {
    switch (requires) {
        case "member":
            // Holding any scope at all is membership. There is no key without a
            // scope — the CHECK constraint forbids an empty grant.
            return scopes.length > 0;
        case "send_documents":
            return scopes.includes("send_documents");
        case "manage_templates":
            return scopes.includes("manage_templates");
        case "admin":
        case "owner":
            return false;
    }
}

const SCOPE_DENIAL: Record<SenderRequirement, string> = {
    member: "This API key has no scopes",
    send_documents: "This API key lacks the send_documents scope",
    manage_templates: "This API key lacks the manage_templates scope",
    admin: "Organization administration is not available to API keys",
    // CG-050. A key minted by an owner is still not an owner — see the module
    // header. Organization settings are a dashboard action, deliberately not an
    // API surface.
    owner: "Organization settings are not available to API keys",
};

let cachedAdmin: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
    cachedAdmin ??= createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
    return cachedAdmin;
}

const sha256Text = (value: string) => sha256Bytes(new TextEncoder().encode(value));

/** `Authorization: Bearer cgk_…`. Anything else is not a key we minted. */
function readBearerKey(req: Request): string {
    const header = req.headers.get("Authorization");
    if (!header) throw unauthorized();

    const match = header.match(/^Bearer\s+(\S+)$/i);
    const key = match?.[1];
    if (!key || !key.startsWith("cgk_")) throw unauthorized();
    return key;
}

/**
 * Resolves the API key and asserts it may act on `organizationId` with
 * `requires`. THE MANDATORY FIRST STATEMENT of every `api_*` handler.
 *
 * `requires` has no default, unlike `resolveSender`'s `"admin"`. There is no
 * safe default here: `"admin"` would deny every key and `"member"` would admit
 * every key to a write. A new endpoint must say what it needs, and omitting it
 * is a compile error rather than a silent policy.
 */
export async function resolveApiClient(
    req: Request,
    organizationId: string,
    requires: SenderRequirement
): Promise<ApiClientContext> {
    if (!organizationId) {
        throw new ApiAuthError(400, "missing_organization_id", "organization_id is required");
    }

    const key = readBearerKey(req);
    const keyHash = await sha256Text(key);
    const admin = getAdminClient();

    // NEVER `.single()` / `.maybeSingle()` ON AN RPC THAT ALSO WRITES.
    // `api_key_resolve` bumps `last_used_at` and increments the throttle counter.
    // Those accessors set `Accept: application/vnd.pgrst.object+json`, PostgREST
    // answers 406 on zero rows, and PostgREST ROLLS THE TRANSACTION BACK on an
    // error response — silently discarding the accounting the same statement
    // just performed, on precisely the not-found path an attacker hammers.
    // supabase-js then swallows the 406 into `{data: null, error: null}`, so
    // nothing anywhere reports it. v1.3.0 Phase C found this the hard way.
    const { data, error } = await admin.rpc("api_key_resolve", {
        p_key_hash: keyHash,
        p_ip: getRequestIp(req),
    });

    if (error) {
        console.error("api_key_resolve failed:", error);
        throw new ApiAuthError(500, "internal_error", "Could not verify the API key");
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row) throw unauthorized();

    if (row.throttled === true) {
        throw new ApiAuthError(429, "rate_limited", "Rate limit exceeded for this API key", 60);
    }

    // A key is bound to one organization. A mismatch is answered with the same
    // opaque refusal as an unknown key, so a caller cannot enumerate which
    // organizations exist by watching the error change.
    if (row.organization_id !== organizationId) throw unauthorized();

    const scopes = (row.scopes ?? []) as ApiScope[];
    if (!satisfiesScope(scopes, requires)) {
        throw new ApiAuthError(403, "insufficient_scope", SCOPE_DENIAL[requires]);
    }

    const { data: org, error: orgError } = await admin
        .from("organizations")
        // Widened by CG-050 so `api_envelopes_create` inherits the org's
        // document defaults without a second round trip.
        .select(`id, name, ${ORGANIZATION_SETTINGS_SELECT}`)
        .eq("id", organizationId)
        .single();

    if (orgError || !org) throw unauthorized();

    // The minting user's identity, snapshot for the same reason `resolveSender`
    // snapshots a sender's: a renamed or deleted profile must not rewrite the
    // trail. Their name appears on the entry beside the key's, which is what
    // lets a reader answer "whose credential was this?" months later.
    const ownerId = row.created_by_user_id as string;
    const identity = await resolveUserIdentity(admin, ownerId);

    const evidence: AuditEvidence = {
        actor: {
            kind: "api_client",
            user_id: ownerId,
            signer_id: null,
            name: identity.name ?? null,
            email: identity.email ?? null,
            phone: identity.phone ?? null,
            api_key_id: row.api_key_id as string,
            api_key_name: row.name as string,
        },
        auth: {
            // Not `app_session`: nobody logged in. A long-lived secret was
            // replayed by a program, and the trail says exactly that.
            methods: ["api_key"],
            recorded: true,
            session: null,
            otp: null,
            ekyc: null,
        },
        ip: getRequestIp(req),
        user_agent: req.headers.get("user-agent"),
    };

    return {
        // `userId` is the MINTING USER, because it lands in
        // `signature_requests.created_by` and `signature_audit_log.actor_user_id`,
        // both of which must resolve to a real mailbox — `resolveSenderEmail`
        // walks it to notify the sender on decline and expiry. Who ACTED is the
        // `api_client` actor above; this is whose authority was used.
        userId: ownerId,
        organizationId,
        organizationName: org.name as string,
        organization: readOrganizationSettings(org),
        capabilities: {
            // Always "member". See the module header: an owner's key is not an
            // owner, and a handler branching on `role` must deny a key by default.
            role: "member",
            can_manage_templates: scopes.includes("manage_templates"),
            can_send_documents: scopes.includes("send_documents"),
        },
        ip: getRequestIp(req),
        userAgent: req.headers.get("user-agent"),
        evidence,
        admin,
        apiKeyId: row.api_key_id as string,
        apiKeyName: row.name as string,
        scopes,
        allowedEmbedOrigins: (row.allowed_embed_origins ?? []) as string[],
    };
}

// ============================================================
// Idempotency
// ============================================================

/**
 * Canonical JSON: object keys sorted, recursively. The fingerprint has to be
 * stable across two serializations of the same logical body, and a client that
 * reorders its keys between a call and its retry has not changed the request.
 *
 * Arrays are NOT sorted — order is meaning in `recipients`, where it is the
 * signing sequence.
 */
export function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
                .sort()
                .map((k) => [k, canonicalize((value as Record<string, unknown>)[k])])
        );
    }
    return value;
}

/**
 * The exact string whose sha256 becomes `request_fingerprint`. Exported so the
 * fingerprint rule is testable without a database and documentable without
 * paraphrasing the implementation — `docs/api.md` states the rule, and a unit
 * test pins it, so the two cannot drift.
 */
export const canonicalJson = (body: unknown): string => JSON.stringify(canonicalize(body));

export type IdempotencyClaim = {
    /**
     * Non-null when the handler MUST NOT RUN — return it unchanged. Either the
     * stored response of an earlier identical call, or a 409.
     */
    shortCircuit: Response | null;
    /**
     * Records the outcome against the key so a later retry replays it. Call it
     * with whatever the handler is about to return. A no-op when `shortCircuit`
     * was set.
     */
    complete: (status: number, body: Record<string, unknown>) => Promise<void>;
};

/**
 * `Idempotency-Key` is REQUIRED on any endpoint that calls this, not optional.
 *
 * A retried send is two contracts in a counterparty's inbox and two live signing
 * links, and there is no way to un-send. A 400 for a missing header is a
 * five-minute integration fix; a duplicated legal document is not recoverable.
 * That asymmetry is the whole argument, and it is why this refuses rather than
 * degrading to "no protection" the way most APIs do.
 */
export async function claimIdempotency(
    ctx: ApiClientContext,
    req: Request,
    endpoint: string,
    body: Record<string, unknown>
): Promise<IdempotencyClaim> {
    const key = req.headers.get("Idempotency-Key")?.trim();
    if (!key) {
        throw new ApiAuthError(
            400,
            "idempotency_key_required",
            "An Idempotency-Key header is required for this endpoint"
        );
    }
    if (key.length > 255) {
        throw new ApiAuthError(
            400,
            "idempotency_key_invalid",
            "Idempotency-Key must be 255 characters or fewer"
        );
    }

    const fingerprint = await sha256Text(canonicalJson(body));

    const { data, error } = await ctx.admin.rpc("api_idempotency_claim", {
        p_organization_id: ctx.organizationId,
        p_endpoint: endpoint,
        p_key: key,
        p_fingerprint: fingerprint,
        p_api_key_id: ctx.apiKeyId,
    });

    if (error) {
        console.error("api_idempotency_claim failed:", error);
        throw new ApiAuthError(500, "internal_error", "Could not process the idempotency key");
    }

    // Same rule as above — this RPC writes, so read the array.
    const row = Array.isArray(data) ? data[0] : null;
    const outcome = row?.outcome as string | undefined;

    const complete = async (status: number, responseBody: Record<string, unknown>) => {
        const { error: completeError } = await ctx.admin.rpc("api_idempotency_complete", {
            p_organization_id: ctx.organizationId,
            p_endpoint: endpoint,
            p_key: key,
            p_status: status,
            p_body: responseBody,
        });
        // Never fatal. The work already happened and the caller is owed its
        // answer; a lost idempotency record degrades a future retry to a
        // duplicate-detection miss, which is bad, but returning 500 for an
        // envelope that WAS sent is worse.
        if (completeError) console.error("api_idempotency_complete failed:", completeError);
    };

    const noop = async () => {};

    switch (outcome) {
        case "claimed":
            return { shortCircuit: null, complete };

        case "replay":
            // The ORIGINAL answer, verbatim, with its original status. A retry
            // that gets a 409 instead has to be handled by the integrator; a
            // retry that gets the first call's 201 needs no handling at all,
            // which is the entire point of the header.
            return {
                shortCircuit: jsonResponse(
                    (row?.response_body ?? {}) as Record<string, unknown>,
                    (row?.response_status as number) ?? 200
                ),
                complete: noop,
            };

        case "in_flight":
            return {
                shortCircuit: jsonResponse(
                    {
                        error: "A request with this Idempotency-Key is still in progress",
                        code: "idempotency_in_flight",
                    },
                    409
                ),
                complete: noop,
            };

        case "fingerprint_mismatch":
            return {
                shortCircuit: jsonResponse(
                    {
                        error: "This Idempotency-Key was already used with a different request body",
                        code: "idempotency_key_reused",
                    },
                    409
                ),
                complete: noop,
            };

        default:
            console.error("api_idempotency_claim returned an unknown outcome:", outcome);
            throw new ApiAuthError(500, "internal_error", "Could not process the idempotency key");
    }
}

// ============================================================
// The wrapper
// ============================================================

/**
 * OPTIONS/method/parse/error boilerplate for an `api_*` handler.
 *
 * Differs from `serveSenderFunction` in exactly two ways, both because the
 * consumer is a program rather than a browser: every error body carries a stable
 * `code` beside its `error` sentence, and a 429 carries `Retry-After`.
 */
export function serveApiFunction(
    name: string,
    handler: (body: Record<string, unknown>, req: Request) => Promise<Response>
) {
    Deno.serve(async (req) => {
        if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: apiCorsHeaders });
        }
        if (req.method !== "POST") {
            return jsonResponse({ error: "Method not allowed", code: "method_not_allowed" }, 405);
        }

        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return jsonResponse({ error: "Invalid request body", code: "invalid_body" }, 400);
        }

        try {
            return await handler(body, req);
        } catch (err) {
            if (err instanceof ApiAuthError) {
                const response = jsonResponse({ error: err.message, code: err.code }, err.status);
                if (err.retryAfterSeconds !== undefined) {
                    response.headers.set("Retry-After", String(err.retryAfterSeconds));
                }
                return response;
            }
            // `SenderAuthError` reaches here from the SHARED library, not from a
            // handler: `loadEnvelopeForSender`, `resolveTemplateAndVersion` and
            // `hashSourcePdf` all throw it, and every one of them is on the API's
            // path. Without this branch a 404 "Document not found" and a 400
            // "template_id is required" would both surface as a bare 500 — the
            // caller would see an outage where it should see its own mistake.
            //
            // Its message is already caller-safe (it is the one class
            // `serveSenderFunction` lets through), so it is passed on with a
            // status-derived code rather than being reworded here, which would
            // make the same condition read differently through the two doors.
            if (err instanceof SenderAuthError) {
                return jsonResponse(
                    { error: err.message, code: codeForStatus(err.status) },
                    err.status
                );
            }
            // Anything else becomes a bare 500 so a Postgres message cannot leak
            // schema details to an unauthenticated-until-proven caller.
            console.error(`${name} error:`, err);
            return jsonResponse({ error: "Internal error", code: "internal_error" }, 500);
        }
    });
}

/**
 * A stable `code` for a `SenderAuthError`, which carries only a status.
 * Deliberately coarse: an integrator branching on these gets the class of
 * failure, and anything finer would be inventing a vocabulary for conditions
 * raised by code that does not know the API exists.
 */
function codeForStatus(status: number): string {
    switch (status) {
        case 400:
            return "invalid_request";
        case 401:
            return "unauthorized";
        case 403:
            return "forbidden";
        case 404:
            return "not_found";
        case 409:
            return "conflict";
        default:
            return "internal_error";
    }
}

/**
 * `Idempotency-Key` has to be allowed through preflight or a browser-based
 * integrator's POST is rejected before it is sent. The shared `corsHeaders` are
 * left untouched — widening them would change every existing function's
 * preflight to serve one that does not exist yet.
 */
const apiCorsHeaders = {
    ...corsHeaders,
    "Access-Control-Allow-Headers": `${corsHeaders["Access-Control-Allow-Headers"]}, idempotency-key`,
};
