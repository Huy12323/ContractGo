import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { useStore_Auth_User } from "@/stores/Store_Auth";
import {
    MAX_UPLOAD_SIZE_BYTES,
    MAX_UPLOAD_SIZE_MB,
} from "@/utils/const_FileUpload";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Files_Upload_Params = {
    file: File;
    employee_id: string;
    column_id: string;
};

export type UseM_Files_Upload_Result = {
    file_id: string;
    r2_key: string;
};

type UploadStartResponse = {
    uploadUrl: string;
    r2Key: string;
    expiresAt: string;
};

export const useM_Files_Upload = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const user = useStore_Auth_User();

    const mutation = useMutation({
        mutationFn: async ({
            file,
            employee_id,
            column_id,
        }: UseM_Files_Upload_Params): Promise<UseM_Files_Upload_Result> => {
            if (!user) {
                throw new Error("Not authenticated");
            }
            if (file.size > MAX_UPLOAD_SIZE_BYTES) {
                throw new Error(`File exceeds ${MAX_UPLOAD_SIZE_MB}MB limit`);
            }

            const contentType = file.type || "application/octet-stream";

            // Step 1: Presign
            const sb_FunctionsFilesR2UploadStart_Invoke =
                await supabase.functions.invoke("files_r2_upload-start", {
                    body: {
                        resource_type: "employee_col",
                        employee_id,
                        column_id,
                        file_name: file.name,
                        content_type: contentType,
                        size: file.size,
                    },
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

            return {
                file_id: sb_FromFiles_Insert.data.id,
                r2_key: r2Key,
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
