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

function decodeBase64Png(dataUrl: string): Uint8Array {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  const raw = match ? match[2]! : dataUrl;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
    if (authError || !user || !user.email) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const {
      invitation_token,
      field_values,
      signature_base64,
    } = (await req.json()) as {
      invitation_token: string;
      field_values: Record<string, unknown>;
      signature_base64: string;
    };

    if (!invitation_token || !signature_base64) {
      return jsonResponse(
        { error: "invitation_token and signature_base64 are required" },
        400
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Resolve invitation by token
    const { data: invitation, error: invError } = await supabaseAdmin
      .from("onboarding_invitations")
      .select(
        "id, organization_id, employee_email, contract_template_id, prefilled_fields, status"
      )
      .eq("invitation_token", invitation_token)
      .single();

    if (invError || !invitation) {
      return jsonResponse({ error: "Invitation not found" }, 404);
    }

    if (invitation.status !== "sent") {
      return jsonResponse(
        { error: `Invitation is already ${invitation.status}` },
        409
      );
    }

    if (
      user.email.toLowerCase().trim() !==
      invitation.employee_email.toLowerCase().trim()
    ) {
      return jsonResponse(
        { error: "Signed-in email does not match invitation" },
        403
      );
    }

    // Fetch template layout (snapshot source)
    const { data: template, error: templateError } = await supabaseAdmin
      .from("contract_templates")
      .select("id, layout")
      .eq("id", invitation.contract_template_id)
      .single();

    if (templateError || !template) {
      return jsonResponse({ error: "Contract template not found" }, 404);
    }

    const signerIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("cf-connecting-ip") ??
      null;

    // Insert contract row first (employee_id NULL — set on HR approval)
    const { data: contract, error: contractError } = await supabaseAdmin
      .from("contracts")
      .insert({
        organization_id: invitation.organization_id,
        employee_id: null,
        invitation_id: invitation.id,
        contract_template_id: invitation.contract_template_id,
        form_snapshot: template.layout ?? {},
        field_values: field_values ?? {},
        prefilled_fields: invitation.prefilled_fields ?? {},
        status: "filled",
        signed_at: new Date().toISOString(),
        signed_by: user.id,
        signer_ip: signerIp,
      })
      .select("id")
      .single();

    if (contractError || !contract) {
      console.error("Insert contract error:", contractError);
      return jsonResponse(
        { error: contractError?.message ?? "Failed to create contract" },
        500
      );
    }

    // Upload signature PNG to storage
    const signaturePath = `${invitation.organization_id}/contracts/${contract.id}/signature.png`;
    const signatureBytes = decodeBase64Png(signature_base64);

    const { error: uploadError } = await supabaseAdmin.storage
      .from("org-files")
      .upload(signaturePath, signatureBytes, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      console.error("Signature upload error:", uploadError);
      // Rollback contract insert
      await supabaseAdmin.from("contracts").delete().eq("id", contract.id);
      return jsonResponse(
        { error: "Failed to upload signature" },
        500
      );
    }

    // Update contract with signature path
    const { error: updateError } = await supabaseAdmin
      .from("contracts")
      .update({ signature_path: signaturePath })
      .eq("id", contract.id);

    if (updateError) {
      console.error("Update contract signature path error:", updateError);
      await supabaseAdmin.storage.from("org-files").remove([signaturePath]);
      await supabaseAdmin.from("contracts").delete().eq("id", contract.id);
      return jsonResponse(
        { error: "Failed to finalize contract" },
        500
      );
    }

    // Flip invitation to accepted
    const { error: invUpdateError } = await supabaseAdmin
      .from("onboarding_invitations")
      .update({ status: "accepted" })
      .eq("id", invitation.id);

    if (invUpdateError) {
      console.error("Invitation update error:", invUpdateError);
      // Contract is created successfully — don't rollback, surface the error
      return jsonResponse(
        {
          contract_id: contract.id,
          status: "contract_created_invitation_stale",
          error: invUpdateError.message,
        },
        207
      );
    }

    return jsonResponse(
      { contract_id: contract.id, status: "filled" },
      200
    );
  } catch (err) {
    console.error("employee-onboarding_submit-contract error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
