import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authenticate caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request
    const { organization_id, email } = await req.json();
    if (!organization_id || !email) {
      return new Response(JSON.stringify({ error: "organization_id and email are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service_role client for DB operations
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verify caller is org owner
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, name, owner_id")
      .eq("id", organization_id)
      .single();

    if (orgError || !org) {
      return new Response(JSON.stringify({ error: "Organization not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (org.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "Only the organization owner can send invitations" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert invitation (reset token + expiry on duplicate)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const token = crypto.randomUUID();

    const { data: invitation, error: upsertError } = await supabaseAdmin
      .from("admin_invitations")
      .upsert(
        {
          organization_id,
          email: email.toLowerCase().trim(),
          token,
          status: "pending",
          invited_by: user.id,
          expires_at: expiresAt,
        },
        { onConflict: "organization_id,email" }
      )
      .select("id, token")
      .single();

    if (upsertError) {
      return new Response(JSON.stringify({ error: upsertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send email via shared--send-email service
    const invitationLink = `${APP_URL}/invitation?token=${invitation.token}`;

    const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/shared--send-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scenario: "admin_invitation",
        to: email,
        payload: { orgName: org.name, invitationLink },
      }),
    });

    if (!emailRes.ok) {
      const emailError = await emailRes.text();
      console.error("Email service error:", emailError);
      return new Response(JSON.stringify({ error: "Failed to send invitation email" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ id: invitation.id, status: "sent" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("send-admin-invitation error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
