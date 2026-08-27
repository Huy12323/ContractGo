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
        const { token, type } = (await req.json()) as { token?: string; type?: string };

        if (!token) {
            return jsonResponse({ error: "Missing token" }, 400);
        }

        if (!type || !["verification", "recovery"].includes(type)) {
            return jsonResponse(
                { error: "Invalid type — must be 'verification' or 'recovery'" },
                400
            );
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // Clean up expired tokens first
        await supabaseAdmin.rpc("cleanup_expired_auth_tokens");

        // Find the token
        const { data: tokenRow, error: tokenError } = await supabaseAdmin
            .from("auth_tokens")
            .select("id, user_id, type, expires_at")
            .eq("token", token)
            .eq("type", type)
            .single();

        if (tokenError || !tokenRow) {
            return jsonResponse({ error: "Invalid or expired token" }, 400);
        }

        // Check expiry
        if (new Date(tokenRow.expires_at) < new Date()) {
            await supabaseAdmin.from("auth_tokens").delete().eq("id", tokenRow.id);
            return jsonResponse({ error: "Token has expired" }, 400);
        }

        // Delete the token (single use)
        await supabaseAdmin.from("auth_tokens").delete().eq("id", tokenRow.id);

        if (type === "verification") {
            // Mark email as verified
            const { error: updateError } = await supabaseAdmin
                .from("profiles")
                .update({ email_verified: true })
                .eq("id", tokenRow.user_id);

            if (updateError) {
                console.error("Profile update error:", updateError);
                return jsonResponse({ error: "Failed to verify email" }, 500);
            }

            return jsonResponse({ status: "verified" }, 200);
        }

        if (type === "recovery") {
            // Return user ID so frontend can proceed with password update
            return jsonResponse({ status: "valid", userId: tokenRow.user_id }, 200);
        }

        return jsonResponse({ error: "Unexpected type" }, 400);
    } catch (err) {
        console.error("auth_verify-token error:", err);
        return jsonResponse(
            {
                error: err instanceof Error ? err.message : "Internal error",
            },
            500
        );
    }
});
