/**
 * Sender authorization — the counterpart to `signerAuth.ts`.
 *
 * Where a SIGNER proves themselves with a bearer token and gets no database
 * grants at all, a SENDER is an ordinary authenticated user acting inside an
 * organization they belong to. Every function that touches an envelope from the
 * sender's side (`envelopes_send`, `_void`, `_resend`, `_download-signed`) needs
 * the identical checks, and having them in one place is what stops them drifting
 * — `envelopes_send` originally carried its own copy whose `admins` lookup was
 * missing the organization filter, which would have let any org's admin act in
 * any other.
 *
 * These functions run under service_role, so RLS does NOT protect them. The
 * checks below are the whole of the authorization, which is why they are a
 * shared module rather than a dozen hand-written copies.
 *
 * CG-027: "sender" is no longer a synonym for "admin or owner". What a caller
 * may do is now a permission, held by tier for owners and admins and by flag for
 * members, and each function states WHICH permission it needs via `requires`.
 * The requirement is a parameter rather than something inferred from the
 * function name because two functions in the same folder legitimately differ:
 * `envelopes_document-url` renders a document any member may already list, while
 * `envelopes_send` puts one in front of a counterparty.
 *
 * The check itself is delegated to `get_my_org_capabilities`, called AS THE
 * CALLER. Re-implementing the tier lookup in TypeScript is what produced the bug
 * this module was extracted to fix; asking the database the same question the
 * RLS policies ask means the two cannot disagree again.
 */

import { createClient, type SupabaseClient } from "supabase";
import { corsHeaders, getRequestIp, jsonResponse, requireEnv } from "./http.ts";
import { type AuditEvidence, readSessionClaims, resolveUserIdentity } from "./auditEvidence.ts";

export class SenderAuthError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
        this.name = "SenderAuthError";
    }
}

/**
 * What a function demands of its caller.
 *
 * `"member"` is the read tier — any of owner, admin or member passes. It is the
 * right requirement for anything that only shows a caller something RLS already
 * lets them SELECT, and using anything stronger there recreates the CG-027 bug
 * where a member could list a document but not open it.
 *
 * `"admin"` remains for organization administration (inviting people), which is
 * deliberately NOT one of the two grantable permissions: a member who can send
 * documents still must not be able to add people to the organization.
 */
export type SenderRequirement = "member" | "send_documents" | "manage_templates" | "admin";

const REQUIREMENT_DENIAL: Record<SenderRequirement, string> = {
    member: "You are not a member of this organization",
    send_documents: "You do not have permission to send documents",
    manage_templates: "You do not have permission to manage templates",
    // Unchanged wording: it is the message every existing caller and its tests
    // already expect, and `organizations_send-invitation` rewrites it in place.
    admin: "Only admins and owners can manage documents",
};

type OrgCapabilities = {
    role: "owner" | "admin" | "member" | null;
    can_manage_templates: boolean;
    can_send_documents: boolean;
};

function satisfies(caps: OrgCapabilities, requires: SenderRequirement): boolean {
    if (caps.role === null) return false;
    switch (requires) {
        case "member":
            return true;
        case "admin":
            return caps.role === "owner" || caps.role === "admin";
        case "manage_templates":
            return caps.can_manage_templates;
        case "send_documents":
            return caps.can_send_documents;
    }
}

export type SenderContext = {
    userId: string;
    organizationId: string;
    organizationName: string;
    /**
     * The caller's tier and grants in this organization, resolved by the same
     * function the RLS policies consult. Carried on the context so a handler
     * that needs a second, finer decision (an admin-only branch inside an
     * otherwise member-readable function) does not make another round trip.
     */
    capabilities: OrgCapabilities;
    ip: string | null;
    userAgent: string | null;
    /**
     * Who this person is and how they proved it, resolved once per request and
     * snapshot into every chain entry they cause (CG-016). Held on the context
     * rather than rebuilt per event: a send writes `request_created`,
     * `request_sent`, and two entries per recipient, and the acting user's
     * identity cannot change between them.
     */
    evidence: AuditEvidence;
    /** service_role client, already constructed. Reuse it; don't make another. */
    admin: SupabaseClient;
};

let cachedAdmin: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
    cachedAdmin ??= createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
    return cachedAdmin;
}

