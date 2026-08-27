/**
 * Signs a time-limited read URL.
 *
 * CG-009 (Phase J) removed four of the six resource types. `contract`,
 * `employee_col`, `invitation_col`, `contract_signature` and `invitation_pdf`
 * all resolved their organization through `employee_contracts`, `employees` or
 * `onboarding_invitations` — renamed or dropped — so every one of them queried a
 * table that no longer exists. Their only callers were `useQ_Files_ReadUrl` and
 * the v1 onboarding surface, both retired.
 *
 * What is left is the one branch the app actually calls: the source PDF behind a
 * contract template, read by the builder and the versions modal.
 *
 * CG-027: requires `"member"`, matching the template's own SELECT policy. A
 * member composing a document picks a template and must be able to see it; a
 * member who cannot send still sees the library. Uploading a replacement is the
 * privileged half and lives in `files_r2_upload-start` behind
 * `"manage_templates"`.
 *
 * Note what does NOT appear here: nothing on the signer's path. `signing_session_open`
 * signs the document URL itself through the storage driver, precisely so an
 * external signer never needs a `files_r2_*` call and this function never needs
 * to understand token auth.
 *
 * The `files`-table lookup went too. It only served the removed branches; the
 * template PDF is a raw `r2_key` on `contract_templates.pdf_file_path` with no
 * `files` row, which is why `file_id` was never applicable to it.
 */

import { getStorageDriver, type StorageDriver } from "../_shared/storage.ts";
import { jsonResponse, requireEnv } from "../_shared/http.ts";
import {
    resolveSelf,
    resolveSender,
    SenderAuthError,
    serveSenderFunction,
} from "../_shared/senderAuth.ts";
import { createClient } from "supabase";

// Built on first request rather than at boot so a driver whose credentials are
// missing surfaces as a 500 on the call, not a dead worker. Under the `r2`
// driver this mints the Worker HS256 token; under `local` it returns a Supabase
// Storage signed URL.
let storage: StorageDriver | null = null;
const getStorage = () => (storage ??= getStorageDriver());

const TOKEN_TTL_SECONDS = 7 * 24 * 3600;

serveSenderFunction("files_r2_sign-read-url", async (body, req) => {
    const { resource_type } = body as { resource_type?: string };

    if (resource_type === "user_avatar" || resource_type === "organization_logo") {
        // CG-050 adds the logo to this refusal for the same reason the avatar is
        // here, plus a sharper one. A signed URL for a logo would be actively
        // harmful: the logo's audiences are an anonymous signer and an email
        // client, so the only way to make a signed URL work in mail is a TTL long
        // enough that the URL becomes a permanent bearer credential sitting in a
        // mail archive. Build it from `r2_key` — the Worker serves it unauthenticated.
        throw new SenderAuthError(
            400,
            `${resource_type} URLs are constructed directly by the client from r2_key — ` +
                "no sign call needed"
        );
    }
    // CG-029. Unlike an avatar, a saved signature CANNOT be addressed by
    // concatenating the Worker origin with its r2_key — that shortcut works only
    // because the avatar namespace is served unauthenticated, and signatures
    // deliberately are not. So the library grid signs every image it renders,
    // through here.
    if (resource_type === "user_signature") {
        const { signature_id } = body as { signature_id?: string };
        if (!signature_id || typeof signature_id !== "string") {
            throw new SenderAuthError(
                400,
                "signature_id is required for resource_type=user_signature"
            );
        }

        const self = await resolveSelf(req);

        // The `user_id` filter is the authorization, and it is in the WHERE
        // clause rather than checked after the fetch so someone else's signature
        // id is indistinguishable from a nonexistent one. Reading with the
        // service_role client bypasses RLS, so this predicate is doing the whole
        // job that the `users_can_view_own_signatures` policy does elsewhere.
        const { data: signature } = await self.admin
            .from("user_signatures")
            .select("r2_key")
            .eq("id", signature_id)
            .eq("user_id", self.userId)
            .maybeSingle();
        if (!signature) throw new SenderAuthError(404, "Signature not found");

        const signatureUrl = await getStorage().createReadUrl({
            key: signature.r2_key as string,
            expiresIn: TOKEN_TTL_SECONDS,
            claims: {
                userId: self.userId,
                // No organization — see `ReadUrlClaims.orgId`. The Worker matches
                // this token's `userId` against the id embedded in the path.
                orgId: null,
                resourceId: signature_id,
                resourceType: "user_signature",
            },
        });

        return jsonResponse(
            {
                url: signatureUrl,
                expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString(),
            },
            200
        );
    }

    if (resource_type !== "contract_template_pdf") {
        throw new SenderAuthError(
            400,
            "resource_type must be one of: contract_template_pdf, user_signature"
        );
    }

    const { contract_template_id } = body as { contract_template_id?: string };
    if (!contract_template_id || typeof contract_template_id !== "string") {
        throw new SenderAuthError(
            400,
            "contract_template_id is required for resource_type=contract_template_pdf"
        );
    }

    // Org resolved from the template first, then authorized — a template in
    // another organization must be indistinguishable from a missing one.
    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: template } = await admin
        .from("contract_templates")
        .select("organization_id, pdf_file_path")
        .eq("id", contract_template_id)
        .maybeSingle();
    if (!template) throw new SenderAuthError(404, "Template not found");
    if (!template.pdf_file_path) throw new SenderAuthError(404, "Template has no PDF");

    const ctx = await resolveSender(req, template.organization_id as string, "member");

    const url = await getStorage().createReadUrl({
        key: template.pdf_file_path as string,
        expiresIn: TOKEN_TTL_SECONDS,
        claims: {
            userId: ctx.userId,
            orgId: ctx.organizationId,
            resourceId: contract_template_id,
            resourceType: "contract_template_pdf",
        },
    });

    return jsonResponse(
        { url, expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString() },
        200
    );
});
