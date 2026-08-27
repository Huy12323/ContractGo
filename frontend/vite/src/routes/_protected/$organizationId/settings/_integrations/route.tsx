import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { Select, Space, Tabs, theme } from "antd";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import {
    const_OrgSettings_IntegrationTabs,
    resolveOrgSettingsTab,
} from "@/components/organization/const_OrgSettings_Tabs";

/**
 * The Integrations sub-strip — API keys and Webhooks.
 *
 * ═══ WHY THIS LAYOUT IS PATHLESS ═══
 *
 * The leading underscore means it contributes NO URL SEGMENT. `/settings/api-keys`
 * and `/settings/webhooks` are byte-for-byte the URLs they were before CG-050
 * promoted this surface from two tabs to seven, which is not cosmetic: the parent
 * route's docblock makes an explicit promise that `docs/api.md` links to "create
 * an API key" and support answers link to "your webhook deliveries". A
 * `/settings/integrations/api-keys` would have broken every one of those links
 * for a grouping that is purely visual.
 *
 * The cost is that the generated route ids move, so the `useParams({ from })`
 * strings in the two pages had to follow. That is a type error at build time,
 * which is the right way to pay it.
 *
 * ═══ NO ROLE CHECK HERE ═══
 *
 * The grandparent `settings` layout establishes admin-or-owner and renders an
 * explanation instead of an `<Outlet/>` for anyone else, so nothing under here
 * mounts for a member. Repeating the check would be a second place to get it
 * wrong. Both tabs are admin-writable — unlike General, Branding and Documents,
 * which are owner-write — so there is no owner gate at this level either.
 */
export const Route = createFileRoute("/_protected/$organizationId/settings/_integrations")({
    component: IntegrationsLayout,
});

function IntegrationsLayout() {
    const { token } = theme.useToken();
    const { organizationId } = Route.useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const { isMobile } = useApp_Breakpoint();

    const activeKey = resolveOrgSettingsTab(
        location.pathname,
        organizationId,
        const_OrgSettings_IntegrationTabs,
        "api-keys"
    );

    return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {isMobile ? (
                <Select
                    style={{ width: "100%" }}
                    value={activeKey}
                    onChange={(key) => {
                        const tab = const_OrgSettings_IntegrationTabs.find((t) => t.key === key);
                        if (tab) navigate({ to: tab.to, params: { organizationId } });
                    }}
                    options={const_OrgSettings_IntegrationTabs.map((tab) => ({
                        value: tab.key,
                        label: tab.label,
                    }))}
                />
            ) : (
                <Tabs
                    size="small"
                    activeKey={activeKey}
                    // No `onChange` — see the parent layout. The labels are links
                    // so the back button walks them and middle-click works.
                    items={const_OrgSettings_IntegrationTabs.map((tab) => ({
                        key: tab.key,
                        label: (
                            <Link
                                to={tab.to}
                                params={{ organizationId }}
                                style={{ color: "inherit" }}
                            >
                                {tab.label}
                            </Link>
                        ),
                    }))}
                    style={{ marginBottom: -token.marginXS }}
                />
            )}
            <Outlet />
        </Space>
    );
}
