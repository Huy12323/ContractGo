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
const RESOURCE_TYPES = ["contract", "employee_col", "invitation_col", "contract_signature", "contract_template_pdf", "invitation_pdf"] as const;
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
        const { resource_type, file_id, use_thumbnail } = body as {
            resource_type?: string;
            file_id?: string;
            use_thumbnail?: boolean;
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

        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // Contract signatures are stored as a raw r2_key on contracts.signature_path —
        // no `files` row, so file_id isn't applicable. Handle the whole flow here and
        // return early before the files-table lookup below.
        if (resource_type === "contract_signature") {
            const { contract_id } = body as { contract_id?: string };
            if (!contract_id || typeof contract_id !== "string") {
                return jsonResponse(
                    { error: "contract_id is required for resource_type=contract_signature" },
                    400,
                );
            }

            const { data: contract } = await supabaseAdmin
                .from("contracts")
                .select("organization_id, signature_path, invitation_id")
                .eq("id", contract_id)
                .maybeSingle();
            if (!contract) {
                return jsonResponse({ error: "Contract not found" }, 404);
            }
            if (!contract.signature_path) {
                return jsonResponse({ error: "Contract has no signature" }, 404);
            }

            const orgIdSig = contract.organization_id as string;

            // Dual auth — recipient (via linked invitation's email) OR org admin/owner.
            // Recipient path supports future surfaces that might show an employee their
            // own signature; admin/owner covers HR review.
            let isRecipient = false;
            if (contract.invitation_id) {
                const { data: inv } = await supabaseAdmin
                    .from("onboarding_invitations")
                    .select("employee_email")
                    .eq("id", contract.invitation_id as string)
                    .maybeSingle();
                const userEmail = user.email?.toLowerCase().trim();
                if (
                    userEmail &&
                    inv?.employee_email &&
                    userEmail === (inv.employee_email as string).toLowerCase().trim()
                ) {
                    isRecipient = true;
                }
            }
            const canAccess =
                isRecipient || (await isOrgAdminOrOwner(supabaseAdmin, orgIdSig, user.id));
            if (!canAccess) {
                return jsonResponse(
                    { error: "Forbidden — must be invitation recipient or org admin/owner" },
                    403,
                );
            }

            const nowSig = Math.floor(Date.now() / 1000);
            const expSig = nowSig + TOKEN_TTL_SECONDS;
            const jwtSig = await new SignJWT({
                userId: user.id,
                orgId: orgIdSig,
                r2Key: contract.signature_path as string,
                resourceId: contract_id,
                resourceType: "contract_signature",
                env: ENVIRONMENT,
            })
                .setProtectedHeader({ alg: "HS256" })
                .setIssuedAt(nowSig)
                .setExpirationTime(expSig)
                .sign(secretBytes);
            const urlSig = `${R2_WORKER_URL}/${contract.signature_path}?token=${jwtSig}`;
            return jsonResponse(
                { url: urlSig, expiresAt: new Date(expSig * 1000).toISOString() },
                200,
            );
        }

        // AHR-1956: source PDF for `pdf` kind invitations — read the path from the
        // invitation's template_snapshot (the durable, hard-delete-safe source) and sign it.
        // Dual auth: invitee (email match) OR admin/owner. Mirrors the invitation_col pattern.
        if (resource_type === "invitation_pdf") {
            const { invitation_id } = body as { invitation_id?: string };
            if (!invitation_id || typeof invitation_id !== "string") {
                return jsonResponse(
                    { error: "invitation_id is required for resource_type=invitation_pdf" },
                    400,
                );
            }

            const { data: invitation } = await supabaseAdmin
                .from("onboarding_invitations")
                .select("organization_id, employee_email, template_snapshot")
                .eq("id", invitation_id)
                .maybeSingle();
            if (!invitation) {
                return jsonResponse({ error: "Invitation not found" }, 404);
            }

            const snapshot = (invitation.template_snapshot ?? {}) as {
                type?: string;
                pdf_file_path?: string | null;
            };
            const pdfPath = snapshot.pdf_file_path;
            if (!pdfPath || typeof pdfPath !== "string") {
                return jsonResponse({ error: "Invitation snapshot has no PDF" }, 404);
            }

            const orgIdInv = invitation.organization_id as string;
            // Dual auth: recipient email match OR org admin/owner. Recipient path supports
            // the employee filler; admin path supports HR review surfaces (which read this
            // resource via contract.invitation_id).
            const inviteeEmail = (invitation.employee_email as string).toLowerCase().trim();
            const userEmailInv = user.email?.toLowerCase().trim();
            const isRecipientInv = !!userEmailInv && userEmailInv === inviteeEmail;
            const canAccessInv =
                isRecipientInv || (await isOrgAdminOrOwner(supabaseAdmin, orgIdInv, user.id));
            if (!canAccessInv) {
                return jsonResponse(
                    { error: "Forbidden — must be invitation recipient or org admin/owner" },
                    403,
                );
            }

            const nowInv = Math.floor(Date.now() / 1000);
            const expInv = nowInv + TOKEN_TTL_SECONDS;
            const jwtInv = await new SignJWT({
                userId: user.id,
                orgId: orgIdInv,
                r2Key: pdfPath,
                resourceId: invitation_id,
                resourceType: "invitation_pdf",
                env: ENVIRONMENT,
            })
                .setProtectedHeader({ alg: "HS256" })
                .setIssuedAt(nowInv)
                .setExpirationTime(expInv)
                .sign(secretBytes);
            const urlInv = `${R2_WORKER_URL}/${pdfPath}?token=${jwtInv}`;
            return jsonResponse(
                { url: urlInv, expiresAt: new Date(expInv * 1000).toISOString() },
                200,
            );
        }

        // AHR-1955: source PDFs for `pdf` kind contract templates are stored as a raw
        // r2_key on contract_templates.pdf_file_path — no `files` row, so file_id isn't
        // applicable. Mirrors the contract_signature branch above. Admin/owner only.
        if (resource_type === "contract_template_pdf") {
            const { contract_template_id } = body as { contract_template_id?: string };
            if (!contract_template_id || typeof contract_template_id !== "string") {
                return jsonResponse(
                    { error: "contract_template_id is required for resource_type=contract_template_pdf" },
                    400,
                );
            }

            const { data: template } = await supabaseAdmin
                .from("contract_templates")
                .select("organization_id, pdf_file_path")
                .eq("id", contract_template_id)
                .maybeSingle();
            if (!template) {
                return jsonResponse({ error: "Contract template not found" }, 404);
            }
            if (!template.pdf_file_path) {
                return jsonResponse({ error: "Contract template has no PDF" }, 404);
            }

            const orgIdTpl = template.organization_id as string;
            const isAdminOrOwnerTpl = await isOrgAdminOrOwner(supabaseAdmin, orgIdTpl, user.id);
            if (!isAdminOrOwnerTpl) {
                return jsonResponse(
                    { error: "Forbidden — admin or owner role required" },
                    403,
                );
            }

            const nowTpl = Math.floor(Date.now() / 1000);
            const expTpl = nowTpl + TOKEN_TTL_SECONDS;
            const jwtTpl = await new SignJWT({
                userId: user.id,
                orgId: orgIdTpl,
                r2Key: template.pdf_file_path as string,
                resourceId: contract_template_id,
                resourceType: "contract_template_pdf",
                env: ENVIRONMENT,
            })
                .setProtectedHeader({ alg: "HS256" })
                .setIssuedAt(nowTpl)
                .setExpirationTime(expTpl)
                .sign(secretBytes);
            const urlTpl = `${R2_WORKER_URL}/${template.pdf_file_path}?token=${jwtTpl}`;
            return jsonResponse(
                { url: urlTpl, expiresAt: new Date(expTpl * 1000).toISOString() },
                200,
            );
        }

        if (!file_id || typeof file_id !== "string") {
            return jsonResponse({ error: "file_id is required" }, 400);
        }

        const { data: file } = await supabaseAdmin
            .from("files")
            .select("r2_key, thumbnail_r2_key, organization_id")
            .eq("id", file_id)
            .maybeSingle();
        if (!file) {
            return jsonResponse({ error: "File not found" }, 404);
        }

        // AHR-17xx: optionally sign the thumbnail path instead of the original.
        // If use_thumbnail is true but the file has no thumbnail, return 404 so
        // the caller falls back to a filename-only cell (vs getting a broken URL).
        const targetR2Key = use_thumbnail
            ? (file.thumbnail_r2_key as string | null)
            : (file.r2_key as string);
        if (use_thumbnail && !targetR2Key) {
            return jsonResponse({ error: "Thumbnail not available" }, 404);
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
        } else {
            // invitation_col
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

            orgId = invitation.organization_id as string;
            if (file.organization_id !== orgId) {
                return jsonResponse(
                    { error: "File does not belong to this invitation's organization" },
                    403,
                );
            }

            // Dual auth — mirrors upload-start: recipient email match OR admin/owner.
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
        }

        const now = Math.floor(Date.now() / 1000);
        const exp = now + TOKEN_TTL_SECONDS;

        const jwt = await new SignJWT({
            userId: user.id,
            orgId,
            r2Key: targetR2Key,
            resourceId: file_id,
            resourceType: resource_type,
            env: ENVIRONMENT,
        })
            .setProtectedHeader({ alg: "HS256" })
            .setIssuedAt(now)
            .setExpirationTime(exp)
            .sign(secretBytes);

        const url = `${R2_WORKER_URL}/${targetR2Key}?token=${jwt}`;
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
