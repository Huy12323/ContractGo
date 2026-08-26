import { createFileRoute } from "@tanstack/react-router";
import { Page_EnvelopeComposer } from "@/pages/Page_EnvelopeComposer/Page_EnvelopeComposer";
import { useProvider_Organization } from "@/providers/organization/Provider_Organization";

// Resuming a personal draft. The SAME composer as `me/documents/new`, for the
// same reason the organization pair shares one: a draft is the composition it
// came from, and a second editor would be a second place for every validation
// rule to drift.
export const Route = createFileRoute("/_protected/me/documents/$envelopeId/edit")({
    component: RouteComponent,
});

function RouteComponent() {
    const pOrganization = useProvider_Organization();
    const { envelopeId } = Route.useParams();
    return (
        <Page_EnvelopeComposer
            organizationId={pOrganization.state.organizationId}
            envelopeId={envelopeId}
            scope="personal"
        />
    );
}
