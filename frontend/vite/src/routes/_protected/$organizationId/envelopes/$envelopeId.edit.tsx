import { createFileRoute } from "@tanstack/react-router";
import { Page_EnvelopeComposer } from "@/pages/Page_EnvelopeComposer/Page_EnvelopeComposer";

// Resuming a draft (Phase G).
//
// The SAME component as `envelopes/new`, not a second composer. A draft is the
// composition it came from, and a separate editor would be a second place for
// every validation rule and every step to drift — the composer simply reads the
// envelope id from the route and loads its state instead of starting empty.
//
// No search params: `new` takes a `templateId` to pre-select the picker for a
// sender arriving from a template card, and a draft has already made that choice.
// Accepting it here would let a URL contradict the saved row.
export const Route = createFileRoute("/_protected/$organizationId/envelopes/$envelopeId/edit")({
    component: RouteComponent,
});

// A three-line wrapper rather than `useParams({ strict: false })` inside the
// composer. Two routes render one component, and reading the params loosely there
// would make `organizationId` optional in a page that cannot function without it —
// trading a compile-time guarantee for a runtime `!`.
function RouteComponent() {
    const { organizationId, envelopeId } = Route.useParams();
    return (
        <Page_EnvelopeComposer
            organizationId={organizationId}
            envelopeId={envelopeId}
            scope="org"
        />
    );
}
