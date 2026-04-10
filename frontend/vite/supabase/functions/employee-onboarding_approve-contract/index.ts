import { createClient } from "supabase";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

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

const COL_KEY_PATTERN = /^col_[A-Za-z0-9]+$/;

function pickColumnValues(
  ...sources: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (!COL_KEY_PATTERN.test(key)) continue;
      if (value === undefined || value === null || value === "") continue;
      merged[key] = value;
    }
  }
  return merged;
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

    const body = (await req.json()) as {
      contract_id?: string;
      first_name?: string;
      last_name?: string;
      birthday?: string;
    };

    const contractId = body.contract_id?.trim();
    const firstName = body.first_name?.trim();
    const lastName = body.last_name?.trim();
    const birthday = body.birthday?.trim() || "0001-01-01";

    if (!contractId || !firstName || !lastName) {
      return jsonResponse(
        { error: "contract_id, first_name, last_name are required" },
        400
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Resolve contract
    const { data: contract, error: contractFetchError } = await supabaseAdmin
      .from("contracts")
      .select(
        "id, organization_id, status, invitation_id, signed_by, field_values, prefilled_fields"
      )
      .eq("id", contractId)
      .single();

    if (contractFetchError || !contract) {
      return jsonResponse({ error: "Contract not found" }, 404);
    }

    if (contract.status !== "filled") {
      return jsonResponse(
        { error: `Contract is not pending approval (status: ${contract.status})` },
        409
      );
    }

    if (!contract.invitation_id) {
      return jsonResponse(
        { error: "Contract has no linked invitation" },
        409
      );
    }

    if (!contract.signed_by) {
      return jsonResponse(
        { error: "Contract has no signer recorded" },
        409
      );
    }

    // Auth: caller must be admin or owner of the contract's organization
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("owner_id")
      .eq("id", contract.organization_id)
      .single();

    const isOwner = org?.owner_id === user.id;

    let isAdmin = false;
    if (!isOwner) {
      const { data: adminRow } = await supabaseAdmin
        .from("admins")
        .select("id")
        .eq("organization_id", contract.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();
      isAdmin = !!adminRow;
    }

    if (!isOwner && !isAdmin) {
      return jsonResponse(
        { error: "Forbidden — admin or owner role required" },
        403
      );
    }

    // Resolve invitation
    const { data: invitation, error: invitationFetchError } =
      await supabaseAdmin
        .from("onboarding_invitations")
        .select("id, organization_id, employee_email, status")
        .eq("id", contract.invitation_id)
        .single();

    if (invitationFetchError || !invitation) {
      return jsonResponse({ error: "Linked invitation not found" }, 404);
    }

    if (invitation.organization_id !== contract.organization_id) {
      return jsonResponse(
        { error: "Invitation/contract organization mismatch" },
        409
      );
    }

    if (invitation.status !== "accepted") {
      return jsonResponse(
        { error: `Invitation is not in accepted state (status: ${invitation.status})` },
        409
      );
    }

    // Build employees insert payload
    const colValues = pickColumnValues(
      contract.prefilled_fields as Record<string, unknown> | null,
      contract.field_values as Record<string, unknown> | null
    );

    const employeeInsert = {
      organization_id: invitation.organization_id,
      user_id: contract.signed_by,
      email: invitation.employee_email,
      first_name: firstName,
      last_name: lastName,
      birthday,
      ...colValues,
    };

    const { data: newEmployee, error: employeeInsertError } =
      await supabaseAdmin
        .from("employees")
        // deno-lint-ignore no-explicit-any
        .insert(employeeInsert as any)
        .select("id")
        .single();

    if (employeeInsertError || !newEmployee) {
      console.error("Insert employee error:", employeeInsertError);
      return jsonResponse(
        {
          error:
            employeeInsertError?.message ?? "Failed to create employee row",
        },
        500
      );
    }

    // Update contract → active + audit fields
    const { error: contractUpdateError } = await supabaseAdmin
      .from("contracts")
      .update({
        employee_id: newEmployee.id,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        status: "active",
      })
      .eq("id", contract.id);

    if (contractUpdateError) {
      console.error("Update contract error:", contractUpdateError);
      // Rollback employee insert
      await supabaseAdmin.from("employees").delete().eq("id", newEmployee.id);
      return jsonResponse(
        { error: contractUpdateError.message },
        500
      );
    }

    // Copy rel__department__invitation → rel__department__employee
    const { data: deptLinks, error: deptFetchError } = await supabaseAdmin
      .from("rel__department__invitation")
      .select("department_id")
      .eq("invitation_id", invitation.id);

    if (deptFetchError) {
      console.error("Fetch department links error:", deptFetchError);
      // Rollback contract + employee
      await supabaseAdmin
        .from("contracts")
        .update({
          employee_id: null,
          approved_by: null,
          approved_at: null,
          status: "filled",
        })
        .eq("id", contract.id);
      await supabaseAdmin.from("employees").delete().eq("id", newEmployee.id);
      return jsonResponse(
        { error: "Failed to read invitation departments" },
        500
      );
    }

    if (deptLinks && deptLinks.length > 0) {
      const employeeDeptRows = deptLinks.map((row) => ({
        department_id: row.department_id,
        employee_id: newEmployee.id,
      }));

      const { error: deptInsertError } = await supabaseAdmin
        .from("rel__department__employee")
        .insert(employeeDeptRows);

      if (deptInsertError) {
        console.error("Insert department links error:", deptInsertError);
        // Rollback contract + employee + best-effort dept cleanup
        await supabaseAdmin
          .from("rel__department__employee")
          .delete()
          .eq("employee_id", newEmployee.id);
        await supabaseAdmin
          .from("contracts")
          .update({
            employee_id: null,
            approved_by: null,
            approved_at: null,
            status: "filled",
          })
          .eq("id", contract.id);
        await supabaseAdmin
          .from("employees")
          .delete()
          .eq("id", newEmployee.id);
        return jsonResponse(
          { error: deptInsertError.message },
          500
        );
      }
    }

    // Flip invitation → approved
    const { error: invitationUpdateError } = await supabaseAdmin
      .from("onboarding_invitations")
      .update({ status: "approved" })
      .eq("id", invitation.id);

    if (invitationUpdateError) {
      console.error(
        "Invitation status update error:",
        invitationUpdateError
      );
      // Contract is active and employee exists — surface a 207 partial success
      return jsonResponse(
        {
          employee_id: newEmployee.id,
          contract_id: contract.id,
          status: "active_invitation_stale",
          error: invitationUpdateError.message,
        },
        207
      );
    }

    return jsonResponse(
      {
        employee_id: newEmployee.id,
        contract_id: contract.id,
        status: "active",
      },
      200
    );
  } catch (err) {
    console.error("employee-onboarding_approve-contract error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
