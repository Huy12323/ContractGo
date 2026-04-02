import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SENDER_EMAIL = Deno.env.get("RESEND_SENDER_EMAIL") ?? "noreply@e.aiursoftware.com";
const SENDER_NAME = Deno.env.get("RESEND_SENDER_NAME") ?? "AIUR HR";
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:5173";

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
      .from("org_admin_invitations")
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

    // Send email via Resend
    const invitationLink = `${APP_URL}/invitation?token=${invitation.token}`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${SENDER_NAME} <${SENDER_EMAIL}>`,
        to: [email],
        subject: `You're invited to join ${org.name} on AIUR HR`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
            <h2 style="color: #1a1a1a; margin-bottom: 8px;">You've been invited!</h2>
            <p style="color: #666; font-size: 15px; line-height: 1.5;">
              You've been invited to join <strong>${org.name}</strong> as an admin on AIUR HR.
            </p>
            <a href="${invitationLink}" style="display: inline-block; background: #0958d9; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: 600; margin: 16px 0;">
              Accept Invitation
            </a>
            <p style="color: #999; font-size: 13px; margin-top: 24px;">
              This invitation expires in 7 days. If you didn't expect this, you can safely ignore it.
            </p>
          </div>
        `,
      }),
    });

    if (!resendRes.ok) {
      const resendError = await resendRes.text();
      console.error("Resend error:", resendError);
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
