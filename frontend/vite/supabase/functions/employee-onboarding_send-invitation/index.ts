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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // Authenticate caller
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

    // Parse request
    const {
      organization_id,
      employee_email,
      entity_id,
      contract_template_id,
      department_ids,
      prefilled_fields,
    } = (await req.json()) as {
      organization_id: string;
      employee_email: string;
      entity_id: string;
      contract_template_id: string;
      department_ids: string[];
      prefilled_fields: Record<string, unknown>;
    };

    if (
      !organization_id ||
      !employee_email ||
      !entity_id ||
      !contract_template_id
    ) {
      return jsonResponse(
        {
          error:
            "organization_id, employee_email, entity_id, and contract_template_id are required",
        },
        400
      );
    }

    // Service-role client for DB operations
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verify caller is admin or owner of the organization
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, name, owner_id")
      .eq("id", organization_id)
      .single();

    if (orgError || !org) {
      return jsonResponse({ error: "Organization not found" }, 404);
    }

    const isOwner = org.owner_id === user.id;
    let isAdmin = false;
    if (!isOwner) {
      const { data: adminRow } = await supabaseAdmin
        .from("admins")
        .select("id")
        .eq("organization_id", organization_id)
        .eq("user_id", user.id)
        .maybeSingle();
      isAdmin = !!adminRow;
    }

    if (!isOwner && !isAdmin) {
      return jsonResponse(
        { error: "Only admins and owners can send onboarding invitations" },
        403
      );
    }

    const normalizedEmail = employee_email.toLowerCase().trim();

    // Block duplicates: only block if this email belongs to a registered auth user who
    // is already a real EMPLOYEE in this org. Owners and admins WITHOUT an employees row
    // are allowed to be invited (or to invite themselves) so they can self-onboard via
    // the regular contract flow. See AHR-557.
    const { data: authUserRow } = await supabaseAdmin
      .schema("auth")
      .from("users")
      .select("id")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (authUserRow) {
      const targetUserId = authUserRow.id as string;

      // Employee check by user_id (only block if there's a real employees row for this user)
      const { data: existingEmployeeByUser } = await supabaseAdmin
        .from("employees")
        .select("id")
        .eq("organization_id", organization_id)
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (existingEmployeeByUser) {
        return jsonResponse(
          {
            error:
              "An employee with this email already exists in this organization. You cannot onboard them again.",
          },
          409
        );
      }
    }

    // Block duplicates: employee row that has the email column populated
    // (in case it was set without a linked auth user — defensive)
    const { data: existingEmployeeByEmail } = await supabaseAdmin
      .from("employees")
      .select("id")
      .eq("organization_id", organization_id)
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (existingEmployeeByEmail) {
      return jsonResponse(
        {
          error:
            "An employee with this email already exists in this organization. You cannot onboard them again.",
        },
        409
      );
    }

    // Block duplicates: ongoing invitation (sent or accepted) for this email in this org
    const { data: ongoingInvitations } = await supabaseAdmin
      .from("onboarding_invitations")
      .select("id, status")
      .eq("organization_id", organization_id)
      .ilike("employee_email", normalizedEmail)
      .in("status", ["sent", "accepted"]);

    if (ongoingInvitations && ongoingInvitations.length > 0) {
      const hasAccepted = ongoingInvitations.some((i) => i.status === "accepted");
      const message = hasAccepted
        ? "A contract from this email is already pending HR approval. Review or revoke it before sending a new invitation."
        : "There is already a pending invitation for this email. Delete the existing invitation first if you want to send a new one.";
      return jsonResponse({ error: message }, 409);
    }

    // Insert onboarding invitation
    const { data: invitation, error: insertError } = await supabaseAdmin
      .from("onboarding_invitations")
      .insert({
        organization_id,
        employee_email: employee_email.toLowerCase().trim(),
        entity_id,
        contract_template_id,
        prefilled_fields: prefilled_fields || {},
        sent_by: user.id,
      })
      .select("id, invitation_token, status")
      .single();

    if (insertError) {
      console.error("Insert invitation error:", insertError);
      return jsonResponse({ error: insertError.message }, 500);
    }

    // Insert department junction rows
    if (department_ids && department_ids.length > 0) {
      const junctionRows = department_ids.map((department_id: string) => ({
        invitation_id: invitation.id,
        department_id,
      }));

      const { error: junctionError } = await supabaseAdmin
        .from("rel__department__invitation")
        .insert(junctionRows);

      if (junctionError) {
        console.error("Insert junction error:", junctionError);
        // Clean up the invitation if junction insert fails
        await supabaseAdmin
          .from("onboarding_invitations")
          .delete()
          .eq("id", invitation.id);
        return jsonResponse(
          { error: "Failed to assign departments" },
          500
        );
      }
    }

    // Send email via shared--send-email
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
          to: employee_email,
          payload: { orgName: org.name, invitationLink },
        }),
      }
    );

    if (!emailRes.ok) {
      const emailError = await emailRes.text();
      console.error("Email service error:", emailError);
      // Invitation is created but email failed — don't roll back, let HR retry
      return jsonResponse(
        {
          id: invitation.id,
          status: "created_email_failed",
          error: "Invitation created but email delivery failed",
        },
        207
      );
    }

    return jsonResponse(
      { id: invitation.id, invitation_token: invitation.invitation_token, status: "sent" },
      200
    );
  } catch (err) {
    console.error("employee-onboarding_send-invitation error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
