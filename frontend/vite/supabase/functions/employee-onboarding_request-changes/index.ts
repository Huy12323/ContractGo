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

    const { invitation_id, comment_body } = (await req.json()) as {
      invitation_id: string;
      comment_body: string;
    };
    const trimmedBody = comment_body?.trim();
    if (!invitation_id || !trimmedBody) {
      return jsonResponse(
        { error: "invitation_id and non-empty comment_body are required" },
        400
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Load invitation (to get hr_comments + organization_id)
    const { data: invitation, error: invError } = await supabaseAdmin
      .from("onboarding_invitations")
      .select("id, organization_id, status, hr_comments")
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
        { error: "Only admins and owners can request changes" },
        403
      );
    }

    if (invitation.status !== "accepted") {
      return jsonResponse(
        { error: `Cannot request changes: invitation is ${invitation.status}` },
        409
      );
    }

    // Require the contract at status='filled'
    const { data: contract, error: contractError } = await supabaseAdmin
      .from("contracts")
      .select("id, status, signature_path")
      .eq("invitation_id", invitation.id)
      .maybeSingle();

    if (contractError) {
      return jsonResponse({ error: contractError.message }, 500);
    }
    if (!contract || contract.status !== "filled") {
      return jsonResponse(
        { error: "No filled contract to request changes on" },
        409
      );
    }

    // Append the new comment (whole-array rewrite)
    const existingComments = Array.isArray(invitation.hr_comments)
      ? (invitation.hr_comments as Array<Record<string, unknown>>)
      : [];
    const newComment = {
      id: `chc_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      author_id: user.id,
      body: trimmedBody,
      created_at: new Date().toISOString(),
    };
    const nextComments = [...existingComments, newComment];

    // Flip invitation back to 'sent' — ball is in the employee's court again.
    const { error: invUpdateError } = await supabaseAdmin
      .from("onboarding_invitations")
      .update({ hr_comments: nextComments, status: "sent" })
      .eq("id", invitation.id);

    if (invUpdateError) {
      console.error("Invitation hr_comments update error:", invUpdateError);
      return jsonResponse({ error: invUpdateError.message }, 500);
    }

    // Delete signature file from R2/storage (best-effort; don't fail the flow)
    if (contract.signature_path) {
      const { error: removeError } = await supabaseAdmin.storage
        .from("org-files")
        .remove([contract.signature_path]);
      if (removeError) {
        console.error("Signature remove error (non-fatal):", removeError);
      }
    }

    // Clear signature fields + flip contract to 'sent'
    const { error: contractUpdateError } = await supabaseAdmin
      .from("contracts")
      .update({
        signed_at: null,
        signed_by: null,
        signer_ip: null,
        signature_path: null,
        status: "sent",
      })
      .eq("id", contract.id);

    if (contractUpdateError) {
      console.error("Contract update error:", contractUpdateError);
      return jsonResponse({ error: contractUpdateError.message }, 500);
    }

    return jsonResponse(
      { contract_id: contract.id, status: "sent", comment_id: newComment.id },
      200
    );
  } catch (err) {
    console.error("employee-onboarding_request-changes error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
