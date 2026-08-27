import { Alert } from "antd";
import { useQ_Tables_OrganizationOwner } from "@/hooks/useQ_Tables_OrganizationOwner";

/**
 * "Only the owner can change this" — shown above a form that is rendered
 * DISABLED rather than hidden.
 *
 * ═══ WHY DISABLED AND NOT HIDDEN ═══
 *
 * RLS on `organizations` splits read from write: SELECT is `is_org_member`,
 * UPDATE is `get_organization_role(id) = 'owner'` in both USING and WITH CHECK.
 * So an admin may legitimately SEE every value on the General, Branding and
 * Documents tabs and simply may not change them. Hiding the fields would answer
 * a question nobody asked ("where did the organization name go?") while
 * withholding information they are entitled to.
 *
 * ═══ WHY IT NAMES THE OWNER ═══
 *
 * "Ask an owner" with no name is not actionable — in an organization of thirty
 * people it is a dead end. The owner is the one tier with no membership row (it
 * is a column on `organizations`), so it takes its own query;
 * `useQ_Tables_OrganizationOwner` already exists for the People page and is
 * cached under the same org key.
 *
 * The name degrades gracefully: full name, then email, then the generic phrasing.
 * A missing profile must not turn this into "Ask undefined".
 */
export const App_OrgOwnerOnlyAlert = ({
    organizationId,
    what,
}: {
    organizationId: string;
    /** What this tab changes, e.g. "these settings", "this organization's branding". */
    what: string;
}) => {
    const { owner } = useQ_Tables_OrganizationOwner({ organizationId });

    const profile = Array.isArray(owner?.profiles) ? owner?.profiles[0] : owner?.profiles;
    const ownerName = profile?.full_name || profile?.email || null;

    return (
        <Alert
            type="info"
            showIcon
            message={`Only the organization owner can change ${what}`}
            description={
                ownerName
                    ? `You can see the current values, but saving is limited to ${ownerName}.`
                    : "You can see the current values, but saving is limited to the organization owner."
            }
        />
    );
};
