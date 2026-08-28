// The public landing page — ContractGo's front door (CG-052).
//
// Until this shipped the root URL was the authenticated dashboard, so every
// unauthenticated visitor hit a login wall and a link pasted into a chat
// unfurled as nothing. The dashboard moved to `/home` and this page owns `/`.
//
// IT OWNS THE ANCHOR REFS, and that is the only state on the page. The marketing
// layout scrolls a DIV rather than the document (see `_marketing/route.tsx`), so
// `href="#id"` does not reach a section — `scrollIntoView` on a ref does. Those
// refs have to be held by the component that renders both the nav and the
// sections, which is this one.
//
// Everything else is composition. Copy lives in `const_LandingContent.ts`,
// spacing lives in `PageLanding_Section`, and no section holds state of its own.

import { useRef } from "react";
import {
    App_MarketingNav,
    type MarketingNav_Section,
} from "@/components/marketing/App_MarketingNav";
import { App_MarketingFooter } from "@/components/marketing/App_MarketingFooter";
import { PageLanding_Hero } from "./PageLanding_Hero";
import { PageLanding_HowItWorks } from "./PageLanding_HowItWorks";
import { PageLanding_Evidence } from "./PageLanding_Evidence";
import { PageLanding_UseCases } from "./PageLanding_UseCases";
import { PageLanding_Developers } from "./PageLanding_Developers";
import { PageLanding_FinalCta } from "./PageLanding_FinalCta";

export const Page_Landing = () => {
    const howItWorksRef = useRef<HTMLElement>(null);
    const evidenceRef = useRef<HTMLElement>(null);
    const useCasesRef = useRef<HTMLElement>(null);
    const developersRef = useRef<HTMLElement>(null);

    // `block: "start"` plus each section's `scrollMarginTop` is what keeps the
    // sticky nav from landing on top of the heading it just scrolled to.
    const scrollTo = (ref: React.RefObject<HTMLElement | null>) => () =>
        ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    const sections: MarketingNav_Section[] = [
        { id: "how-it-works", label: "How it works", onSelect: scrollTo(howItWorksRef) },
        { id: "evidence", label: "Evidence", onSelect: scrollTo(evidenceRef) },
        { id: "use-cases", label: "Who it's for", onSelect: scrollTo(useCasesRef) },
        { id: "developers", label: "Developers", onSelect: scrollTo(developersRef) },
    ];

    return (
        <>
            <App_MarketingNav sections={sections} />
            <PageLanding_Hero onSeeHowItWorks={scrollTo(howItWorksRef)} />
            <PageLanding_HowItWorks ref={howItWorksRef} />
            <PageLanding_Evidence ref={evidenceRef} />
            <PageLanding_UseCases ref={useCasesRef} />
            <PageLanding_Developers ref={developersRef} />
            <PageLanding_FinalCta />
            <App_MarketingFooter />
        </>
    );
};
