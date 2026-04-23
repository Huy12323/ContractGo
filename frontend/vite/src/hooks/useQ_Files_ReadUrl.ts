import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

type ReadUrlResponse = {
    url: string;
    expiresAt: string;
};

// Always `resource_type: "employee_col"` for the current consumer (employee file columns).
// If contract/avatar callers arrive later, switch params to a discriminated union.
type Params = {
    file_id: string;
    employee_id: string;
    column_id: string;
};

const fetchReadUrl = async ({ file_id, employee_id, column_id }: Params): Promise<ReadUrlResponse> => {
    const sb_FunctionsFilesR2SignReadUrl_Invoke = await supabase.functions.invoke(
        "files_r2_sign-read-url",
        {
            body: {
                resource_type: "employee_col",
                file_id,
                employee_id,
                column_id,
            },
        },
    );
    if (sb_FunctionsFilesR2SignReadUrl_Invoke.error) {
        let serverMessage = "Failed to get read URL";
        try {
            const ctx = (
                sb_FunctionsFilesR2SignReadUrl_Invoke.error as {
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
    return sb_FunctionsFilesR2SignReadUrl_Invoke.data as ReadUrlResponse;
};

const SIX_DAYS_MS = 6 * 24 * 3600 * 1000;

export const useQ_Files_ReadUrl = ({
    file_id,
    employee_id,
    column_id,
}: {
    file_id: string | null | undefined;
    employee_id: string | null | undefined;
    column_id: string | null | undefined;
}) => {
    const query = useQuery({
        enabled: !!file_id && !!employee_id && !!column_id,
        queryKey: [
            ...QueryKeys.files.record(file_id ?? ""),
            "read-url",
            { employee_id, column_id },
        ],
        queryFn: () =>
            fetchReadUrl({
                file_id: file_id as string,
                employee_id: employee_id as string,
                column_id: column_id as string,
            }),
        staleTime: SIX_DAYS_MS,
    });

    return {
        query,
        url: query.data?.url,
        expiresAt: query.data?.expiresAt,
    };
};
