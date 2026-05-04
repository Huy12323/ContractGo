import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { useStore_Auth_User } from "@/stores/Store_Auth";
import {
    MAX_UPLOAD_SIZE_BYTES,
    MAX_UPLOAD_SIZE_MB,
} from "@/utils/const_FileUpload";
import { Utils_Files_ImageThumbnail } from "@/utils/Utils_Files_ImageThumbnail";
import { QueryKeys } from "@/utils/query/queryKeys";

// Discriminated by resource_type so one hook covers both employee-column and
// invitation-column uploads. Add future scopes (contract, etc.) here as needed.
export type UseM_Files_Upload_Params_EmployeeCol = {
    resource_type: "employee_col";
    file: File;
    employee_id: string;
    column_id: string;
};

export type UseM_Files_Upload_Params_InvitationCol = {
    resource_type: "invitation_col";
    file: File;
    invitation_id: string;
    column_id: string;
};

export type UseM_Files_Upload_Params_ContractTemplatePdf = {
    resource_type: "contract_template_pdf";
    file: File;
    contract_template_id: string;
};

export type UseM_Files_Upload_Params =
    | UseM_Files_Upload_Params_EmployeeCol
    | UseM_Files_Upload_Params_InvitationCol
    | UseM_Files_Upload_Params_ContractTemplatePdf;

export type UseM_Files_Upload_Result = {
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
    size: number,
) => {
    if (params.resource_type === "employee_col") {
        return {
            resource_type: "employee_col" as const,
            employee_id: params.employee_id,
            column_id: params.column_id,
            file_name,
            content_type,
            size,
        };
    }
    if (params.resource_type === "invitation_col") {
        return {
            resource_type: "invitation_col" as const,
            invitation_id: params.invitation_id,
            column_id: params.column_id,
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
        mutationFn: async (
            params: UseM_Files_Upload_Params,
        ): Promise<UseM_Files_Upload_Result> => {
            if (!user) {
                throw new Error("Not authenticated");
            }
            const { file } = params;
            if (file.size > MAX_UPLOAD_SIZE_BYTES) {
                throw new Error(`File exceeds ${MAX_UPLOAD_SIZE_MB}MB limit`);
            }

            const contentType = file.type || "application/octet-stream";

            // Step 1: Presign
            const sb_FunctionsFilesR2UploadStart_Invoke =
                await supabase.functions.invoke("files_r2_upload-start", {
                    body: buildUploadStartBody(
                        params,
                        file.name,
                        contentType,
                        file.size,
                    ),
                });

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

            // Step 3: Derive organization_id from R2 key (orgs/{org_id}/...)
            const segments = r2Key.split("/");
            if (segments[0] !== "orgs" || !segments[1]) {
                throw new Error("Unexpected r2_key shape");
            }
            const organization_id = segments[1];

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
                    `Failed to save file metadata: ${sb_FromFiles_Insert.error?.message ?? "unknown error"}`,
                );
            }

            const fileId = sb_FromFiles_Insert.data.id;

            // Step 5: Best-effort thumbnail generation. A failure here never fails
            // the upload — the card just renders with a generic file icon.
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
 * same scope (employee or invitation) as the original.
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

    // Presign a separate R2 upload for the thumbnail. The key doesn't need to
    // relate to the original's path — the thumbnail_r2_key column stores whatever
    // key we land on.
    const sb_FunctionsFilesR2UploadStart_Invoke = await supabase.functions.invoke(
        "files_r2_upload-start",
        {
            body: buildUploadStartBody(
                params,
                `thumb-${file.name}.webp`,
                THUMBNAIL_CONTENT_TYPE,
                thumbBlob.size,
            ),
        },
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
