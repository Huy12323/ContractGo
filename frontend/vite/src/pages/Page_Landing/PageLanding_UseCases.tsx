// Who this is for: teams, individuals, developers.
//
// "Individuals" is a real answer here, not a softer version of "teams". The
// product creates a personal workspace on signup, so someone can send their
// first document without inventing a company — worth saying plainly, because
// every competitor's pricing page implies otherwise.

import { forwardRef } from "react";
import { PageLanding_Section } from "./PageLanding_Section";
import { PageLanding_ItemGrid } from "./PageLanding_ItemGrid";
import { const_Landing_UseCases } from "./const_LandingContent";

export const PageLanding_UseCases = forwardRef<HTMLElement>((_props, ref) => (
    <PageLanding_Section
        ref={ref}
        id="use-cases"
        tinted
        eyebrow="Who it's for"
        heading="One product, three ways in"
    >
        <PageLanding_ItemGrid items={const_Landing_UseCases} columns={3} />
    </PageLanding_Section>
));

PageLanding_UseCases.displayName = "PageLanding_UseCases";
