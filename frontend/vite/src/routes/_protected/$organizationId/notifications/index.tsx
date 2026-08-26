import { createFileRoute } from "@tanstack/react-router";
import { Page_Notifications } from "@/pages/Page_Notifications/Page_Notifications";

export type Notifications_Filter = "all" | "unread";

// Required-with-a-default, matching the envelope list: the page always has a tab
// selected, so a URL without one is incomplete rather than meaningful. An
// unrecognised value falls back to `all` instead of throwing — a stale bookmark
// should show the list, not an error page.
export const Route = createFileRoute("/_protected/$organizationId/notifications/")({
    validateSearch: (search: Record<string, unknown>): { filter: Notifications_Filter } => ({
        filter: search.filter === "unread" ? "unread" : "all",
    }),
    component: Page_Notifications,
});
