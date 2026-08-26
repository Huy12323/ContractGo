import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { AVATAR_FILE_SELECT } from "@/utils/Utils_Avatar_Src";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchAdmins = async (organizationId: string) => {
    const sb_FromAdmins_Select = await supabase
        .from("admins")
        .select(
            `id, user_id, created_at, profiles(id, full_name, email, avatar_url, ${AVATAR_FILE_SELECT})`
        )
        .eq("organization_id", organizationId);
    if (sb_FromAdmins_Select.error) throw sb_FromAdmins_Select.error;
    return sb_FromAdmins_Select.data;
};

export type Tables_Admins_QueryData = Awaited<ReturnType<typeof fetchAdmins>>;

export const useQ_Tables_Admins = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        // Keyed under `admins` rather than under the organization so the
        // realtime predicate can find it — it looks up `table_name` in the key
        // and reads the next segment, so the "list" marker must be adjacent.
        queryKey: [...QueryKeys.admins.list(), organizationId],
        queryFn: () => fetchAdmins(organizationId),
    });

    const admins = useMemo(() => query.data || [], [query.data]);

    return { query, admins };
};
