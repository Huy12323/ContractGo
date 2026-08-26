import { createFileRoute } from "@tanstack/react-router";
import { Page_Envelopes } from "@/pages/Page_Envelopes/Page_Envelopes";
import {
    utils_Envelope_IsStatusFilter,
    type Envelope_StatusFilter,
} from "@/components/envelopes/const_EnvelopeStatusOptions";

// `status` is a required search param with a default rather than an optional
// one: the list ALWAYS has a tab selected, so a URL without it is incomplete
// rather than meaningful, and defaulting here means the component never has to
// handle "no tab". An unrecognised value falls back to `all` instead of
// throwing — a stale bookmark should show the list, not an error page.
export const Route = createFileRoute("/_protected/$organizationId/envelopes/")({
    validateSearch: (search: Record<string, unknown>): { status: Envelope_StatusFilter } => ({
        status: utils_Envelope_IsStatusFilter(search.status) ? search.status : "all",
    }),
    component: RouteComponent,
});

// A wrapper rather than `component: Page_Envelopes`, as of CG-048: the page is
// now shared with `/me/documents`, which has no `organizationId` in its path, so
// it takes its identity as props. See the same note in `$envelopeId.edit.tsx`.
function RouteComponent() {
    const { organizationId } = Route.useParams();
    const { status } = Route.useSearch();
    return <Page_Envelopes organizationId={organizationId} status={status} scope="org" />;
}
