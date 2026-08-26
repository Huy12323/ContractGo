/**
 * Deletes a `files` row and its stored objects.
 *
 * CG-009 (Phase J) removed the `invitations` scope branch. It parsed an
 * invitation id out of the `r2_key` path and looked it up in
 * `onboarding_invitations` to grant the recipient delete rights alongside
 * admins — the same `split_part(r2_key, '/', 4)` pattern the plan cites as the
 * demonstration of how brittle path-parsed authorization gets. That table is
 * dropped and external signers now get no database grants at all, so the rule
 * collapses to the one it always had for every other scope: admin or owner of
 * the file's organization.
 *
 * The local `isOrgAdminOrOwner` copy went with it, in favour of the single
 * implementation in `_shared/senderAuth.ts`.
 *
 * CG-027 left this at `"admin"`. It deletes any org-scoped `files` row by id,
 * whatever the row is for, so neither of the two grantable permissions describes
 * it — `manage_templates` would be too narrow for the endpoint and too broad for
 * the caller. If a member-reachable delete is ever needed it should arrive as a
 * scoped endpoint with its own permission, not by widening this one.
 */

import { getStorageDriver, type StorageDriver } from "../_shared/storage.ts";
import { jsonResponse, requireEnv } from "../_shared/http.ts";
import { resolveSender, SenderAuthError, serveSenderFunction } from "../_shared/senderAuth.ts";
import { createClient } from "supabase";

// Built on first request rather than at boot so a driver whose credentials are
// missing surfaces as a 500 on the call, not a dead worker.
let storage: StorageDriver | null = null;
const getStorage = () => (storage ??= getStorageDriver());

serveSenderFunction("files_r2_delete", async (body, req) => {
    const { file_id } = body as { file_id?: string };
    if (!file_id || typeof file_id !== "string") {
        throw new SenderAuthError(400, "file_id is required");
    }

    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));

    const { data: file } = await admin
        .from("files")
        .select("r2_key, thumbnail_r2_key, organization_id")
        .eq("id", file_id)
        .maybeSingle();
    if (!file) throw new SenderAuthError(404, "File not found");

    if (!file.organization_id) {
        throw new SenderAuthError(400, "User-scope files cannot be deleted via this endpoint");
    }

    await resolveSender(req, file.organization_id as string);

    // Delete stored objects (original + thumbnail). The driver tolerates
    // intermittent backend failures by logging and continuing — the DB row is
    // the audit record; orphaned objects are cheap and detectable later.
    const keysToDelete: string[] = [file.r2_key as string];
    if (file.thumbnail_r2_key) keysToDelete.push(file.thumbnail_r2_key as string);
    await getStorage().deleteObjects(keysToDelete);

    const { error: deleteError } = await admin.from("files").delete().eq("id", file_id);
    if (deleteError) {
        console.error("files_r2_delete row delete failed:", deleteError);
        throw new SenderAuthError(500, "Failed to delete the file record");
    }

    return jsonResponse({ success: true }, 200);
});
