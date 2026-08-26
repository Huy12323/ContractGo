import { createFileRoute } from "@tanstack/react-router";
import { Page_EnvelopeComposer } from "@/pages/Page_EnvelopeComposer/Page_EnvelopeComposer";

// A convenience, not a requirement: the composer can pick a template itself, and
// this only pre-selects when the sender arrived from a specific template's card.
// An unknown value simply leaves the picker empty rather than erroring.
//
// It used to travel with an `entityId`, because the composer's template list was
// entity-scoped and the id alone would select nothing whenever the default entity
// was not the one it came from. CG-030 made that list organization-scoped, and the
// organization is already in the path.
type EnvelopeComposerSearch = {
    templateId?: string;
};

// Annotated rather than inferred: an inferred `{ templateId: string | undefined }`
// is a REQUIRED key that may hold undefined, which makes `search` mandatory on
// every `<Link to="/$organizationId/envelopes/new">` in the app. The optional
// properties are what let the nav link to the bare composer.
export const Route = createFileRoute("/_protected/$organizationId/envelopes/new")({
    validateSearch: (search: Record<string, unknown>): EnvelopeComposerSearch => ({
        templateId: typeof search.templateId === "string" ? search.templateId : undefined,
    }),
    component: RouteComponent,
});

// See the note in `$envelopeId.edit.tsx`: the composer is shared by two routes and
// takes its identity as props, so neither route has to read params loosely.
function RouteComponent() {
    const { organizationId } = Route.useParams();
    const { templateId } = Route.useSearch();
    return (
        <Page_EnvelopeComposer
            organizationId={organizationId}
            templateId={templateId}
            scope="org"
        />
    );
}
