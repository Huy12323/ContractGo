/**
 * Presigns an upload URL.
 *
 * CG-009 (Phase J) removed three of the five resource types. `contract`,
 * `employee_col` and `invitation_col` scoped uploads to `employee_contracts`,
 * `employees` and `onboarding_invitations` — the first two were renamed during
 * the HR strip and the third is now dropped, so all three branches queried
 * tables that no longer exist and would have 404'd on every call. Nothing in
 * `src/` had invoked them since Phase I retired the employee grid and the v1
 * onboarding surface.
 *
 * The local `isOrgMember` / `isOrgAdminOrOwner` helpers went with them. They
 * were a fourth and fifth copy of the check that now lives once in
 * `_shared/senderAuth.ts`, and `isOrgMember`'s membership branch still read
 * `employees` — so it silently returned false for every non-admin member, which
 * is precisely the drift a shared module exists to prevent.
 *
 * CG-027: the `contract_template_pdf` branch requires `"manage_templates"`.
 * Replacing a template's source PDF is editing the template — the strongest
 * write there is, since every future document drawn from it inherits the new
 * file — so it takes the same permission as editing the record.
 *
 * `contract_template_pdf` keeps its name. It is the edge function's wire
 * contract with `useM_Template_UploadPdf`, and renaming it to `template_pdf` is
 * a coordinated client+server change the plan schedules separately from this
 * cleanup.
 *
 * CG-036: KEY LAYOUT. Every resource now lands in a folder named for its type,
 * under the owner that scopes it. Before this, templates were foldered but an
 * avatar was a bare `avatar-{ts}-{id}.png` filename sitting directly in the
 * user's directory, and a thumbnail inherited whatever folder its parent's branch
 * happened to produce — so listing "all avatars" or "all thumbnails" in the R2
 * dashboard was not a thing you could do.
 *
 *   orgs/{org_id}/templates/{template_id}/{ts}-{uid}-{name}
 *   orgs/{org_id}/templates/{template_id}/thumbnails/{ts}-{uid}.webp
 *   users/{user_id}/avatars/{ts}-{uid}.{ext}
 *   users/{user_id}/avatars/thumbnails/{ts}-{uid}.webp
 *   users/{user_id}/signatures/{uuid}.png
 *
 * The two TOP-LEVEL namespaces are unchanged and deliberately so: the Worker
 * branches its entire auth posture on `orgs/` versus `users/`, and moving to a
 * type-first layout would have meant rewriting that branching around five new
 * top-level names. Everything below the owner is free to be organized; the first
 * two segments are load-bearing.
 *
 * Existing objects are NOT moved. The Worker accepts both the old and new avatar
 * shapes for exactly this reason — see `isAvatarPath` there.
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
// missing surfaces as a 500 on the call, not a dead worker.
let storage: StorageDriver | null = null;
const getStorage = () => (storage ??= getStorageDriver());

const PRESIGNED_URL_EXPIRES_IN = 3600;
const MAX_SIZE_BYTES = 500 * 1024 * 1024;
const RESOURCE_TYPES = [
    "user_avatar",
    "user_signature",
    "contract_template_pdf",
    "organization_logo",
] as const;
type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * CG-029. A signature is always a PNG produced by the capture pad's canvas — the
 * drawn and typed modes call `toDataURL('image/png')`, and the uploaded mode is
 * re-encoded through the same canvas — so this is an exact contract rather than a
 * courtesy filter. It also bounds what the `<img>` in the library grid can be
 * asked to render.
 */
const SIGNATURE_CONTENT_TYPE = "image/png";
/**
 * Generous for a 480×180 PNG (they land around 10–50KB) and far below the 500MB
 * app-wide ceiling, which is a limit for source PDFs and means nothing here.
 */
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

/**
 * CG-036. The folder every derived thumbnail lands in, appended to its parent's
 * directory rather than given a namespace of its own — a thumbnail inherits its
 * parent's authorization exactly, so it must inherit its parent's path prefix
 * exactly too. Give thumbnails their own top-level namespace and the Worker's
 * `orgs/**` token check stops covering them.
 */
const THUMBNAIL_SEGMENT = "thumbnails";
const THUMBNAIL_EXTENSION = "webp";

/**
 * CG-050. The org branding logo, and the one namespace under `orgs/` the Worker
 * serves with NO TOKEN — see `isOrgBrandingPath` there for why that is the only
 * posture that works for an anonymous signer and an email client.
 *
 * The content-type allowlist is therefore a SECURITY control, not a convenience.
 * `image/svg+xml` is deliberately absent: an SVG can carry script, and an SVG
 * served token-free from an origin we control is stored XSS on that origin, for
 * zero product benefit over a PNG. Allowlist, never a `startsWith("image/")` —
 * that would readmit SVG and every future image type nobody has evaluated.
 */
const LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** A logo renders at ~40px. 2MB is already extravagant; 500MB is meaningless. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

function sanitizeFileName(fileName: string): string {
    return fileName
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_+/g, "_")
        .substring(0, 200);
}

function generateRandomId(): string {
    return crypto.randomUUID().replace(/-/g, "").substring(0, 12);
}

function extractExtension(fileName: string): string {
    const match = fileName.toLowerCase().match(/\.[^.]+$/);
    return match ? match[0].slice(1) : "bin";
}

serveSenderFunction("files_r2_upload-start", async (body, req) => {
    const { resource_type, file_name, content_type, size, is_thumbnail } = body as {
        resource_type?: string;
        file_name?: string;
        content_type?: string;
        size?: number;
        /**
         * CG-036. Set by `useM_Files_Upload`'s second presign call, the one for the
         * webp it derived from the file the user actually chose. It is a hint about
         * WHERE the object goes, not a separate resource type: the caller still
         * sends the parent's `resource_type` and ids, so authorization runs exactly
         * as it does for the parent and a thumbnail cannot be presigned anywhere
         * its parent could not be.
         */
        is_thumbnail?: boolean;
    };

    if (!resource_type || !RESOURCE_TYPES.includes(resource_type as ResourceType)) {
        throw new SenderAuthError(
            400,
            `resource_type must be one of: ${RESOURCE_TYPES.join(", ")}`
        );
    }
    if (!file_name || typeof file_name !== "string" || !file_name.trim()) {
        throw new SenderAuthError(400, "file_name is required");
    }
    if (!content_type || typeof content_type !== "string") {
        throw new SenderAuthError(400, "content_type is required");
    }
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
        throw new SenderAuthError(400, "size must be a positive number");
    }
    if (size > MAX_SIZE_BYTES) {
        throw new SenderAuthError(400, `size exceeds ${MAX_SIZE_BYTES}-byte ceiling`);
    }

    const timestamp = Date.now();
    const uniqueId = generateRandomId();
    const sanitized = sanitizeFileName(file_name);

    let r2Key: string;

    if (resource_type === "contract_template_pdf") {
        // AHR-1955: the source PDF the template builder overlays positioned
        // fields on. Keyed under the template id so a "Replace PDF" re-upload
        // lands cleanly beside the old key rather than overwriting it — the
        // previous version's layout still refers to the previous PDF, and
        // `App_TemplateVersionsModal` warns when the two have diverged.
        const { contract_template_id } = body as { contract_template_id?: string };
        if (!contract_template_id || typeof contract_template_id !== "string") {
            throw new SenderAuthError(
                400,
                "contract_template_id is required for resource_type=contract_template_pdf"
            );
        }

        // The org is read from the template first, then authorized — a template
        // in another organization must be indistinguishable from a missing one,
        // so the 404 below is deliberately returned before any role check.
        const admin = createClient(
            requireEnv("SUPABASE_URL"),
            requireEnv("SUPABASE_SERVICE_ROLE_KEY")
        );
        const { data: template } = await admin
            .from("contract_templates")
            .select("organization_id")
            .eq("id", contract_template_id)
            .maybeSingle();
        if (!template) throw new SenderAuthError(404, "Template not found");

        const ctx = await resolveSender(
            req,
            template.organization_id as string,
            "manage_templates"
        );

        // CG-036: `templates/`, was `contract-templates/`. Old objects keep their
        // old prefix; nothing reads the folder name, so both shapes coexist
        // without the Worker needing to know — `orgs/**` is a prefix match there.
        const dir = `orgs/${ctx.organizationId}/templates/${contract_template_id}`;
        r2Key = is_thumbnail
            ? `${dir}/${THUMBNAIL_SEGMENT}/${timestamp}-${uniqueId}.${THUMBNAIL_EXTENSION}`
            : `${dir}/${timestamp}-${uniqueId}-${sanitized}`;
    } else if (resource_type === "organization_logo") {
        // CG-050. The only resource here requiring OWNERSHIP rather than a
        // permission, and the requirement mirrors the database exactly: RLS on
        // `organizations` is `get_organization_role(id) = 'owner'` in both USING
        // and WITH CHECK, so an admin presigned here would upload successfully
        // and then be refused when writing `logo_file_id` — a confusing
        // half-failure that leaves an orphaned object in a PUBLIC bucket.
        const { organization_id } = body as { organization_id?: string };
        if (!organization_id || typeof organization_id !== "string") {
            throw new SenderAuthError(
                400,
                "organization_id is required for resource_type=organization_logo"
            );
        }

        const ctx = await resolveSender(req, organization_id, "owner");

        // No thumbnails in this namespace. The Worker's `isOrgBrandingPath`
        // matches EXACTLY four segments, so a thumbnail at five segments would
        // upload fine and then 403 forever on read. Rejected loudly for the same
        // reason `user_signature` rejects it.
        if (is_thumbnail) {
            throw new SenderAuthError(
                400,
                "resource_type=organization_logo does not support thumbnails"
            );
        }

        if (!LOGO_CONTENT_TYPES.includes(content_type as (typeof LOGO_CONTENT_TYPES)[number])) {
            throw new SenderAuthError(
                400,
                `content_type must be one of ${LOGO_CONTENT_TYPES.join(", ")} for ` +
                    `resource_type=organization_logo (SVG is refused: it can carry script, ` +
                    `and this object is served without a token)`
            );
        }

        if (size > MAX_LOGO_BYTES) {
            throw new SenderAuthError(400, `size exceeds the ${MAX_LOGO_BYTES}-byte logo ceiling`);
        }

        // Exactly four segments — `orgs/{id}/branding/{file}` — and no client
        // file name in it. The org id is not a secret, so `{timestamp}-{uniqueId}`
        // is what makes the object unenumerable, and that is load-bearing given
        // there is no token on the read.
        r2Key = `orgs/${ctx.organizationId}/branding/${timestamp}-${uniqueId}.${extractExtension(file_name)}`;
    } else {
        // user_avatar and user_signature — the two resources with no organization
        // at all, so neither can go through `resolveSender`. Their authorization
        // is simply that the caller may only write their own.
        const self = await resolveSelf(req);

        const { user_id } = body as { user_id?: string };
        if (!user_id || typeof user_id !== "string") {
            throw new SenderAuthError(
                400,
                `user_id is required for resource_type=${resource_type}`
            );
        }
        if (user_id !== self.userId) {
            throw new SenderAuthError(403, "Forbidden — user_id must match the authenticated user");
        }

        if (resource_type === "user_signature") {
            // CG-036. A signature has no thumbnail — the PNG is already smaller
            // than the webp would be — so this is not a shape the client should
            // ever ask for. Rejected rather than ignored: silently presigning the
            // full-size path for a caller who thinks it is getting a thumbnail
            // would let a thumbnail upload overwrite nothing and then be recorded
            // as if it had worked.
            if (is_thumbnail) {
                throw new SenderAuthError(
                    400,
                    "resource_type=user_signature does not support thumbnails"
                );
            }
            // CG-029. Note the namespace: `users/{id}/signatures/...`, NOT the
            // `users/{id}/avatars/...` shape beside it. The Worker serves avatars
            // with no token at all, and a signature must never be reachable that
            // way — an avatar leaking is a photo, a signature leaking is
            // forgeable material. The Worker has a matching token-authorized
            // branch keyed on exactly this path shape.
            if (content_type !== SIGNATURE_CONTENT_TYPE) {
                throw new SenderAuthError(
                    400,
                    `content_type must be ${SIGNATURE_CONTENT_TYPE} for resource_type=user_signature`
                );
            }
            if (size > MAX_SIGNATURE_BYTES) {
                throw new SenderAuthError(
                    400,
                    `size exceeds the ${MAX_SIGNATURE_BYTES}-byte signature ceiling`
                );
            }
            // No timestamp and no sanitized client file name in the key. Unlike a
            // template PDF, nothing here is a re-upload over a previous version
            // and no human ever reads this path, so a fresh uuid is the whole
            // name — and it keeps the caller's file name out of the object store.
            r2Key = `users/${user_id}/signatures/${crypto.randomUUID()}.png`;
        } else {
            // CG-036: `users/{id}/avatars/{file}`, was `users/{id}/avatar-{file}`.
            // A folder rather than a filename prefix, so the user's directory can
            // hold more than one kind of thing without the kinds interleaving.
            // The Worker still serves BOTH shapes with no token — old avatars are
            // not being moved.
            const dir = `users/${user_id}/avatars`;
            r2Key = is_thumbnail
                ? `${dir}/${THUMBNAIL_SEGMENT}/${timestamp}-${uniqueId}.${THUMBNAIL_EXTENSION}`
                : `${dir}/${timestamp}-${uniqueId}.${extractExtension(file_name)}`;
        }
    }

    const { uploadUrl, expiresAt } = await getStorage().createUploadUrl({
        key: r2Key,
        contentType: content_type,
        expiresIn: PRESIGNED_URL_EXPIRES_IN,
    });

    return jsonResponse({ uploadUrl, r2Key, expiresAt }, 200);
});
