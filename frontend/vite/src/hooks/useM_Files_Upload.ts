import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { useStore_Auth_User } from "@/stores/Store_Auth";
import { MAX_UPLOAD_SIZE_BYTES, MAX_UPLOAD_SIZE_MB } from "@/utils/const_FileUpload";
import { Utils_Files_ImageThumbnail } from "@/utils/Utils_Files_ImageThumbnail";
import { QueryKeys } from "@/utils/query/queryKeys";

// Discriminated by resource_type so one hook can cover several upload scopes.
//
// CG-009 (Phase J) removed the `employee_col` and `invitation_col` variants
// along with the edge-function branches behind them, which resolved their
// organization through `employees` and `onboarding_invitations` — renamed and
// dropped respectively. Only `contract_template_pdf` had a caller left.
//
// The union of one is deliberate rather than a collapse waiting to happen:
// `buildUploadStartBody` below still branches, so adding the v1.3 document
// browser's scope is one more member and one more branch, not a reshaping of
// every callsite.
export type UseM_Files_Upload_Params_ContractTemplatePdf = {
    resource_type: "contract_template_pdf";
    file: File;
    contract_template_id: string;
};

// The v1.3 avatar scope. Its key namespace is `users/{user_id}/…` rather than
// `orgs/{org_id}/…`, which is the whole reason the steps below branch: an avatar
// belongs to a PERSON, and a person spans organizations.
export type UseM_Files_Upload_Params_UserAvatar = {
    resource_type: "user_avatar";
    file: File;
    user_id: string;
};

// CG-029's saved signature scope. Shares the avatar's `users/{user_id}/…`
// namespace and its reasoning — a signature belongs to a PERSON, not to an
// organization — but NOT its read posture: the Worker serves avatars with no
// token and signatures only with one, so a caller must sign the URL through
// `files_r2_sign-read-url` rather than concatenating the key onto the origin.
export type UseM_Files_Upload_Params_UserSignature = {
    resource_type: "user_signature";
    file: File;
    user_id: string;
};

export type UseM_Files_Upload_Params =
    | UseM_Files_Upload_Params_ContractTemplatePdf
    | UseM_Files_Upload_Params_UserAvatar
    | UseM_Files_Upload_Params_UserSignature;

export type UseM_Files_Upload_Result = {
    /**
     * Always present since CG-037. Every object in R2 now has exactly one row in
     * `public.files` describing it, and callers store THIS rather than the raw key
     * — see the header comment on the mutation below.
     */
    file_id: string;
    r2_key: string;
    thumbnail_r2_key: string | null;
};

type UploadStartResponse = {
    uploadUrl: string;
    r2Key: string;
    expiresAt: string;
};

const THUMBNAIL_CONTENT_TYPE = "image/webp";

// Builds the upload-start body for the given params. Branches per resource_type so
// the same hook can target either scope without leaking the union into callsites.
const buildUploadStartBody = (
    params: UseM_Files_Upload_Params,
    file_name: string,
    content_type: string,
    size: number
) => {
    if (params.resource_type === "user_avatar" || params.resource_type === "user_signature") {
        return {
            resource_type: params.resource_type,
            user_id: params.user_id,
            file_name,
            content_type,
            size,
        };
    }
    return {
        resource_type: "contract_template_pdf" as const,
        contract_template_id: params.contract_template_id,
        file_name,
        content_type,
        size,
    };
};

