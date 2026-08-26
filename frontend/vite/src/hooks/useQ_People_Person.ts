import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type People_Person = {
    user_id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
    phone: string | null;
    role: "owner" | "admin" | "member";
    joined_at: string;
    /**
     * CG-027. Both read true for an owner or admin, who hold every permission by
     * tier and have no `members` row to carry a flag on — the drawer renders
     * their switches on and disabled rather than showing them as denied.
     */
    can_manage_templates: boolean;
    can_send_documents: boolean;
};

const fetchPerson = async (organizationId: string, userId: string) => {
    const sb_RpcGetOrganizationPerson = await supabase.rpc("get_organization_person", {
        org_id: organizationId,
        target_user_id: userId,
    });
    if (sb_RpcGetOrganizationPerson.error) throw sb_RpcGetOrganizationPerson.error;
    // NULL is the RPC's answer for "not in this organization" — a person who was
    // removed while the drawer was open, not an error.
    return (sb_RpcGetOrganizationPerson.data as unknown as People_Person | null) ?? null;
};

/**
 * The one person the detail drawer is showing.
 *
 * The People table already has a name and an email for everybody, so this is
 * not what fills the header — it is the fields the table has no column for
 * (joined date, phone) plus a server-resolved role, read fresh so the drawer
 * cannot show a tier the table merge got wrong.
 */
export const useQ_People_Person = ({
    organizationId,
    userId,
    enabled = true,
}: {
    organizationId: string;
    userId: string | null;
    enabled?: boolean;
}) => {
    const query = useQuery({
        enabled: enabled && !!organizationId && !!userId,
        queryKey: [...QueryKeys.organizations.record(organizationId), "person", userId],
        queryFn: () => fetchPerson(organizationId, userId as string),
    });

    return { query, person: query.data ?? null };
};
