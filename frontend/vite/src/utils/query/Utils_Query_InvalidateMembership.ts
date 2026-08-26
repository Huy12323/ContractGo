import type { QueryClient } from "@tanstack/react-query";
import { QueryKeys } from "@/utils/query/queryKeys";

/**
 * Everything that can go stale when somebody's membership changes.
 *
 * A role change moves a row between two tables, and a removal or an ownership
 * transfer can change the CALLER's own access — so this is deliberately wider
 * than the one list the mutation wrote to. The trailing keys are the ones easy
 * to forget: `role` and `capabilities` drive every permission check on the page,
 * `owner` drives the owner row, and the org list feeds the switcher, which must
 * drop an organization the user just left.
 *
 * Shared by the three membership mutations so they cannot drift apart — the
 * failure mode is silent and looks like "the UI didn't update for one action".
 */
export const Utils_Query_InvalidateMembership = (
    queryClient: QueryClient,
    organizationId: string
) => {
    const keys = [
        [...QueryKeys.admins.list(), organizationId],
        [...QueryKeys.members.list(), organizationId],
        [...QueryKeys.invitations.list(), organizationId],
        [...QueryKeys.organizations.record(organizationId), "owner"],
        [...QueryKeys.organizations.record(organizationId), "role"],
        // CG-027. A promotion to admin grants both permissions implicitly, so a
        // role change invalidates this too — not only the permission mutation.
        [...QueryKeys.organizations.record(organizationId), "capabilities"],
        // No user id: invalidateQueries matches on prefix, so this covers every
        // open person record at once. The drawer is usually showing the person
        // who just changed, and a stale role there is the one that would be
        // acted on next.
        [...QueryKeys.organizations.record(organizationId), "person"],
        [...QueryKeys.organizations.list(), "mine"],
    ];

    for (const queryKey of keys) queryClient.invalidateQueries({ queryKey });
};