export const useM_Files_Upload = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const user = useStore_Auth_User();

    const mutation = useMutation({
        mutationFn: async (params: UseM_Files_Upload_Params): Promise<UseM_Files_Upload_Result> => {
            if (!user) {
                throw new Error("Not authenticated");
            }
            const { file } = params;
            if (file.size > MAX_UPLOAD_SIZE_BYTES) {
                throw new Error(`File exceeds ${MAX_UPLOAD_SIZE_MB}MB limit`);
            }

            const contentType = file.type || "application/octet-stream";

            // Step 1: Presign
            const sb_FunctionsFilesR2UploadStart_Invoke = await supabase.functions.invoke(
                "files_r2_upload-start",
                {
                    body: buildUploadStartBody(params, file.name, contentType, file.size),
                }
            );

            if (sb_FunctionsFilesR2UploadStart_Invoke.error) {
                let serverMessage = "Failed to start upload";
                try {
                    const ctx = (
                        sb_FunctionsFilesR2UploadStart_Invoke.error as {
                            context?: { json?: () => Promise<{ error?: string }> };
                        }
                    ).context;
                    const body = await ctx?.json?.();
                    if (body?.error) serverMessage = body.error;
                } catch {
                    /* fall back to generic message */
                }
                throw new Error(serverMessage);
            }

            const { uploadUrl, r2Key } =
                sb_FunctionsFilesR2UploadStart_Invoke.data as UploadStartResponse;

            // Step 2: PUT to R2
            const r2PutResponse = await fetch(uploadUrl, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": contentType },
            });
            if (!r2PutResponse.ok) {
                throw new Error(`R2 upload failed: HTTP ${r2PutResponse.status}`);
            }

            // Step 3: Scope the row.
            //
            // CG-037. This branch used to be an early return: avatars and
            // signatures got no `files` row at all, justified by "`organization_id`
            // is NOT NULL, and a person-scoped asset has no honest value for it".
            // That premise was simply false. The column has always been nullable,
            // and AHR-803 shipped `files` with SIX policies explicitly branching on
            // `organization_id IS NULL` for exactly this case — user-scope rows
            // readable by any authenticated user, writable by `uploaded_by`.
            //
            // So every object gets a row, and `files` becomes what its name claims:
            // the one place that knows what is in the bucket. Other tables carry a
            // `*_file_id` FK instead of a duplicated key string.
            //
            //   orgs/{org_id}/…  → organization_id = that org   (org-scope policies)
            //   users/{user_id}/… → organization_id = null       (user-scope policies)
            const segments = r2Key.split("/");
            const isOrgScoped = segments[0] === "orgs";
            if ((!isOrgScoped && segments[0] !== "users") || !segments[1]) {
                throw new Error("Unexpected r2_key shape");
            }
            // Person-scoped assets genuinely have no organization — the owner may
            // be in several, or on the profile screen, in none. `null` is the
            // honest value the old comment said did not exist.
            const organization_id = isOrgScoped ? segments[1] : null;

            // Step 4: Insert files row
            const sb_FromFiles_Insert = await supabase
                .from("files")
                .insert({
                    r2_key: r2Key,
                    name: file.name,
                    content_type: contentType,
                    size: file.size,
                    uploaded_by: user.id,
                    organization_id,
                })
                .select("id")
                .single();

            if (sb_FromFiles_Insert.error || !sb_FromFiles_Insert.data) {
                throw new Error(
                    `Failed to save file metadata: ${sb_FromFiles_Insert.error?.message ?? "unknown error"}`
                );
            }

            const fileId = sb_FromFiles_Insert.data.id;

            // Step 5: Best-effort thumbnail generation. A failure here never fails
            // the upload — the card just renders with a generic file icon.
            //
            // `generateThumbnail` decides what is eligible. Signatures are excluded
            // there rather than here, because the reason is about the resource and
            // not about this step's ordering.
            const thumbnail_r2_key = await generateThumbnail({
                file,
                fileId,
                params,
            });

            return {
                file_id: fileId,
                r2_key: r2Key,
                thumbnail_r2_key,
            };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.files.all() });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Upload failed");
        },
    });

    return { mutation };
};

/**
 * Best-effort thumbnail generation — never throws. Returns the thumbnail R2 key
 * on success, or null on any failure. Currently only images produce thumbnails;
 * non-image types return null and consumers show a file-type icon fallback.
 * The thumbnail upload mirrors the parent's resource_type so it lands in the
 * same scope as the original — and, since CG-036, in a `thumbnails/` folder
 * directly beneath the original's own directory.
 */
const generateThumbnail = async ({
    file,
    fileId,
    params,
}: {
    file: File;
    fileId: string;
    params: UseM_Files_Upload_Params;
}): Promise<string | null> => {
    try {
        // A signature PNG is already smaller than the webp would be, and the edge
        // function rejects `is_thumbnail` for this resource type outright — so
        // asking would be a guaranteed round trip to a 400.
        if (params.resource_type === "user_signature") return null;

        if (file.type.startsWith("image/")) {
            return await generateImageThumbnail({ file, fileId, params });
        }
        return null;
    } catch (err) {
        console.warn("thumbnail generation failed (non-fatal):", err);
        return null;
    }
};

const generateImageThumbnail = async ({
    file,
    fileId,
    params,
}: {
    file: File;
    fileId: string;
    params: UseM_Files_Upload_Params;
}): Promise<string | null> => {
    const thumbBlob = await Utils_Files_ImageThumbnail(file);
    if (!thumbBlob) return null;

    // Presign a separate R2 upload for the thumbnail. `is_thumbnail` (CG-036) is a
    // placement hint, not a resource type: the body still carries the PARENT's
    // resource_type and ids, so the edge function authorizes it exactly as it
    // authorized the original and then appends a `thumbnails/` segment. A
    // thumbnail can therefore never be presigned somewhere its parent could not.
    const sb_FunctionsFilesR2UploadStart_Invoke = await supabase.functions.invoke(
        "files_r2_upload-start",
        {
            body: {
                ...buildUploadStartBody(
                    params,
                    `thumb-${file.name}.webp`,
                    THUMBNAIL_CONTENT_TYPE,
                    thumbBlob.size
                ),
                is_thumbnail: true,
            },
        }
    );
    if (sb_FunctionsFilesR2UploadStart_Invoke.error) return null;
    const { uploadUrl: thumbUploadUrl, r2Key: thumbR2Key } =
        sb_FunctionsFilesR2UploadStart_Invoke.data as UploadStartResponse;

    const thumbPut = await fetch(thumbUploadUrl, {
        method: "PUT",
        body: thumbBlob,
        headers: { "Content-Type": THUMBNAIL_CONTENT_TYPE },
    });
    if (!thumbPut.ok) return null;

    const sb_FromFiles_Update = await supabase
        .from("files")
        .update({ thumbnail_r2_key: thumbR2Key })
        .eq("id", fileId);
    if (sb_FromFiles_Update.error) return null;

    return thumbR2Key;
};
