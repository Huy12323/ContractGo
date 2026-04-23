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
        "id, organization_id, employee_email, contract_template_id, contract_template_version_id, template_snapshot, prefilled_fields, status"
      )
      .eq("invitation_token", invitation_token)
      .single();

    if (invError || !invitation) {
      return jsonResponse({ error: "Invitation not found" }, 404);
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

    // Determine flow: first submit vs re-submit.
    // - First submit: invitation.status === 'sent', no contract exists
    // - Re-submit: invitation.status === 'accepted', contract exists at status 'sent' (HR sent back with comments)
    const { data: existingContract, error: existingContractError } = await supabaseAdmin
      .from("contracts")
      .select("id, status, signature_path")
      .eq("invitation_id", invitation.id)
      .maybeSingle();

    if (existingContractError) {
      return jsonResponse({ error: existingContractError.message }, 500);
    }

    // Turn signal lives on invitation.status:
    //   sent + no contract   → first fill
    //   sent + contract=sent → resubmit (HR sent it back)
    // Anything else means the employee isn't expected to act.
    const isFirstSubmit = invitation.status === "sent" && !existingContract;
    const isResubmit =
      invitation.status === "sent" &&
      !!existingContract &&
      existingContract.status === "sent";

    if (!isFirstSubmit && !isResubmit) {
      return jsonResponse(
        {
          error: `Cannot submit: invitation is ${invitation.status}${
            existingContract ? `, contract is ${existingContract.status}` : ", no contract"
          }`,
        },
        409
      );
    }

    // Validate mandatory fields against the MERGED view (HR prefill ∪ employee edits).
    // Source is the invitation's SNAPSHOT (AHR-1490) — what the invitee actually saw
    // and agreed to, not the (possibly since-edited) live template. field_values from
    // client contains only employee-touched keys; HR's prefill may satisfy a mandatory
    // key without the employee touching it. Stale mandatory keys (no longer in the
    // snapshotted layout) are silently ignored.
    const snapshot = (invitation.template_snapshot ?? {}) as {
      layout?: unknown;
      mandatory_field_keys?: string[];
    };
    const mandatoryKeys = (snapshot.mandatory_field_keys ?? []) as string[];
    if (mandatoryKeys.length > 0) {
      const layoutKeys = new Set<string>();
      const walkLayout = (node: unknown) => {
        if (node && typeof node === "object") {
          const n = node as { type?: string; attrs?: { fieldKey?: string }; content?: unknown[] };
          if (n.type === "fieldInput" && n.attrs?.fieldKey) layoutKeys.add(n.attrs.fieldKey);
          if (Array.isArray(n.content)) n.content.forEach(walkLayout);
        }
      };
      walkLayout(snapshot.layout);

      const isMeaningful = (v: unknown) => v !== undefined && v !== null && v !== "";
      const mergedForValidation = {
        ...((invitation.prefilled_fields ?? {}) as Record<string, unknown>),
        ...((field_values ?? {}) as Record<string, unknown>),
      };
      const missing = mandatoryKeys
        .filter((k) => layoutKeys.has(k))
        .filter((k) => !isMeaningful(mergedForValidation[k]));

      if (missing.length > 0) {
        return jsonResponse(
          { error: "Missing required fields", missing_keys: missing },
          400
        );
      }
    }

    const signerIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("cf-connecting-ip") ??
      null;
    const signedAt = new Date().toISOString();

    // Resolve (or create) the contract row. In resubmit, we UPDATE the existing row.
    let contractId: string;
    if (isResubmit) {
      contractId = existingContract!.id;
    } else {
      // AHR-1491: template_snapshot + contract_template_version_id copied from
      // the invitation. snapshot.layout is the authoritative rendering source
      // for the signed contract (bare JSONB layout, not the richer invitation
      // snapshot shape). contract_template_version_id is the provenance pointer.
      const snapshotLayout = (snapshot.layout ?? {}) as Record<string, unknown>;

      const { data: inserted, error: contractError } = await supabaseAdmin
        .from("contracts")
        .insert({
          organization_id: invitation.organization_id,
          employee_id: null,
          invitation_id: invitation.id,
          contract_template_id: invitation.contract_template_id,
          contract_template_version_id: invitation.contract_template_version_id,
          template_snapshot: snapshotLayout,
          field_values: field_values ?? {},
          prefilled_fields: invitation.prefilled_fields ?? {},
          status: "filled",
          signed_at: signedAt,
          signed_by: user.id,
          signer_ip: signerIp,
        })
        .select("id")
        .single();

      if (contractError || !inserted) {
        console.error("Insert contract error:", contractError);
        return jsonResponse(
          { error: contractError?.message ?? "Failed to create contract" },
          500
        );
      }
      contractId = inserted.id;
    }

    // Upload signature PNG to storage (path is keyed by contract.id — stable across resubmits)
    const signaturePath = `${invitation.organization_id}/contracts/${contractId}/signature.png`;
    const signatureBytes = decodeBase64Png(signature_base64);

    const { error: uploadError } = await supabaseAdmin.storage
      .from("org-files")
      .upload(signaturePath, signatureBytes, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      console.error("Signature upload error:", uploadError);
      // Rollback: first-submit deletes the newly-created contract. Resubmit leaves existing row alone.
      if (!isResubmit) {
        await supabaseAdmin.from("contracts").delete().eq("id", contractId);
      }
      return jsonResponse(
        { error: "Failed to upload signature" },
        500
      );
    }

    // Finalize contract: set signature_path + (resubmit) flip back to filled with new values
    const contractUpdatePayload: Record<string, unknown> = isResubmit
      ? {
          signature_path: signaturePath,
          field_values: field_values ?? {},
          status: "filled",
          signed_at: signedAt,
          signed_by: user.id,
          signer_ip: signerIp,
        }
      : { signature_path: signaturePath };

    const { error: updateError } = await supabaseAdmin
      .from("contracts")
      .update(contractUpdatePayload)
      .eq("id", contractId);

    if (updateError) {
      console.error("Update contract error:", updateError);
      await supabaseAdmin.storage.from("org-files").remove([signaturePath]);
      if (!isResubmit) {
        await supabaseAdmin.from("contracts").delete().eq("id", contractId);
      }
      return jsonResponse(
        { error: "Failed to finalize contract" },
        500
      );
    }

    // Both first-submit and resubmit flip invitation to 'accepted' — ball is now in HR's court.
    const { error: invUpdateError } = await supabaseAdmin
      .from("onboarding_invitations")
      .update({ status: "accepted" })
      .eq("id", invitation.id);

    if (invUpdateError) {
      console.error("Invitation update error:", invUpdateError);
      // Contract persisted successfully — don't rollback, surface the error.
      return jsonResponse(
        {
          contract_id: contractId,
          status: "contract_created_invitation_stale",
          error: invUpdateError.message,
        },
        207
      );
    }

    return jsonResponse(
      { contract_id: contractId, status: "filled" },
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
