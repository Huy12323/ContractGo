import { createClient } from "supabase";

function requireEnv(name: string): string {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const APP_URL = requireEnv("APP_URL");

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

/**
 * Phase 2 of the wizard's file-upload send flow. The caller already created the
 * invitation row via `send-invitation` with `skip_email: true`, uploaded the
 * pending files via `invitation_col` uploads, and PATCHed `prefilled_fields`
 * with the resolved file_ids. This endpoint runs the HR-fill gate against the
 * now-final prefilled_fields and dispatches the email.
 */
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

        const { invitation_id } = (await req.json()) as { invitation_id?: string };
        if (!invitation_id || typeof invitation_id !== "string") {
            return jsonResponse({ error: "invitation_id is required" }, 400);
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        const { data: invitation, error: invErr } = await supabaseAdmin
            .from("onboarding_invitations")
            .select(
                "id, organization_id, employee_email, contract_template_version_id, prefilled_fields, invitation_token, status",
            )
            .eq("id", invitation_id)
            .maybeSingle();
        if (invErr || !invitation) {
            return jsonResponse({ error: "Invitation not found" }, 404);
        }

        // Admin/owner auth — same rule as the create endpoint. The invitation recipient
        // does NOT fire this call; only HR does, as part of the wizard Send orchestration.
        const { data: org } = await supabaseAdmin
            .from("organizations")
            .select("id, name, owner_id")
            .eq("id", invitation.organization_id)
            .maybeSingle();
        if (!org) {
            return jsonResponse({ error: "Organization not found" }, 404);
        }

        const isOwner = org.owner_id === user.id;
        let isAdmin = false;
        if (!isOwner) {
            const { data: adminRow } = await supabaseAdmin
                .from("admins")
                .select("id")
                .eq("organization_id", invitation.organization_id)
                .eq("user_id", user.id)
                .maybeSingle();
            isAdmin = !!adminRow;
        }
        if (!isOwner && !isAdmin) {
            return jsonResponse(
                { error: "Only admins and owners can send onboarding invitation emails" },
                403,
            );
        }

        // HR-fill gate — runs against the final prefilled_fields (now includes resolved
        // file_ids from the phase-1 upload orchestration).
        const { data: version } = await supabaseAdmin
            .from("contract_template_versions")
            .select("hr_field_keys")
            .eq("id", invitation.contract_template_version_id)
            .maybeSingle();

        const hrFieldKeys: string[] = Array.isArray(version?.hr_field_keys)
            ? (version!.hr_field_keys as string[])
            : [];
        if (hrFieldKeys.length > 0) {
            const provided = (invitation.prefilled_fields as Record<string, unknown>) || {};
            const missing = hrFieldKeys.filter((k) => {
                const v = provided[k];
                return v === undefined || v === null || v === "";
            });
            if (missing.length > 0) {
                return jsonResponse(
                    {
                        error: `HR-FILL fields must be filled before sending: ${missing.join(", ")}`,
                        missing_hr_field_keys: missing,
                    },
                    400,
                );
            }
        }

        // Dispatch email
        const invitationLink = `${APP_URL}/onboarding/${invitation.invitation_token}`;
        const emailRes = await fetch(
            `${SUPABASE_URL}/functions/v1/shared--send-email`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    scenario: "employee_onboarding_invitation",
                    to: invitation.employee_email,
                    payload: { orgName: org.name, invitationLink },
                }),
            },
        );
        if (!emailRes.ok) {
            const emailError = await emailRes.text();
            console.error("Email service error:", emailError);
            return jsonResponse(
                {
                    id: invitation.id,
                    status: "email_failed",
                    error: "Invitation email delivery failed",
                },
                207,
            );
        }

        return jsonResponse(
            { id: invitation.id, invitation_token: invitation.invitation_token, status: "sent" },
            200,
        );
    } catch (err) {
        console.error("employee-onboarding_send-invitation-email error:", err);
        return jsonResponse(
            { error: err instanceof Error ? err.message : "Internal error" },
            500,
        );
    }
});
