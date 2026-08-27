import { createFileRoute } from "@tanstack/react-router";
import { Page_Invitation } from "@/pages/Page_Invitation/Page_Invitation";

interface InvitationSearch {
    token?: string;
}

export const Route = createFileRoute("/_auth/invitation")({
    validateSearch: (search: Record<string, unknown>): InvitationSearch => ({
        token: search.token as string | undefined,
    }),
    component: Page_Invitation,
});
