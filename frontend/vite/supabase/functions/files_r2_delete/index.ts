import { createClient } from "supabase";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

function requireEnv(name: string): string {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const R2_ACCOUNT_ID = requireEnv("R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID = requireEnv("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = requireEnv("R2_SECRET_ACCESS_KEY");
const R2_BUCKET_NAME = requireEnv("R2_BUCKET_NAME");

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

const s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});

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

        const { file_id } = (await req.json()) as { file_id?: string };
        if (!file_id || typeof file_id !== "string") {
            return jsonResponse({ error: "file_id is required" }, 400);
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        const { data: file } = await supabaseAdmin
            .from("files")
            .select("r2_key, thumbnail_r2_key, organization_id")
            .eq("id", file_id)
            .maybeSingle();
        if (!file) {
            return jsonResponse({ error: "File not found" }, 404);
        }

        if (!file.organization_id) {
            return jsonResponse(
                { error: "User-scope files cannot be deleted via this endpoint" },
                400,
            );
        }

        const orgId = file.organization_id as string;

        // Scope-aware auth: parse r2_key prefix to detect whether this file lives under
        // an invitation (dual auth: recipient OR admin/owner) or under any other scope
        // (admin/owner only — contracts, employee_col). Keeps the hook signature flat
        // (just { file_id }) while letting the edge function pick the right rule.
        const segments = (file.r2_key as string).split("/");
        const scope = segments[0] === "orgs" ? segments[2] : null;

        if (scope === "invitations") {
            const invitationId = segments[3];
            const { data: invitation } = await supabaseAdmin
                .from("onboarding_invitations")
                .select("employee_email")
                .eq("id", invitationId)
                .maybeSingle();
            if (!invitation) {
                return jsonResponse({ error: "Invitation not found for file's scope" }, 404);
            }
            const inviteeEmail = (invitation.employee_email as string).toLowerCase().trim();
            const userEmail = user.email?.toLowerCase().trim();
            const isRecipient = !!userEmail && userEmail === inviteeEmail;
            const isAdminOrOwner = await isOrgAdminOrOwner(supabaseAdmin, orgId, user.id);
            if (!isRecipient && !isAdminOrOwner) {
                return jsonResponse(
                    { error: "Forbidden — must be invitation recipient or org admin/owner" },
                    403,
                );
            }
        } else {
            const isAdminOrOwner = await isOrgAdminOrOwner(supabaseAdmin, orgId, user.id);
            if (!isAdminOrOwner) {
                return jsonResponse({ error: "Forbidden — admin or owner role required" }, 403);
            }
        }

        // Delete R2 objects (original + thumbnail). Tolerate intermittent R2 failures by
        // logging and continuing — the DB row is the audit record; orphaned R2 objects
        // are cheap and detectable later.
        const keysToDelete: string[] = [file.r2_key as string];
        if (file.thumbnail_r2_key) keysToDelete.push(file.thumbnail_r2_key as string);
        for (const key of keysToDelete) {
            try {
                await s3Client.send(
                    new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }),
                );
            } catch (err) {
                console.error(`R2 delete failed for key ${key} (continuing):`, err);
            }
        }

        const { error: deleteError } = await supabaseAdmin
            .from("files")
            .delete()
            .eq("id", file_id);
        if (deleteError) {
            return jsonResponse(
                { error: `Failed to delete files row: ${deleteError.message}` },
                500,
            );
        }

        return jsonResponse({ success: true }, 200);
    } catch (err) {
        console.error("files_r2_delete error:", err);
        return jsonResponse(
            { error: err instanceof Error ? err.message : "Internal error" },
            500,
        );
    }
});

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
