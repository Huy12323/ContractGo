import { createFileRoute } from "@tanstack/react-router";
import { Page_SettingsWebhooks } from "@/pages/Page_SettingsWebhooks/Page_SettingsWebhooks";

// See `api-keys.tsx` — the parent layout is the gate; this is only the leaf.
export const Route = createFileRoute("/_protected/$organizationId/settings/webhooks")({
    component: Page_SettingsWebhooks,
});
