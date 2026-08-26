import { createFileRoute } from "@tanstack/react-router";
import { Page_Envelopes } from "@/pages/Page_Envelopes/Page_Envelopes";
import {
    utils_Envelope_IsStatusFilter,
    type Envelope_StatusFilter,
} from "@/components/envelopes/const_EnvelopeStatusOptions";
import { useProvider_Organization } from "@/providers/organization/Provider_Organization";

// The personal mirror of `$organizationId/envelopes`. Same page, same search
// contract — an unrecognised `status` falls back to `all` rather than throwing,
// because a stale bookmark should show the list and not an error page.
export const Route = createFileRoute("/_protected/me/documents/")({
    validateSearch: (search: Record<string, unknown>): { status: Envelope_StatusFilter } => ({
        status: utils_Envelope_IsStatusFilter(search.status) ? search.status : "all",
    }),
    component: RouteComponent,
});

// The organization id comes from the PROVIDER rather than from the route params,
// because the personal workspace is never named in a URL — that is the whole
// point of CG-048's PHASE 3, which drops it from `get_my_member_organizations`
// and so from the `$organizationId` guard.
function RouteComponent() {
    const pOrganization = useProvider_Organization();
    const { status } = Route.useSearch();
    return (
        <Page_Envelopes
            organizationId={pOrganization.state.organizationId}
            scope="personal"
            status={status}
        />
    );
}
