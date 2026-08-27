import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { Alert, Select, Skeleton, Space, Tabs, Typography, theme } from "antd";
import { ExportOutlined } from "@ant-design/icons";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import {
    const_OrgSettings_Tabs,
    resolveOrgSettingsTab,
} from "@/components/organization/const_OrgSettings_Tabs";

/**
 * Organization settings — the whole surface (CG-050).
 *
 * ═══ WHY THIS EXISTS AT ALL ═══
 *
 * `_protected/settings` is deliberately ACCOUNT-level — "the account page
 * belongs to a person, not to an organization". Organization settings used to be
 * `App_OrgSettingsModal`, which could do exactly two things: rename the org, and
 * delete it. Everything an owner would actually need to set up their
 * organization either had nowhere to live or, in the case of
 * `ai_assistant_enabled`, shipped as a column with no control at all.
 *
 * CG-050 consolidated both surfaces HERE and deleted the modal. This route
 * already existed for API keys and webhooks; it was titled "Integrations",
 * held two tabs, and — the part that mattered — NOTHING IN THE APP LINKED TO IT.
 * It was reachable only by typing the URL. It is now in the nav for everyone.
 *
 * ═══ THE TABS ARE ROUTES, NOT `Tabs` STATE ═══
 *
 * The opposite call from `Page_Settings`, and for a stated reason: `docs/api.md`
 * links to "create an API key" and a support answer links to "your webhook
 * deliveries". A tab that lives in component state cannot be linked to, cannot
 * be bookmarked, and loses its place on a refresh in the middle of debugging an
 * integration — which is exactly when someone refreshes.
 *
 * `Tabs` here is therefore chrome over `<Link>`s, and the active tab is derived
 * from the URL rather than held in state. `bible-tanstack-router` forbids
 * wrapping a shared frame in a component; this is a real layout route with an
 * `<Outlet/>`. The seven entries live in `const_OrgSettings_Tabs` because three
 * separate things now read them — see that file.
 *
 * ═══ SEVEN TABS DO NOT FIT 390px ═══
 *
 * Mobile renders a full-width `Select` over the same manifest. That is not a
 * retreat from tabs-are-routes: two of the three reasons the labels are links
 * (middle-click, hover preview) DO NOT EXIST ON TOUCH, and the third —
 * back-button traversal — survives, because `navigate()` still pushes history.
 *
 * ═══ THE ROLE CHECK IS THE THIRD GATE, NOT THE ONLY ONE ═══
 *
 * Every RPC behind these pages checks its own authorization as its first
 * statement, and `organizations` carries RLS plus, since CG-050, COLUMN-WISE
 * UPDATE grants. A member who reaches this URL can write nothing. This check
 * exists so they are TOLD that rather than shown a page that appears broken.
 *
 * It renders the restricted view while loading, which is the safe direction: a
 * surface that appears late is a flicker, one that appears and is then removed
 * is a button somebody may already have pressed.
 *
 * NOTE THE TWO DIFFERENT GATES BELOW. Membership is gated HERE, because a plain
 * member has no business on any of these tabs. OWNERSHIP is gated at each leaf
 * instead, because the owner-only tabs are owner-WRITE but member-READ: RLS
 * SELECT on `organizations` is `is_org_member`, so an admin may legitimately see
 * the values and gets a disabled form rather than a missing one.
 */
export const Route = createFileRoute("/_protected/$organizationId/settings")({
    component: SettingsLayout,
});

function SettingsLayout() {
    const { token } = theme.useToken();
    const { organizationId } = Route.useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const { isMobile } = useApp_Breakpoint();
    const qRole = useQ_Tables_MyRole({ organizationId });

    const activeKey = resolveOrgSettingsTab(location.pathname, organizationId);

    const isOwner = qRole.role === "owner";
    const isAdmin = isOwner || qRole.role === "admin";

    const visibleTabs = const_OrgSettings_Tabs.filter(
        (tab) => !("ownerOnly" in tab && tab.ownerOnly) || isOwner
    );

    return (
        <Space
            direction="vertical"
            size="middle"
            // `_protected/route.tsx`'s `<Content>` adds no padding, so without
            // this the surface sits flush against the frame border — unlike
            // every other page in the app.
            style={{ width: "100%", padding: token.paddingLG }}
        >
            <Typography.Title level={4} style={{ margin: 0 }}>
                Organization settings
            </Typography.Title>

            {qRole.query.isPending ? (
                <Skeleton active paragraph={{ rows: 4 }} />
            ) : !isAdmin ? (
                <Alert
                    type="info"
                    showIcon
                    message="Only admins and owners can open organization settings"
                    description="These pages change how this organization appears to the people who receive its documents, and who may act in its name. Ask an admin or the owner if you need something changed here."
                />
            ) : (
                <>
                    {isMobile ? (
                        <Select
                            size="large"
                            style={{ width: "100%" }}
                            value={activeKey}
                            onChange={(key) => {
                                const tab = visibleTabs.find((t) => t.key === key);
                                if (tab) navigate({ to: tab.to, params: { organizationId } });
                            }}
                            options={visibleTabs.map((tab) => ({
                                value: tab.key,
                                label: tab.label,
                            }))}
                        />
                    ) : (
                        <Tabs
                            activeKey={activeKey}
                            // No `onChange`: each label IS a link, so the
                            // browser's back button walks the tabs and a
                            // middle-click opens one in a new tab. An `onChange`
                            // navigating imperatively would take both away.
                            items={visibleTabs.map((tab) => ({
                                key: tab.key,
                                label: (
                                    <Link
                                        to={tab.to}
                                        params={{ organizationId }}
                                        style={{ color: "inherit" }}
                                    >
                                        {tab.label}
                                        {/* Members lives at /people, outside this
                                            tree. The icon says so — it is a
                                            departure, and it can never light. */}
                                        {"external" in tab && tab.external ? (
                                            <ExportOutlined
                                                style={{
                                                    marginInlineStart: token.marginXXS,
                                                    fontSize: token.fontSizeSM,
                                                }}
                                            />
                                        ) : null}
                                    </Link>
                                ),
                            }))}
                            style={{ marginBottom: -token.marginXS }}
                        />
                    )}
                    <Outlet />
                </>
            )}
        </Space>
    );
}
