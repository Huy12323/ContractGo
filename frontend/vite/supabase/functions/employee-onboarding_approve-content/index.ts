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

    const { invitation_id } = (await req.json()) as { invitation_id: string };
    if (!invitation_id) {
      return jsonResponse({ error: "invitation_id is required" }, 400);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Load invitation
    const { data: invitation, error: invError } = await supabaseAdmin
      .from("onboarding_invitations")
      .select("id, organization_id, status")
      .eq("id", invitation_id)
      .single();

    if (invError || !invitation) {
      return jsonResponse({ error: "Invitation not found" }, 404);
    }

    // Admin/owner gate
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, owner_id")
      .eq("id", invitation.organization_id)
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
        .eq("organization_id", invitation.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();
      isAdmin = !!adminRow;
    }
    if (!isOwner && !isAdmin) {
      return jsonResponse(
        { error: "Only admins and owners can approve contracts" },
        403
      );
    }

    if (invitation.status !== "accepted") {
      return jsonResponse(
        { error: `Cannot approve: invitation is ${invitation.status}` },
        409
      );
    }

    // Require the contract to exist at status='filled'
    const { data: contract, error: contractError } = await supabaseAdmin
      .from("contracts")
      .select("id, status")
      .eq("invitation_id", invitation.id)
      .maybeSingle();

    if (contractError) {
      return jsonResponse({ error: contractError.message }, 500);
    }
    if (!contract || contract.status !== "filled") {
      return jsonResponse(
        { error: "No filled contract to approve" },
        409
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("onboarding_invitations")
      .update({ status: "pending_placement" })
      .eq("id", invitation.id);

    if (updateError) {
      console.error("Invitation update error:", updateError);
      return jsonResponse({ error: updateError.message }, 500);
    }

    return jsonResponse(
      { invitation_id: invitation.id, status: "pending_placement" },
      200
    );
  } catch (err) {
    console.error("employee-onboarding_approve-content error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
