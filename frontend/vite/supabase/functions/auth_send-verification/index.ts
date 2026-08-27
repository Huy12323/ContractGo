import { createClient } from "supabase";

function requireEnv(name: string): string {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const APP_URL = requireEnv("APP_URL");

const TOKEN_EXPIRY_HOURS = 24;

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

    try {
        // Authenticate caller — must be a logged-in user
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

        const { type } = (await req.json()) as { type?: string };
        const tokenType = type === "recovery" ? "recovery" : "verification";

        // Use service role client for DB operations
        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // Get user profile for name
        const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("full_name, email")
            .eq("id", user.id)
            .single();

        const name = profile?.full_name || user.email?.split("@")[0] || "there";
        const email = profile?.email || user.email;

        if (!email) {
            return jsonResponse({ error: "No email found for user" }, 400);
        }

        // Delete any existing tokens of this type for this user
        await supabaseAdmin
            .from("auth_tokens")
            .delete()
            .eq("user_id", user.id)
            .eq("type", tokenType);

        // Create new token
        const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

        const { data: tokenRow, error: tokenError } = await supabaseAdmin
            .from("auth_tokens")
            .insert({ user_id: user.id, type: tokenType, expires_at: expiresAt })
            .select("token")
            .single();

        if (tokenError || !tokenRow) {
            console.error("Token creation error:", tokenError);
            return jsonResponse({ error: "Failed to create token" }, 500);
        }

        // Determine scenario and URL
        const scenario = tokenType === "verification" ? "auth_confirmation" : "auth_recovery";
        const urlPath =
            tokenType === "verification"
                ? `/verify-email?token=${tokenRow.token}`
                : `/reset-password?token=${tokenRow.token}`;
        const actionUrl = `${APP_URL}${urlPath}`;

        const payload: Record<string, string> = { name };
        if (tokenType === "verification") {
            payload.confirmationUrl = actionUrl;
        } else {
            payload.recoveryUrl = actionUrl;
        }

        // Send email via shared--send-email
        const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/shared--send-email`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ scenario, to: email, payload }),
        });

        if (!emailRes.ok) {
            const emailError = await emailRes.text();
            console.error("Email service error:", emailError);
            return jsonResponse({ error: "Failed to send email" }, 502);
        }

        return jsonResponse({ status: "sent", type: tokenType }, 200);
    } catch (err) {
        console.error("auth_send-verification error:", err);
        return jsonResponse(
            {
                error: err instanceof Error ? err.message : "Internal error",
            },
            500
        );
    }
});
