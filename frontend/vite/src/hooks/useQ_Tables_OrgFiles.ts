import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchOrgFiles = async (organizationId: string) => {
    const sb_FromFiles_Select = await supabase
        .from("files")
        .select("id, name, content_type, size, organization_id, r2_key, thumbnail_r2_key, folder_id")
        .eq("organization_id", organizationId);
    if (sb_FromFiles_Select.error) throw sb_FromFiles_Select.error;
    return sb_FromFiles_Select.data;
};

export type Tables_OrgFiles_QueryData = Awaited<ReturnType<typeof fetchOrgFiles>>;
export type OrgFileRecord = Tables_OrgFiles_QueryData[number];

export const useQ_Tables_OrgFiles = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.files.list(), { organizationId }],
        queryFn: () => fetchOrgFiles(organizationId),
    });

    const files = useMemo(() => query.data || [], [query.data]);
    const filesMap = useMemo(
        () =>
            files.reduce(
                (acc, f) => {
                    acc[f.id] = f;
                    return acc;
                },
                {} as Record<string, OrgFileRecord>,
            ),
        [files],
    );

    const folderFilesMap = useMemo(
        () =>
            files.reduce(
                (acc, f) => {
                    if (!f.folder_id) return acc;
                    const key = f.folder_id;
                    if (!acc[key]) acc[key] = [];
                    acc[key]!.push(f);
                    return acc;
                },
                {} as Record<string, OrgFileRecord[]>,
            ),
        [files],
    );

    return { query, files, filesMap, folderFilesMap };
};
