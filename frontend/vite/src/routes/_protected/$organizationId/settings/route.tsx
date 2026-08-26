import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { Alert, Skeleton, Space, Tabs, Typography, theme } from "antd";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";

/**
 * Organization settings — the integrations surface (v1.4.0 Phase F).
 *
 * ═══ WHY THIS EXISTS AT ALL ═══
 *
 * `_protected/settings` is deliberately ACCOUNT-level — "the account page
 * belongs to a person, not to an organization" — and organization settings have
 * until now lived in `App_OrgSettingsModal`. API keys and webhook endpoints are
 * org-scoped and each need a list, a create flow, a reveal-once credential and a
 * destructive action. Three modals inside a modal is not a surface, so this is a
 * route. Nothing existing moved.
 *
 * ═══ THE TABS ARE ROUTES, NOT `Tabs` STATE ═══
 *
 * The opposite call from `Page_Settings`, and for a stated reason: `docs/api.md`
 * will link to "create an API key" and a support answer will link to "your
 * webhook deliveries". A tab that lives in component state cannot be linked to,
 * cannot be bookmarked, and loses its place on a refresh in the middle of
 * debugging an integration — which is exactly when someone refreshes.
 *
 * `Tabs` here is therefore chrome over `<Link>`s, and the active tab is derived
 * from the URL rather than held in state. `bible-tanstack-router` forbids
 * wrapping a shared frame in a component; this is a real layout route with an
 * `<Outlet/>`.
 *
 * ═══ THE ROLE CHECK IS THE THIRD GATE, NOT THE ONLY ONE ═══
 *
 * Every RPC behind these pages checks `is_admin_or_owner` as its first
 * statement, and the tables carry RLS with zero policies — so a member who
 * reaches this URL sees empty lists and every write fails. This check exists so
 * they are TOLD that rather than shown a page that appears broken.
 *
 * It renders the restricted view while loading, which is the safe direction: a
 * surface that appears late is a flicker, one that appears and is then removed
 * is a button somebody may already have pressed.
 */
export const Route = createFileRoute("/_protected/$organizationId/settings")({
    component: SettingsLayout,
});

function SettingsLayout() {
    const { token } = theme.useToken();
    const { organizationId } = Route.useParams();
    const location = useLocation();
    const qRole = useQ_Tables_MyRole({ organizationId });

    const base = `/${organizationId}/settings`;
    // Prefix-matched rather than compared exactly, so a future nested route
    // under a tab keeps that tab lit instead of clearing the whole strip.
    const activeKey = location.pathname.startsWith(`${base}/webhooks`) ? "webhooks" : "api-keys";

    const isAdmin = qRole.role === "owner" || qRole.role === "admin";

    return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
                Integrations
            </Typography.Title>

            {qRole.query.isPending ? (
                <Skeleton active paragraph={{ rows: 4 }} />
            ) : !isAdmin ? (
                <Alert
                    type="info"
                    showIcon
                    message="Only admins and owners can manage integrations"
                    description="API keys can send documents in this organization's name, and webhook endpoints receive the details of every document that moves. Ask an admin if you need one."
                />
            ) : (
                <>
                    <Tabs
                        activeKey={activeKey}
                        // No `onChange`: each label IS a link, so the browser's
                        // back button walks the tabs and a middle-click opens
                        // one in a new tab. An `onChange` navigating imperatively
                        // would take both of those away.
                        items={[
                            {
                                key: "api-keys",
                                label: (
                                    <Link
                                        to="/$organizationId/settings/api-keys"
                                        params={{ organizationId }}
                                        style={{ color: "inherit" }}
                                    >
                                        API keys
                                    </Link>
                                ),
                            },
                            {
                                key: "webhooks",
                                label: (
                                    <Link
                                        to="/$organizationId/settings/webhooks"
                                        params={{ organizationId }}
                                        style={{ color: "inherit" }}
                                    >
                                        Webhooks
                                    </Link>
                                ),
                            },
                        ]}
                        style={{ marginBottom: -token.marginXS }}
                    />
                    <Outlet />
                </>
            )}
        </Space>
    );
}
