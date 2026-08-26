import { createFileRoute } from "@tanstack/react-router";
import { Page_EnvelopeComposer } from "@/pages/Page_EnvelopeComposer/Page_EnvelopeComposer";
import { useProvider_Organization } from "@/providers/organization/Provider_Organization";

// The personal mirror of `$organizationId/envelopes/new`.
//
// NO `templateId` SEARCH PARAM, unlike the organization route. There it exists to
// pre-select the picker for a sender who arrived from a template card; the
// personal workspace has no library and no such card, so accepting the param
// would let a URL ask for a document source the composer will not offer.
export const Route = createFileRoute("/_protected/me/documents/new")({
    component: RouteComponent,
});

function RouteComponent() {
    const pOrganization = useProvider_Organization();
    return (
        <Page_EnvelopeComposer
            organizationId={pOrganization.state.organizationId}
            scope="personal"
        />
    );
}
