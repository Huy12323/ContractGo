import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

type ReadUrlResponse = {
    url: string;
    expiresAt: string;
};

// Discriminated shape — one hook covers employee-column + invitation-column scopes.
// resource_type drives which scope id is required (employee_id vs invitation_id) and
// what the edge function expects in the body.
export type UseQ_Files_ReadUrl_Params_EmployeeCol = {
    resource_type: "employee_col";
    file_id: string | null | undefined;
    employee_id: string | null | undefined;
    column_id: string | null | undefined;
    use_thumbnail?: boolean;
};

export type UseQ_Files_ReadUrl_Params_InvitationCol = {
    resource_type: "invitation_col";
    file_id: string | null | undefined;
    invitation_id: string | null | undefined;
    column_id: string | null | undefined;
    use_thumbnail?: boolean;
};

export type UseQ_Files_ReadUrl_Params =
    | UseQ_Files_ReadUrl_Params_EmployeeCol
    | UseQ_Files_ReadUrl_Params_InvitationCol;

const fetchReadUrl = async (
    body: Record<string, unknown>,
): Promise<ReadUrlResponse> => {
    const sb_FunctionsFilesR2SignReadUrl_Invoke = await supabase.functions.invoke(
        "files_r2_sign-read-url",
        { body },
    );
    if (sb_FunctionsFilesR2SignReadUrl_Invoke.error) {
        let serverMessage = "Failed to get read URL";
        try {
            const ctx = (
                sb_FunctionsFilesR2SignReadUrl_Invoke.error as {
                    context?: { json?: () => Promise<{ error?: string }> };
                }
            ).context;
            const errBody = await ctx?.json?.();
            if (errBody?.error) serverMessage = errBody.error;
        } catch {
            /* fall back to generic message */
        }
        throw new Error(serverMessage);
    }
    return sb_FunctionsFilesR2SignReadUrl_Invoke.data as ReadUrlResponse;
};

const SIX_DAYS_MS = 6 * 24 * 3600 * 1000;

export const useQ_Files_ReadUrl = (params: UseQ_Files_ReadUrl_Params) => {
    const { resource_type, file_id, column_id, use_thumbnail } = params;
    const scopeId =
        params.resource_type === "employee_col"
            ? params.employee_id
            : params.invitation_id;

    const query = useQuery({
        enabled: !!file_id && !!scopeId && !!column_id,
        queryKey: [
            ...QueryKeys.files.record(file_id ?? ""),
            "read-url",
            resource_type,
            { scope_id: scopeId, column_id, use_thumbnail: use_thumbnail ?? false },
        ],
        queryFn: () => {
            const body: Record<string, unknown> = {
                resource_type,
                file_id: file_id as string,
                column_id: column_id as string,
                ...(use_thumbnail ? { use_thumbnail: true } : {}),
            };
            if (params.resource_type === "employee_col") {
                body.employee_id = params.employee_id;
            } else {
                body.invitation_id = params.invitation_id;
            }
            return fetchReadUrl(body);
        },
        staleTime: SIX_DAYS_MS,
    });

    return {
        query,
        url: query.data?.url,
        expiresAt: query.data?.expiresAt,
    };
};
