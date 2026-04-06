function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const RESEND_API_KEY = requireEnv("RESEND_API_KEY");
const SENDER_EMAIL = requireEnv("RESEND_SENDER_EMAIL");
const SENDER_NAME = requireEnv("RESEND_SENDER_NAME");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// --- Scenario Registry ---

type EmailScenario = "auth_confirmation" | "auth_recovery" | "admin_invitation";

interface ScenarioConfig {
  subject: string;
  template: string;
  requiredFields: string[];
}

// --- Inline Templates (Supabase edge runtime doesn't preserve non-TS files) ---

const TEMPLATE_SHELL = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${title}</title><style>body{margin:0;padding:0;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#f0f5ff}.container{max-width:480px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06);border:1px solid #e8e8e8}.header{background:#0958d9;padding:32px 24px;text-align:center}.logo{width:40px;height:40px;background:rgba(255,255,255,.2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:20px;color:#fff}.header h1{color:#fff;font-size:18px;font-weight:700;margin:0;letter-spacing:.5px}.content{padding:32px 28px}.content h2{color:#1a1a1a;font-size:20px;font-weight:600;margin:0 0 12px}.content p{color:#555;font-size:15px;line-height:1.6;margin:0 0 16px}.btn{display:inline-block;padding:12px 28px;background:#0958d9;color:#fff!important;text-decoration:none!important;border-radius:6px;font-weight:600;font-size:15px}.btn-wrap{text-align:center;margin:24px 0}.divider{height:1px;background:#e8e8e8;margin:24px 0}.muted{color:#999;font-size:13px;line-height:1.5}.footer{background:#fafafa;padding:20px 28px;text-align:center;border-top:1px solid #e8e8e8}.footer p{color:#999;font-size:12px;margin:4px 0}</style></head><body><div class="container"><div class="header"><div class="logo">&#128101;</div><h1>AIUR-HR</h1></div><div class="content">${body}</div><div class="footer"><p>&copy; 2026 AIUR-HR. All rights reserved.</p></div></div></body></html>`;

const TEMPLATES: Record<EmailScenario, string> = {
  auth_confirmation: TEMPLATE_SHELL("Verify your email - AIUR-HR",
    `<h2>Verify your email</h2><p>Hi {{name}}, thanks for signing up! Click the button below to verify your email address.</p><div class="btn-wrap"><a href="{{confirmationUrl}}" class="btn" style="color:#fff!important;text-decoration:none!important">Verify Email Address</a></div><div class="divider"></div><p class="muted">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>`),
  auth_recovery: TEMPLATE_SHELL("Reset your password - AIUR-HR",
    `<h2>Reset your password</h2><p>Hi {{name}}, we received a request to reset your password. Click the button below to choose a new one.</p><div class="btn-wrap"><a href="{{recoveryUrl}}" class="btn" style="color:#fff!important;text-decoration:none!important">Reset Password</a></div><div class="divider"></div><p class="muted">This link expires in 24 hours. If you didn't request a password reset, you can safely ignore this email.</p>`),
  admin_invitation: TEMPLATE_SHELL("You're invited - AIUR-HR",
    `<h2>You've been invited!</h2><p>You've been invited to join <strong>{{orgName}}</strong> as an admin on AIUR HR.</p><div class="btn-wrap"><a href="{{invitationLink}}" class="btn" style="color:#fff!important;text-decoration:none!important">Accept Invitation</a></div><p class="muted">This invitation expires in 7 days. If you didn't expect this, you can safely ignore it.</p>`),
};

const SCENARIOS: Record<EmailScenario, ScenarioConfig> = {
  auth_confirmation: {
    subject: "Verify your email - AIUR-HR",
    template: TEMPLATES.auth_confirmation,
    requiredFields: ["name", "confirmationUrl"],
  },
  auth_recovery: {
    subject: "Reset your password - AIUR-HR",
    template: TEMPLATES.auth_recovery,
    requiredFields: ["name", "recoveryUrl"],
  },
  admin_invitation: {
    subject: "You're invited to join {{orgName}} on AIUR HR",
    template: TEMPLATES.admin_invitation,
    requiredFields: ["orgName", "invitationLink"],
  },
};

// --- Helpers ---

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// --- Handler ---

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Auth check — service role key only
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.replace("Bearer ", "");
  if (bearerToken !== SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const { scenario, to, payload } = await req.json() as {
      scenario: string;
      to: string;
      payload: Record<string, string>;
    };

    if (!scenario || !(scenario in SCENARIOS)) {
      return jsonResponse({ error: "Invalid scenario", valid: Object.keys(SCENARIOS) }, 400);
    }

    if (!to) {
      return jsonResponse({ error: "Missing 'to' email address" }, 400);
    }

    const config = SCENARIOS[scenario as EmailScenario];

    const missing = config.requiredFields.filter((f) => !payload?.[f]);
    if (missing.length > 0) {
      return jsonResponse({ error: "Missing payload fields", missing }, 400);
    }

    const html = interpolate(config.template, payload);
    const subject = interpolate(config.subject, payload);

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${SENDER_NAME} <${SENDER_EMAIL}>`,
        to: [to],
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const resendError = await resendRes.text();
      console.error("Resend error:", resendError);
      return jsonResponse({ error: "Email delivery failed", details: resendError }, 502);
    }

    const resendData = await resendRes.json();
    return jsonResponse({ id: resendData.id, status: "sent" }, 200);
  } catch (err) {
    console.error("shared--send-email error:", err);
    return jsonResponse({
      error: err instanceof Error ? err.message : "Internal error",
    }, 500);
  }
});
