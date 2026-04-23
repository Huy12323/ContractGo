import { createClient } from "supabase";
import { SignJWT } from "jose";

function requireEnv(name: string): string {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const WORKER_JWT_SECRET = requireEnv("WORKER_JWT_SECRET");
const R2_WORKER_URL = requireEnv("R2_WORKER_URL");
const ENVIRONMENT = Deno.env.get("ENVIRONMENT") || "development";

const TOKEN_TTL_SECONDS = 7 * 24 * 3600;
const RESOURCE_TYPES = ["contract", "employee_col"] as const;
type ResourceType = (typeof RESOURCE_TYPES)[number];

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

const secretBytes = new TextEncoder().encode(WORKER_JWT_SECRET);

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return jsonResponse({ error: "Missing authorization" }, 401);
        }

        const supabaseUser = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
            global: { headers: { Authorization: authHeader } },
        });
        const {
            data: { user },
            error: authError,
        } = await supabaseUser.auth.getUser();
        if (authError || !user) {
            return jsonResponse({ error: "Unauthorized" }, 401);
        }

        const body = (await req.json()) as Record<string, unknown>;
        const { resource_type, file_id } = body as {
            resource_type?: string;
            file_id?: string;
        };

        if (resource_type === "user_avatar") {
            return jsonResponse(
                {
                    error:
                        "Avatar URLs are constructed directly by the client from r2_key — no sign call needed",
                },
                400,
            );
        }
        if (!resource_type || !RESOURCE_TYPES.includes(resource_type as ResourceType)) {
            return jsonResponse(
                { error: `resource_type must be one of: ${RESOURCE_TYPES.join(", ")}` },
                400,
            );
        }
        if (!file_id || typeof file_id !== "string") {
            return jsonResponse({ error: "file_id is required" }, 400);
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        const { data: file } = await supabaseAdmin
            .from("files")
            .select("r2_key, organization_id")
            .eq("id", file_id)
            .maybeSingle();
        if (!file) {
            return jsonResponse({ error: "File not found" }, 404);
        }

        let orgId: string;

        if (resource_type === "contract") {
            const { contract_id } = body as { contract_id?: string };
            if (!contract_id || typeof contract_id !== "string") {
                return jsonResponse({ error: "contract_id is required for resource_type=contract" }, 400);
            }

            const { data: contract } = await supabaseAdmin
                .from("employee_contracts")
                .select("organization_id")
                .eq("id", contract_id)
                .maybeSingle();
            if (!contract) {
                return jsonResponse({ error: "Contract not found" }, 404);
            }

            orgId = contract.organization_id as string;
            if (file.organization_id !== orgId) {
                return jsonResponse(
                    { error: "File does not belong to this contract's organization" },
                    403,
                );
            }

            const isMember = await isOrgMember(supabaseAdmin, orgId, user.id);
            if (!isMember) {
                return jsonResponse({ error: "Forbidden — not a member of this organization" }, 403);
            }
        } else {
            const { employee_id, column_id } = body as {
                employee_id?: string;
                column_id?: string;
            };
            if (!employee_id || typeof employee_id !== "string") {
                return jsonResponse(
                    { error: "employee_id is required for resource_type=employee_col" },
                    400,
                );
            }
            if (!column_id || typeof column_id !== "string") {
                return jsonResponse(
                    { error: "column_id is required for resource_type=employee_col" },
                    400,
                );
            }

            const { data: employee } = await supabaseAdmin
                .from("employees")
                .select("organization_id")
                .eq("id", employee_id)
                .maybeSingle();
            if (!employee) {
                return jsonResponse({ error: "Employee not found" }, 404);
            }

            const { data: column } = await supabaseAdmin
                .from("employee_columns")
                .select("organization_id")
                .eq("id", column_id)
                .maybeSingle();
            if (!column) {
                return jsonResponse({ error: "Column not found" }, 404);
            }

            if (employee.organization_id !== column.organization_id) {
                return jsonResponse(
                    { error: "employee and column belong to different organizations" },
                    400,
                );
            }

            orgId = employee.organization_id as string;
            if (file.organization_id !== orgId) {
                return jsonResponse(
                    { error: "File does not belong to this employee's organization" },
                    403,
                );
            }

            const isAdminOrOwner = await isOrgAdminOrOwner(supabaseAdmin, orgId, user.id);
            if (!isAdminOrOwner) {
                return jsonResponse({ error: "Forbidden — admin or owner role required" }, 403);
            }
        }

        const now = Math.floor(Date.now() / 1000);
        const exp = now + TOKEN_TTL_SECONDS;

        const jwt = await new SignJWT({
            userId: user.id,
            orgId,
            r2Key: file.r2_key as string,
            resourceId: file_id,
            resourceType: resource_type,
            env: ENVIRONMENT,
        })
            .setProtectedHeader({ alg: "HS256" })
            .setIssuedAt(now)
            .setExpirationTime(exp)
            .sign(secretBytes);

        const url = `${R2_WORKER_URL}/${file.r2_key}?token=${jwt}`;
        const expiresAt = new Date(exp * 1000).toISOString();

        return jsonResponse({ url, expiresAt }, 200);
    } catch (err) {
        console.error("files_r2_sign-read-url error:", err);
        return jsonResponse(
            { error: err instanceof Error ? err.message : "Internal error" },
            500,
        );
    }
});

// deno-lint-ignore no-explicit-any
async function isOrgMember(admin: any, orgId: string, userId: string): Promise<boolean> {
    const { data: org } = await admin
        .from("organizations")
        .select("owner_id")
        .eq("id", orgId)
        .maybeSingle();
    if (org?.owner_id === userId) return true;

    const { data: adminRow } = await admin
        .from("admins")
        .select("id")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
    if (adminRow) return true;

    const { data: empRow } = await admin
        .from("employees")
        .select("id")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
    return !!empRow;
}

// deno-lint-ignore no-explicit-any
async function isOrgAdminOrOwner(admin: any, orgId: string, userId: string): Promise<boolean> {
    const { data: org } = await admin
        .from("organizations")
        .select("owner_id")
        .eq("id", orgId)
        .maybeSingle();
    if (org?.owner_id === userId) return true;

    const { data: adminRow } = await admin
        .from("admins")
        .select("id")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
    return !!adminRow;
}
