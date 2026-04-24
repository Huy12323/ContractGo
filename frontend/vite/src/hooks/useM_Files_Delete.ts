import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Files_Delete_Params = {
    file_id: string;
};

export const useM_Files_Delete = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({ file_id }: UseM_Files_Delete_Params): Promise<void> => {
            const sb_FunctionsFilesR2Delete_Invoke = await supabase.functions.invoke(
                "files_r2_delete",
                { body: { file_id } },
            );
            if (sb_FunctionsFilesR2Delete_Invoke.error) {
                let serverMessage = "Failed to delete file";
                try {
                    const ctx = (
                        sb_FunctionsFilesR2Delete_Invoke.error as {
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
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.files.all() });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to delete file");
        },
    });

    return { mutation };
};
