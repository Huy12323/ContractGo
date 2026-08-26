import { useQ_Tables_MyOrganizations } from "@/hooks/useQ_Tables_MyOrganizations";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";
import { useProvider_Organization } from "@/providers/organization/Provider_Organization";

// `member`, not `employee`: CG-003 renamed the table and `get_organization_role`
// has returned 'member' ever since. The stale value made every member-tier
// App_RoleGuard silently never match.
export type OrgRole = "owner" | "admin" | "member";

export const useQ_Tables_MyOrganization = () => {
    const pOrganization = useProvider_Organization();
    const organizationId = pOrganization.state.organizationId;

    const qOrganizations = useQ_Tables_MyOrganizations();
    const organization = qOrganizations.organizations.find((o) => o.id === organizationId) ?? null;

    const qRole = useQ_Tables_MyRole({ organizationId });
    const role = (qRole.role ?? null) as OrgRole | null;

    return {
        organization,
        organizationId,
        role,
        hasOrg: !!organization,
        loading: qOrganizations.query.isLoading || qRole.query.isLoading,
    };
};
