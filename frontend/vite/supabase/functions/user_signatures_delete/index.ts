/**
 * Deletes one saved signature and its stored object (CG-029).
 *
 * WHY THIS IS NOT `files_r2_delete`. That endpoint resolves the object through a
 * `files` row and refuses outright when the row has no `organization_id`
 * ("User-scope files cannot be deleted via this endpoint"). Its own comment
 * prescribes exactly this remedy: a new scope "should arrive as a scoped
 * endpoint with its own permission, not by widening this one".
 *
 * CG-037 CORRECTION. This comment used to justify itself with "a saved signature
 * has no `files` row at all — because `files.organization_id` is NOT NULL". That
 * premise was false: the column has always been nullable, and AHR-803 shipped
 * user-scope policies for exactly this row shape. Since CG-037 a signature DOES
 * have a `files` row, and `user_signatures.file_id` points at it. The conclusion
 * survives the correction — `files_r2_delete` still refuses user-scope rows — but
 * see the deletion note below, which the change does affect.
 *
 * The permission here is ownership, and nothing else. There is no org to be an
 * admin of, so `resolveSelf` authenticates and the `user_id` filter on the
 * SELECT authorizes.
 *
 * The row is deleted only after the object, matching `files_r2_delete`: the row
 * is what the UI reads, so an object that outlives a failed row-delete is an
 * invisible orphan, while a row that outlives a failed object-delete renders as a
 * broken image.
 */

import { getStorageDriver, type StorageDriver } from "../_shared/storage.ts";
import { jsonResponse } from "../_shared/http.ts";
import { resolveSelf, SenderAuthError, serveSenderFunction } from "../_shared/senderAuth.ts";

// Built on first request rather than at boot so a driver whose credentials are
// missing surfaces as a 500 on the call, not a dead worker.
let storage: StorageDriver | null = null;
const getStorage = () => (storage ??= getStorageDriver());

serveSenderFunction("user_signatures_delete", async (body, req) => {
    const { signature_id } = body as { signature_id?: string };
    if (!signature_id || typeof signature_id !== "string") {
        throw new SenderAuthError(400, "signature_id is required");
    }

    const self = await resolveSelf(req);

    // The `user_id` equality is in the WHERE clause rather than checked after the
    // fetch, so someone else's signature id is indistinguishable from one that
    // does not exist. This client is service_role and bypasses RLS, so this
    // predicate is the whole of the authorization.
    const { data: signature } = await self.admin
        .from("user_signatures")
        .select("id, r2_key, file_id, is_default")
        .eq("id", signature_id)
        .eq("user_id", self.userId)
        .maybeSingle();
    if (!signature) throw new SenderAuthError(404, "Signature not found");

    // Tolerates backend failure by logging and continuing — see the driver.
    await getStorage().deleteObjects([signature.r2_key as string]);

    const { error: deleteError } = await self.admin
        .from("user_signatures")
        .delete()
        .eq("id", signature_id)
        .eq("user_id", self.userId);
    if (deleteError) {
        console.error("user_signatures_delete row delete failed:", deleteError);
        throw new SenderAuthError(500, "Failed to delete the signature");
    }

    // CG-037 gave every object a `files` row, which means this endpoint acquired
    // a way to leak one: delete the signature and the row describing its bytes
    // outlives both the signature and the object, as a permanent phantom in the
    // table whose whole job is to say what exists.
    //
    // AFTER the row delete, not before, and that ordering is enforced rather than
    // chosen — `user_signatures.file_id` is ON DELETE RESTRICT, so removing the
    // `files` row first would simply fail.
    //
    // Non-fatal. The signature IS deleted, which is what was asked; a surviving
    // `files` row is bookkeeping to clean up, not a failed operation to report to
    // someone who cannot act on it.
    if (signature.file_id) {
        const { error: fileDeleteError } = await self.admin
            .from("files")
            .delete()
            .eq("id", signature.file_id as string);
        if (fileDeleteError) {
            console.error("user_signatures_delete files row delete failed:", fileDeleteError);
        }
    }

    // Deleting the default leaves the library with none, which would make the
    // signing screen preselect nothing even though saved signatures remain. The
    // most recently created survivor takes over.
    //
    // Done here rather than in the client so the promotion cannot be lost to a
    // closed tab, and expressed as a plain UPDATE rather than through
    // `set_default_signature()` because that RPC reads `auth.uid()` and this
    // client is service_role — it would clear nobody's default and set nothing.
    // Safe against the one-default index precisely because the delete above
    // removed the only row that held it.
    if (signature.is_default) {
        const { data: next } = await self.admin
            .from("user_signatures")
            .select("id")
            .eq("user_id", self.userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (next) {
            const { error: promoteError } = await self.admin
                .from("user_signatures")
                .update({ is_default: true })
                .eq("id", next.id)
                .eq("user_id", self.userId);
            // Not fatal: the signature IS deleted, which is what was asked. The
            // user can set a default again from Settings.
            if (promoteError) console.error("Default promotion failed:", promoteError);
        }
    }

    return jsonResponse({ success: true }, 200);
});
