import { createClient } from "supabase";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const R2_ACCOUNT_ID = requireEnv("R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID = requireEnv("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = requireEnv("R2_SECRET_ACCESS_KEY");
const R2_BUCKET_NAME = requireEnv("R2_BUCKET_NAME");

const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

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

function pickStringField(
  key: string,
  ...sources: Array<Record<string, unknown> | null | undefined>
): string | null {
  for (const source of sources) {
    if (!source) continue;
    const v = source[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// R2 helpers
// ---------------------------------------------------------------------------

async function fetchR2Object(key: string): Promise<Uint8Array> {
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }),
  );
  return new Uint8Array(await response.Body!.transformToByteArray());
}

// ---------------------------------------------------------------------------
// PDF burn — overlays field values + signature onto the source PDF
// ---------------------------------------------------------------------------

type PositionedField = {
  key: string;
  page: number;
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
  type: string;
};

async function burnPdfContract({
  sourcePdfBytes,
  signatureBytes,
  layout,
  fieldValues,
  choiceLabels,
}: {
  sourcePdfBytes: Uint8Array;
  signatureBytes: Uint8Array | null;
  layout: PositionedField[];
  fieldValues: Record<string, unknown>;
  choiceLabels: Record<string, Record<string, string>>;
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(sourcePdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const signatureImage =
    signatureBytes ? await pdfDoc.embedPng(signatureBytes) : null;

  for (const field of layout) {
    const page = pdfDoc.getPage(field.page - 1);
    const { width: pageW, height: pageH } = page.getSize();

    const x = field.x_pct * pageW;
    const y = pageH - (field.y_pct + field.h_pct) * pageH;
    const boxW = field.w_pct * pageW;
    const boxH = field.h_pct * pageH;

    if (field.type === "signature") {
      if (signatureImage) {
        page.drawImage(signatureImage, { x, y, width: boxW, height: boxH });
      }
      continue;
    }

    const rawValue = fieldValues[field.key];
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;

    let text = String(rawValue);
    if (field.type === "choice" && choiceLabels[field.key]) {
      text = choiceLabels[field.key][text] ?? text;
    }

    const fontSize = Math.min(boxH * 0.8, 14);
    const textY = y + (boxH - fontSize) / 2;

    page.drawText(text, {
      x: x + 2,
      y: textY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
      maxWidth: boxW - 4,
    });
  }

  return pdfDoc.save();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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

    // Resolve invitation
    const sb_FromOnboardingInvitations_Select = await supabaseAdmin
      .from("onboarding_invitations")
      .select("id, organization_id, entity_id, employee_email, status")
      .eq("id", invitation_id)
      .single();

    if (sb_FromOnboardingInvitations_Select.error || !sb_FromOnboardingInvitations_Select.data) {
      return jsonResponse({ error: "Invitation not found" }, 404);
    }
    const invitation = sb_FromOnboardingInvitations_Select.data;

    if (invitation.status !== "accepted") {
      return jsonResponse(
        { error: `Cannot approve: invitation is ${invitation.status}` },
        409,
      );
    }

    // Auth: caller must be admin or owner of the invitation's organization
    const sb_FromOrganizations_Select = await supabaseAdmin
      .from("organizations")
      .select("id, owner_id")
      .eq("id", invitation.organization_id)
      .single();

    if (sb_FromOrganizations_Select.error || !sb_FromOrganizations_Select.data) {
      return jsonResponse({ error: "Organization not found" }, 404);
    }
    const org = sb_FromOrganizations_Select.data;

    const isOwner = org.owner_id === user.id;
    let isAdmin = false;
    if (!isOwner) {
      const sb_FromAdmins_Select = await supabaseAdmin
        .from("admins")
        .select("id")
        .eq("organization_id", invitation.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();
      isAdmin = !!sb_FromAdmins_Select.data;
    }
    if (!isOwner && !isAdmin) {
      return jsonResponse(
        { error: "Only admins and owners can approve contracts" },
        403,
      );
    }

    // Resolve the filled contract
    const sb_FromContracts_Select = await supabaseAdmin
      .from("contracts")
      .select(
        "id, organization_id, status, signed_by, field_values, prefilled_fields, template_snapshot, signature_path",
      )
      .eq("invitation_id", invitation.id)
      .maybeSingle();

    if (sb_FromContracts_Select.error) {
      return jsonResponse({ error: sb_FromContracts_Select.error.message }, 500);
    }
    const contract = sb_FromContracts_Select.data;

    if (!contract || contract.status !== "filled") {
      return jsonResponse(
        { error: "No filled contract to approve" },
        409,
      );
    }
    if (!contract.signed_by) {
      return jsonResponse(
        { error: "Contract has no signer recorded" },
        409,
      );
    }

    const fieldValues = contract.field_values as Record<string, unknown> | null;
    const prefilled = contract.prefilled_fields as Record<string, unknown> | null;
    const firstName = pickStringField("first_name", fieldValues, prefilled) ?? "";
    const lastName = pickStringField("last_name", fieldValues, prefilled) ?? "";
    const birthday = pickStringField("birthday", fieldValues, prefilled) || "0001-01-01";

    const allColValues = pickColumnValues(prefilled, fieldValues);

    const sb_FromEmployeeColumns_Select = await supabaseAdmin
      .from("employee_columns")
      .select("id")
      .eq("entity_id", invitation.entity_id);

    if (sb_FromEmployeeColumns_Select.error) {
      console.error("Fetch employee_columns error:", sb_FromEmployeeColumns_Select.error);
      return jsonResponse(
        { error: "Failed to read field metadata for org" },
        500,
      );
    }

    const validColIds = new Set((sb_FromEmployeeColumns_Select.data ?? []).map((r) => r.id));
    const colValues: Record<string, unknown> = {};
    const discardedFields: string[] = [];
    for (const [key, value] of Object.entries(allColValues)) {
      if (validColIds.has(key)) {
        colValues[key] = value;
      } else {
        discardedFields.push(key);
      }
    }

    const employeeInsert = {
      entity_id: invitation.entity_id,
      user_id: contract.signed_by,
      email: invitation.employee_email,
      first_name: firstName,
      last_name: lastName,
      birthday,
    };

    const sb_FromEmployees_Insert = await supabaseAdmin
      .from("employees")
      .insert(employeeInsert)
      .select("id")
      .single();

    if (sb_FromEmployees_Insert.error || !sb_FromEmployees_Insert.data) {
      console.error("Insert employee error:", sb_FromEmployees_Insert.error);
      return jsonResponse(
        {
          error:
            sb_FromEmployees_Insert.error?.message ?? "Failed to create employee row",
        },
        500,
      );
    }
    const newEmployee = sb_FromEmployees_Insert.data;

    const perOrgTable = `${invitation.entity_id}__employees`;
    const sb_FromPerOrg_Upsert = await supabaseAdmin
      // deno-lint-ignore no-explicit-any
      .from(perOrgTable as any)
      .upsert(
        { employee_id: newEmployee.id, ...colValues },
        { onConflict: "employee_id" },
      );

    if (sb_FromPerOrg_Upsert.error) {
      console.error("Per-org insert error:", sb_FromPerOrg_Upsert.error);
      await supabaseAdmin.from("employees").delete().eq("id", newEmployee.id);
      return jsonResponse(
        { error: sb_FromPerOrg_Upsert.error.message },
        500,
      );
    }

    // Activate contract
    const sb_FromContracts_Update = await supabaseAdmin
      .from("contracts")
      .update({
        employee_id: newEmployee.id,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        status: "active",
      })
      .eq("id", contract.id);

    if (sb_FromContracts_Update.error) {
      console.error("Update contract error:", sb_FromContracts_Update.error);
      await supabaseAdmin.from("employees").delete().eq("id", newEmployee.id);
      return jsonResponse(
        { error: sb_FromContracts_Update.error.message },
        500,
      );
    }

    // -----------------------------------------------------------------------
    // PDF burn — only for pdf-kind contracts
    // -----------------------------------------------------------------------
    const templateSnapshot = contract.template_snapshot as
      | { type: "pdf"; layout: PositionedField[]; pdf_file_path: string }
      | { type: "tiptap" }
      | null;

    let burnedR2Key: string | null = null;

    if (templateSnapshot && templateSnapshot.type === "pdf") {
      try {
        const burnValues: Record<string, unknown> = {
          ...(prefilled ?? {}),
          ...(fieldValues ?? {}),
        };

        const choiceFieldKeys = templateSnapshot.layout
          .filter((f) => f.type === "choice")
          .map((f) => f.key);

        let choiceLabels: Record<string, Record<string, string>> = {};
        if (choiceFieldKeys.length > 0) {
          const sb_FromEmployeeColumnChoices_Select = await supabaseAdmin
            .from("employee_column_choices")
            .select("employee_column_id, value, label")
            .in("employee_column_id", choiceFieldKeys);

          if (sb_FromEmployeeColumnChoices_Select.data) {
            for (const row of sb_FromEmployeeColumnChoices_Select.data) {
              if (!choiceLabels[row.employee_column_id]) {
                choiceLabels[row.employee_column_id] = {};
              }
              choiceLabels[row.employee_column_id][row.value] = row.label;
            }
          }
        }

        const sourcePdfBytes = await fetchR2Object(templateSnapshot.pdf_file_path);

        let signatureBytes: Uint8Array | null = null;
        if (contract.signature_path) {
          signatureBytes = await fetchR2Object(contract.signature_path as string);
        }

        const burnedPdfBytes = await burnPdfContract({
          sourcePdfBytes,
          signatureBytes,
          layout: templateSnapshot.layout,
          fieldValues: burnValues,
          choiceLabels,
        });

        burnedR2Key = `orgs/${contract.organization_id}/contracts/${contract.id}/signed-${Date.now()}.pdf`;

        await s3Client.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: burnedR2Key,
            Body: burnedPdfBytes,
            ContentType: "application/pdf",
          }),
        );

        const sb_FromContracts_UpdatePath = await supabaseAdmin
          .from("contracts")
          .update({ signed_pdf_r2_path: burnedR2Key })
          .eq("id", contract.id);

        if (sb_FromContracts_UpdatePath.error) {
          console.error("Update signed_pdf_r2_path error:", sb_FromContracts_UpdatePath.error);
          try {
            await s3Client.send(
              new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: burnedR2Key }),
            );
          } catch { /* best-effort */ }
          throw new Error(sb_FromContracts_UpdatePath.error.message);
        }
      } catch (burnErr) {
        console.error("PDF burn failed:", burnErr);
        await supabaseAdmin
          .from("contracts")
          .update({
            employee_id: null,
            approved_by: null,
            approved_at: null,
            status: "filled",
            signed_pdf_r2_path: null,
          })
          .eq("id", contract.id);
        await supabaseAdmin.from("employees").delete().eq("id", newEmployee.id);
        if (burnedR2Key) {
          try {
            await s3Client.send(
              new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: burnedR2Key }),
            );
          } catch { /* best-effort */ }
        }
        return jsonResponse(
          { error: `PDF burn failed: ${burnErr instanceof Error ? burnErr.message : "Unknown error"}` },
          500,
        );
      }
    }

    // Copy rel__department__invitation → rel__department__employee
    const sb_FromRelDeptInvitation_Select = await supabaseAdmin
      .from("rel__department__invitation")
      .select("department_id")
      .eq("invitation_id", invitation.id);

    if (sb_FromRelDeptInvitation_Select.error) {
      console.error("Fetch department links error:", sb_FromRelDeptInvitation_Select.error);
      await supabaseAdmin
        .from("contracts")
        .update({
          employee_id: null,
          approved_by: null,
          approved_at: null,
          status: "filled",
          signed_pdf_r2_path: null,
        })
        .eq("id", contract.id);
      await supabaseAdmin.from("employees").delete().eq("id", newEmployee.id);
      return jsonResponse(
        { error: "Failed to read invitation departments" },
        500,
      );
    }

    const deptLinks = sb_FromRelDeptInvitation_Select.data;
    if (deptLinks && deptLinks.length > 0) {
      const employeeDeptRows = deptLinks.map((row) => ({
        department_id: row.department_id,
        employee_id: newEmployee.id,
      }));

      const sb_FromRelDeptEmployee_Insert = await supabaseAdmin
        .from("rel__department__employee")
        .insert(employeeDeptRows);

      if (sb_FromRelDeptEmployee_Insert.error) {
        console.error("Insert department links error:", sb_FromRelDeptEmployee_Insert.error);
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
            signed_pdf_r2_path: null,
          })
          .eq("id", contract.id);
        await supabaseAdmin
          .from("employees")
          .delete()
          .eq("id", newEmployee.id);
        return jsonResponse(
          { error: sb_FromRelDeptEmployee_Insert.error.message },
          500,
        );
      }
    }

    // Flip invitation → approved
    const sb_FromOnboardingInvitations_Update = await supabaseAdmin
      .from("onboarding_invitations")
      .update({ status: "approved" })
      .eq("id", invitation.id);

    if (sb_FromOnboardingInvitations_Update.error) {
      console.error(
        "Invitation status update error:",
        sb_FromOnboardingInvitations_Update.error,
      );
      return jsonResponse(
        {
          invitation_id: invitation.id,
          employee_id: newEmployee.id,
          contract_id: contract.id,
          status: "active_invitation_stale",
          discarded_fields: discardedFields,
          error: sb_FromOnboardingInvitations_Update.error.message,
        },
        207,
      );
    }

    return jsonResponse(
      {
        invitation_id: invitation.id,
        employee_id: newEmployee.id,
        contract_id: contract.id,
        status: "approved",
        discarded_fields: discardedFields,
      },
      200,
    );
  } catch (err) {
    console.error("employee-onboarding_approve-content error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500,
    );
  }
});
