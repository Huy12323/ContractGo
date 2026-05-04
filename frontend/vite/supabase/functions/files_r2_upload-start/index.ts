import { createClient } from "supabase";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

const PRESIGNED_URL_EXPIRES_IN = 3600;
const MAX_SIZE_BYTES = 500 * 1024 * 1024;
const RESOURCE_TYPES = ["contract", "employee_col", "invitation_col", "user_avatar", "contract_template_pdf"] as const;
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

const s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});

function sanitizeFileName(fileName: string): string {
    return fileName
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_+/g, "_")
        .substring(0, 200);
}

function generateRandomId(): string {
    return crypto.randomUUID().replace(/-/g, "").substring(0, 12);
}

function extractExtension(fileName: string): string {
    const match = fileName.toLowerCase().match(/\.[^.]+$/);
    return match ? match[0].slice(1) : "bin";
}

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
        const { resource_type, file_name, content_type, size } = body as {
            resource_type?: string;
            file_name?: string;
            content_type?: string;
            size?: number;
        };

        if (!resource_type || !RESOURCE_TYPES.includes(resource_type as ResourceType)) {
            return jsonResponse(
                { error: `resource_type must be one of: ${RESOURCE_TYPES.join(", ")}` },
                400,
            );
        }
        if (!file_name || typeof file_name !== "string" || !file_name.trim()) {
            return jsonResponse({ error: "file_name is required" }, 400);
        }
        if (!content_type || typeof content_type !== "string") {
            return jsonResponse({ error: "content_type is required" }, 400);
        }
        if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
            return jsonResponse({ error: "size must be a positive number" }, 400);
        }
        if (size > MAX_SIZE_BYTES) {
            return jsonResponse(
                { error: `size exceeds ${MAX_SIZE_BYTES}-byte ceiling` },
                400,
            );
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const timestamp = Date.now();
        const uniqueId = generateRandomId();
        const sanitized = sanitizeFileName(file_name);

        let r2Key: string;

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

            const orgId = contract.organization_id as string;
            const isMember = await isOrgMember(supabaseAdmin, orgId, user.id);
            if (!isMember) {
                return jsonResponse({ error: "Forbidden — not a member of this organization" }, 403);
            }

            r2Key = `orgs/${orgId}/contracts/${contract_id}/${timestamp}-${uniqueId}-${sanitized}`;
        } else if (resource_type === "employee_col") {
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

            const orgId = employee.organization_id as string;
            const isAdminOrOwner = await isOrgAdminOrOwner(supabaseAdmin, orgId, user.id);
            if (!isAdminOrOwner) {
                return jsonResponse({ error: "Forbidden — admin or owner role required" }, 403);
            }

            r2Key = `orgs/${orgId}/employees/${employee_id}/${column_id}/${timestamp}-${uniqueId}-${sanitized}`;
        } else if (resource_type === "invitation_col") {
            const { invitation_id, column_id } = body as {
                invitation_id?: string;
                column_id?: string;
            };
            if (!invitation_id || typeof invitation_id !== "string") {
                return jsonResponse(
                    { error: "invitation_id is required for resource_type=invitation_col" },
                    400,
                );
            }
            if (!column_id || typeof column_id !== "string") {
                return jsonResponse(
                    { error: "column_id is required for resource_type=invitation_col" },
                    400,
                );
            }

            const { data: invitation } = await supabaseAdmin
                .from("onboarding_invitations")
                .select("organization_id, employee_email")
                .eq("id", invitation_id)
                .maybeSingle();
            if (!invitation) {
                return jsonResponse({ error: "Invitation not found" }, 404);
            }

            const orgId = invitation.organization_id as string;
            // Dual auth: invitation recipient (email match) OR admin/owner of the invitation's org.
            // Recipient path unblocks employee self-upload during fill; admin path covers HR pre-fill
            // (from the wizard, after the draft invitation row has been created).
            const inviteeEmail = (invitation.employee_email as string).toLowerCase().trim();
            const userEmail = user.email?.toLowerCase().trim();
            const isRecipient = !!userEmail && userEmail === inviteeEmail;
            const canAccess = isRecipient || (await isOrgAdminOrOwner(supabaseAdmin, orgId, user.id));
            if (!canAccess) {
                return jsonResponse(
                    { error: "Forbidden — must be invitation recipient or org admin/owner" },
                    403,
                );
            }

            r2Key = `orgs/${orgId}/invitations/${invitation_id}/${column_id}/${timestamp}-${uniqueId}-${sanitized}`;
        } else if (resource_type === "contract_template_pdf") {
            // AHR-1955: PDF kind contract template — HR uploads a source PDF that the
            // builder overlays positioned fields on. Org-scoped under the template id
            // so re-uploads can replace cleanly without orphaning prior PDFs (the
            // builder's "Replace PDF" flow updates contract_templates.pdf_file_path
            // to point at the new key; old key is left in R2 until org/template delete
            // cascades the bucket prefix).
            const { contract_template_id } = body as { contract_template_id?: string };
            if (!contract_template_id || typeof contract_template_id !== "string") {
                return jsonResponse(
                    { error: "contract_template_id is required for resource_type=contract_template_pdf" },
                    400,
                );
            }

            const { data: template } = await supabaseAdmin
                .from("contract_templates")
                .select("organization_id")
                .eq("id", contract_template_id)
                .maybeSingle();
            if (!template) {
                return jsonResponse({ error: "Contract template not found" }, 404);
            }

            const orgId = template.organization_id as string;
            const isAdminOrOwner = await isOrgAdminOrOwner(supabaseAdmin, orgId, user.id);
            if (!isAdminOrOwner) {
                return jsonResponse({ error: "Forbidden — admin or owner role required" }, 403);
            }

            r2Key = `orgs/${orgId}/contract-templates/${contract_template_id}/${timestamp}-${uniqueId}-${sanitized}`;
        } else {
            // user_avatar
            const { user_id } = body as { user_id?: string };
            if (!user_id || typeof user_id !== "string") {
                return jsonResponse(
                    { error: "user_id is required for resource_type=user_avatar" },
                    400,
                );
            }
            if (user_id !== user.id) {
                return jsonResponse(
                    { error: "Forbidden — user_id must match the authenticated user" },
                    403,
                );
            }

            const ext = extractExtension(file_name);
            r2Key = `users/${user_id}/avatar-${timestamp}-${uniqueId}.${ext}`;
        }

        const command = new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: r2Key,
            ContentType: content_type,
        });
        const uploadUrl = await getSignedUrl(s3Client, command, {
            expiresIn: PRESIGNED_URL_EXPIRES_IN,
        });
        const expiresAt = new Date(Date.now() + PRESIGNED_URL_EXPIRES_IN * 1000).toISOString();

        return jsonResponse({ uploadUrl, r2Key, expiresAt }, 200);
    } catch (err) {
        console.error("files_r2_upload-start error:", err);
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
