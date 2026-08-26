// `/{org}/archive` — finished documents and their copies.
//
// A separate route from `/envelopes` rather than a filter on it: that page is the
// workflow view ("what is stuck"), this is the record ("find the signed copy").
// See `Page_Archive`'s header for why merging them makes both worse.
//
// NAMED "ARCHIVE" AND NOT "DOCUMENTS", which is worth stating because the roadmap
// called it a document browser. `App_VerticalNav` already spends the word
// Documents on the envelope list, and this version does not relabel working UI
// for a page it otherwise leaves alone. The eventual right answer is probably
// that THIS becomes Documents and the workflow list becomes something else — a
// product decision, not a side effect of a compliance version.

import { createFileRoute } from "@tanstack/react-router";
import { Page_Archive } from "@/pages/Page_Archive/Page_Archive";

export const Route = createFileRoute("/_protected/$organizationId/archive/")({
    component: Page_Archive,
});