/**
 * Resolves the caller and asserts they may act on `organizationId`.
 *
 * The organization is a PARAMETER rather than something derived from the token:
 * a user can belong to several, so "which organization is this action in" is
 * part of the request, and the check is that they are privileged in *that* one.
 *
 * `requires` defaults to `"admin"` — the pre-CG-027 behaviour. A new function
 * that forgets to state its requirement therefore fails closed, denying members
 * rather than admitting them.
 */
export async function resolveSender(
    req: Request,
    organizationId: string,
    requires: SenderRequirement = "admin"
): Promise<SenderContext> {
    if (!organizationId) throw new SenderAuthError(400, "organization_id is required");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new SenderAuthError(401, "Missing authorization");

    const admin = getAdminClient();
    const asCaller = createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
        { global: { headers: { Authorization: authHeader } } }
    );

    const {
        data: { user },
        error: authError,
    } = await asCaller.auth.getUser();
    if (authError || !user) throw new SenderAuthError(401, "Unauthorized");

    const { data: org, error: orgError } = await admin
        .from("organizations")
        .select("id, name, owner_id")
        .eq("id", organizationId)
        .single();

    if (orgError || !org) throw new SenderAuthError(404, "Organization not found");

    // Asked AS THE CALLER, not as service_role: the function reads auth.uid()
    // internally, so running it on the admin client would resolve nobody's
    // capabilities and silently return role NULL. It is scoped to THIS
    // organization for the same reason the old `admins` lookup was — holding a
    // permission somewhere is not holding it here.
    const { data: capsRaw, error: capsError } = await asCaller.rpc("get_my_org_capabilities", {
        org_id: organizationId,
    });

    if (capsError) {
        console.error("get_my_org_capabilities failed:", capsError);
        throw new SenderAuthError(500, "Could not verify your permissions");
    }

    const capabilities: OrgCapabilities = {
        role: (capsRaw?.role ?? null) as OrgCapabilities["role"],
        can_manage_templates: capsRaw?.can_manage_templates === true,
        can_send_documents: capsRaw?.can_send_documents === true,
    };

    if (!satisfies(capabilities, requires)) {
        // 404-style ambiguity is not wanted here: unlike an envelope id, the
        // organization id came from the caller's own session context, so telling
        // them plainly what they lack leaks nothing and is the difference
        // between a fixable message and the dead end CG-027 replaced.
        throw new SenderAuthError(403, REQUIREMENT_DENIAL[requires]);
    }

    // Identity is snapshot HERE, from `profiles` plus the account's own phone,
    // rather than joined when the trail is read: a renamed or deleted profile
    // must not be able to change who the record says acted. `user.email` is the
    // fallback because it is the one identifier the JWT itself carries, so an
    // entry can always name the actor even if the profile row is missing.
    const identity = await resolveUserIdentity(admin, user.id);

    return {
        userId: user.id,
        organizationId,
        organizationName: org.name,
        capabilities,
        ip: getRequestIp(req),
        userAgent: req.headers.get("user-agent"),
        evidence: {
            actor: {
                kind: "sender",
                user_id: user.id,
                signer_id: null,
                name:
                    identity.name ?? (user.user_metadata?.full_name as string | undefined) ?? null,
                email: identity.email ?? user.email ?? null,
                phone: identity.phone ?? user.phone ?? null,
            },
            auth: {
                // The session is the authentication. `session.aal` says whether an
                // MFA factor stood behind it and `amr` names the provider methods,
                // which is the difference between "they were logged in" and "they
                // were logged in with a second factor at 09:14".
                methods: ["app_session"],
                recorded: true,
                session: readSessionClaims(authHeader),
                // A sender does not go through the signer verification flow. Stated
                // rather than omitted — see `auditEvidence.ts`.
                otp: null,
                ekyc: null,
            },
            ip: getRequestIp(req),
            user_agent: req.headers.get("user-agent"),
        },
        admin,
    };
}

export type SelfContext = {
    userId: string;
    /** service_role client, already constructed. Reuse it; don't make another. */
    admin: SupabaseClient;
};

