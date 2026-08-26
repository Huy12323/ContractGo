import { createFileRoute } from "@tanstack/react-router";
import { Page_EnvelopeDetail } from "@/pages/Page_EnvelopeDetail/Page_EnvelopeDetail";
import { useProvider_Organization } from "@/providers/organization/Provider_Organization";

// `$envelopeId.index.tsx`, not `$envelopeId.tsx`, for the same reason the
// organization route carries the `.index` form: there is a SIBLING at
// `$envelopeId/edit`, and in flat routing a bare `$envelopeId.tsx` with children
// becomes their LAYOUT. This component renders no `<Outlet/>`, so `/edit` would
// silently render the detail page instead of the composer.
export const Route = createFileRoute("/_protected/me/documents/$envelopeId/")({
    component: RouteComponent,
});

function RouteComponent() {
    const pOrganization = useProvider_Organization();
    const { envelopeId } = Route.useParams();
    return (
        <Page_EnvelopeDetail
            organizationId={pOrganization.state.organizationId}
            envelopeId={envelopeId}
            scope="personal"
        />
    );
}
