import type { ReactNode } from "react";
import { useQ_Tables_MyOrganization } from "@/hooks/useQ_Tables_MyOrganization";
import type { OrgRole } from "@/hooks/useQ_Tables_MyOrganization";

interface RoleGuardProps {
    roles: OrgRole[];
    children: ReactNode;
    fallback?: ReactNode;
}

export const App_RoleGuard = ({ roles, children, fallback = null }: RoleGuardProps) => {
    const qMyOrganization = useQ_Tables_MyOrganization();

    if (qMyOrganization.loading) return null;
    if (!qMyOrganization.role || !roles.includes(qMyOrganization.role)) return <>{fallback}</>;

    return <>{children}</>;
};