/**
 * Resolves the caller with NO organization in the picture.
 *
 * A few resources belong to a person rather than to an organization — their
 * avatar, and CG-029's saved signatures — so `resolveSender` cannot serve them:
 * it takes an `organizationId` and asks what the caller may do inside it, and
 * there is no organization to name. The authorization for these is simply "you
 * may only touch your own", which the callers express by comparing `userId`
 * against the id in the request.
 *
 * This was open-coded inside the `user_avatar` branch of `files_r2_upload-start`
 * before CG-029 needed the identical thing. It is shared for the reason stated at
 * the top of this module: the last time this check existed twice, one copy was
 * missing a filter.
 *
 * NOTE that this deliberately performs no membership or permission check at all.
 * It answers "who is this?" and nothing else — every caller MUST follow it with
 * its own ownership comparison, or it has authenticated without authorizing.
 */
export async function resolveSelf(req: Request): Promise<SelfContext> {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new SenderAuthError(401, "Missing authorization");

    const asCaller = createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
        { global: { headers: { Authorization: authHeader } } }
    );

    const {
        data: { user },
        error: authError,
    } = await asCaller.auth.getUser();
    if (authError || !user) throw new SenderAuthError(401, "Unauthorized");

    return { userId: user.id, admin: getAdminClient() };
}

export type SenderEnvelope = {
    id: string;
    organization_id: string;
    title: string;
    status: "draft" | "in_progress" | "completed" | "declined" | "cancelled" | "expired";
    current_order: number;
    signed_pdf_r2_key: string | null;
    signed_pdf_sha256: string | null;
    source_pdf_r2_key: string;
};

/**
 * Loads an envelope and asserts it belongs to the caller's organization.
 *
 * The organization filter is in the WHERE clause rather than checked after the
 * fetch, so a mismatched id is indistinguishable from a missing one: an
 * authorized user of org A must not be able to learn that an envelope id exists
 * in org B.
 */
export async function loadEnvelopeForSender(
    ctx: SenderContext,
    envelopeId: string
): Promise<SenderEnvelope> {
    if (!envelopeId) throw new SenderAuthError(400, "envelope_id is required");

    const { data, error } = await ctx.admin
        .from("signature_requests")
        .select(
            "id, organization_id, title, status, current_order, signed_pdf_r2_key, signed_pdf_sha256, source_pdf_r2_key"
        )
        .eq("id", envelopeId)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();

    if (error) {
        console.error("loadEnvelopeForSender failed:", error);
        throw new SenderAuthError(500, "Could not load the document");
    }
    if (!data) throw new SenderAuthError(404, "Document not found");

    return data as SenderEnvelope;
}

/**
 * Appends to the hash chain on behalf of a real user. Never throws — a failed
 * audit write must not roll back an action that already happened, and the gap is
 * itself detectable because the sequence is contiguous by construction.
 */
export async function logSenderEvent(
    ctx: SenderContext,
    args: {
        envelopeId: string;
        signerId?: string | null;
        eventType: string;
        payload?: Record<string, unknown>;
    }
): Promise<void> {
    const { error } = await ctx.admin.rpc("signature_audit_append", {
        p_request_id: args.envelopeId,
        p_organization_id: ctx.organizationId,
        p_signer_id: args.signerId ?? null,
        p_actor_user_id: ctx.userId,
        p_event_type: args.eventType,
        // The evidence block goes LAST so a caller cannot accidentally shadow the
        // actor or the address with an event-specific key of the same name. The
        // event's own payload is its subject matter; who performed it is not
        // negotiable per call site.
        p_payload: { ...(args.payload ?? {}), ...ctx.evidence },
    });
    if (error) console.error(`Audit append (${args.eventType}) failed:`, error);
}

/**
 * Wraps a sender-side handler with the OPTIONS/method/parse/error boilerplate.
 * `SenderAuthError` is the only error class whose message reaches the caller;
 * everything else becomes a bare 500 so a Postgres message cannot leak schema
 * details.
 */
export function serveSenderFunction(
    name: string,
    handler: (body: Record<string, unknown>, req: Request) => Promise<Response>
) {
    Deno.serve(async (req) => {
        if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders });
        }
        if (req.method !== "POST") {
            return jsonResponse({ error: "Method not allowed" }, 405);
        }

        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return jsonResponse({ error: "Invalid request body" }, 400);
        }

        try {
            return await handler(body, req);
        } catch (err) {
            if (err instanceof SenderAuthError) {
                return jsonResponse({ error: err.message }, err.status);
            }
            console.error(`${name} error:`, err);
            return jsonResponse({ error: "Internal error" }, 500);
        }
    });
}
