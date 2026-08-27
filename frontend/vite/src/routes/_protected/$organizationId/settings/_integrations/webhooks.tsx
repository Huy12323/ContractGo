import { createFileRoute } from "@tanstack/react-router";
import { Page_OrgSettingsWebhooks } from "@/pages/Page_OrgSettingsWebhooks/Page_OrgSettingsWebhooks";

// See `api-keys.tsx` — the parent layout is the gate; this is only the leaf.
export const Route = createFileRoute("/_protected/$organizationId/settings/_integrations/webhooks")(
    {
        component: Page_OrgSettingsWebhooks,
    }
);
