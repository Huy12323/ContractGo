import { createFileRoute } from "@tanstack/react-router";
import { Page_EnvelopeDetail } from "@/pages/Page_EnvelopeDetail/Page_EnvelopeDetail";

// Still a LEAF, not the layout-plus-tabs pair the plan sketched — the two tabs
// (Overview and Audit trail) share every query the page already loads, so
// splitting them into routes would add a layout route and a second data-loading
// boundary to move state that ANTD `Tabs` holds for free.
//
// The document viewer has now landed, and it did NOT change that answer. It sits
// inside the Overview tab beside the document's details rather than becoming a
// tab of its own, so there is still no view here that a reader would want to link
// someone else directly to — which is the only thing that would justify the extra
// route. What would change the answer is a deep link INTO the document (a page
// number, a highlighted field): that needs URL state, and that is the point at
// which this becomes a layout route.
//
// It is `$envelopeId.index.tsx` rather than `$envelopeId.tsx` because Phase G
// added a SIBLING at `$envelopeId/edit`. In flat routing a bare `$envelopeId.tsx`
// with children becomes a LAYOUT for them, and this component renders no
// `<Outlet/>` — so `/edit` would have silently rendered the detail page instead of
// the composer. The `.index` form keeps `/envelopes/$envelopeId` resolving here
// and lets the segment hold children.
export const Route = createFileRoute("/_protected/$organizationId/envelopes/$envelopeId/")({
    component: RouteComponent,
});

// A wrapper rather than `component: Page_EnvelopeDetail`, as of CG-048: the page
// is shared with `/me/documents/$envelopeId`, which names no organization in its
// path, so both routes hand it its identity as props.
function RouteComponent() {
    const { organizationId, envelopeId } = Route.useParams();
    return (
        <Page_EnvelopeDetail organizationId={organizationId} envelopeId={envelopeId} scope="org" />
    );
}
