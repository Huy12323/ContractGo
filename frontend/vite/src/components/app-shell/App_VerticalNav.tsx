import React, { useEffect } from "react";
import { Link, useMatch, useLocation } from "@tanstack/react-router";
import { Drawer, Layout, Menu, theme } from "antd";
import type { ItemType } from "antd/es/menu/interface";
import {
    BellOutlined,
    SettingOutlined,
    DashboardOutlined,
    FileTextOutlined,
    InboxOutlined,
    SendOutlined,
    TeamOutlined,
} from "@ant-design/icons";
import {
    Store_VerticalNav_Actions,
    useStore_VerticalNav_Collapsed,
    useStore_VerticalNav_MobileOpen,
} from "@/stores/Store_VerticalNav";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { App_OrgSwitcher } from "@/components/organization/App_OrgSwitcher";
import {
    const_AppShell_VerticalNavWidth,
    const_AppShell_VerticalNavCollapsedWidth,
} from "@/components/app-shell/const_AppShell_Dimensions";

// ContractGo navigation.
//
// The v1 nav branched on two facts — `isHR` (owner/admin) and `hasEmployeeRecord`
// — to decide whether to show the HR group, the Employee group, or both. Neither
// survives: ContractGo has no employee tier, and every destination below is
// org-scoped and admin-gated at the route, so the nav does not need to
// second-guess the guard. That branching is why this component queried
// `useQ_Tables_MyRole` and `useQ_Tables_MyEmployeeEntities` at all; both queries
// are gone with it.
//
// Destinations are added here as their routes are created, so the typed-route
// table keeps `to` honest and a link can never point at a route that isn't
// registered. Dashboard, Templates and Documents exist; settings and the
// document browser land in v1.3.

const { Sider } = Layout;

export const App_VerticalNav = () => {
    const collapsed = useStore_VerticalNav_Collapsed();
    const mobileOpen = useStore_VerticalNav_MobileOpen();
    const { isMobile } = useApp_Breakpoint();
    const { token } = theme.useToken();
    const location = useLocation();

    const organizationId = useMatch({
        from: "/_protected/$organizationId",
        shouldThrow: false,
        select: (m) => m.params.organizationId,
    });

    // CG-048. The same question one route over: is this the personal workspace?
    // Matched rather than derived from the pathname so the router stays the single
    // authority on where we are, and `shouldThrow: false` because most pages are
    // under neither branch — a nav that threw off the org tree would take the whole
    // shell with it.
    //
    // NO ID IS READ HERE, because `/me` has none in its path: the workspace id is
    // the provider's business, and the nav only needs to know which set of
    // destinations to draw.
    const isPersonal = !!useMatch({
        from: "/_protected/me",
        shouldThrow: false,
        select: () => true,
    });

    // Navigating closes the drawer. It sits here rather than on each `Link` so a
    // destination added to `menuItems` later cannot forget it, and rather than in
    // the store so the store keeps knowing nothing about the router.
    useEffect(() => {
        Store_VerticalNav_Actions.setMobileOpen(false);
    }, [location.pathname]);

    // Growing back to a desktop width must not leave an open drawer behind — the
    // sider it becomes is always visible, so the drawer would be a second copy of
    // the nav sitting over the page with no trigger to dismiss it.
    useEffect(() => {
        if (!isMobile) Store_VerticalNav_Actions.setMobileOpen(false);
    }, [isMobile]);

    // THE PERSONAL WORKSPACE HAS ONE DESTINATION, and that is the whole design.
    // Templates, People, Archive, Notifications and the org switcher are all
    // organization concepts; offering them here would put the word "organization"
    // back into the one surface built to never say it. A user who wants those
    // creates an organization from Home.
    //
    // This branch is why the component no longer returns `null` for a logged-in
    // user with no organizations — which is the state a fresh sign-up is in, and
    // which used to leave them looking at a page with no navigation at all.
    if (isPersonal) {
        return (
            <App_VerticalNav_Frame
                isMobile={isMobile}
                mobileOpen={mobileOpen}
                collapsed={collapsed}
                token={token}
                // No `App_OrgSwitcher`: the personal workspace is deliberately absent
                // from `get_my_member_organizations` (CG-048 PHASE 3), so the switcher
                // could only ever offer a way OUT of here and never back in.
                footer={null}
                menu={
                    <Menu
                        mode="inline"
                        selectedKeys={["/me/documents"]}
                        style={{ flex: 1, borderRight: 0 }}
                        items={[
                            {
                                key: "/me/documents",
                                icon: <SendOutlined />,
                                label: (
                                    <Link to="/me/documents" search={{ status: "all" }}>
                                        My Documents
                                    </Link>
                                ),
                            },
                        ]}
                    />
                }
            />
        );
    }

    if (!organizationId) return null;

    const templatesPath = `/${organizationId}/templates`;
    const envelopesPath = `/${organizationId}/envelopes`;
    const archivePath = `/${organizationId}/archive`;
    const peoplePath = `/${organizationId}/people`;
    const notificationsPath = `/${organizationId}/notifications`;
    const settingsPath = `/${organizationId}/settings`;
    // Prefix match, so the builder at /templates/$templateId keeps Templates lit
    // and the composer at /envelopes/new keeps Envelopes lit.
    const selectedKeys = location.pathname.startsWith(templatesPath)
        ? [templatesPath]
        : location.pathname.startsWith(archivePath)
          ? [archivePath]
          : location.pathname.startsWith(envelopesPath)
            ? [envelopesPath]
            : location.pathname.startsWith(peoplePath)
              ? [peoplePath]
              : location.pathname.startsWith(notificationsPath)
                ? [notificationsPath]
                : location.pathname.startsWith(settingsPath)
                  ? [settingsPath]
                  : location.pathname === `/${organizationId}`
                    ? [`/${organizationId}`]
                    : [];

    const menuItems: ItemType[] = [
        {
            key: `/${organizationId}`,
            icon: <DashboardOutlined />,
            label: (
                <Link to="/$organizationId" params={{ organizationId }}>
                    Dashboard
                </Link>
            ),
        },
        {
            key: templatesPath,
            icon: <FileTextOutlined />,
            label: (
                <Link to="/$organizationId/templates" params={{ organizationId }}>
                    Templates
                </Link>
            ),
        },
        {
            key: envelopesPath,
            icon: <SendOutlined />,
            label: (
                <Link
                    to="/$organizationId/envelopes"
                    params={{ organizationId }}
                    search={{ status: "all" }}
                >
                    Documents
                </Link>
            ),
        },
        // Visible to every member, not just admins: knowing who else is in the
        // workspace is not a privileged fact, and the page gates the invite button
        // on the caller's role rather than hiding the whole destination.
        // CG-043. "Archive", not a second "Documents" — the entry above already
        // carries that word, and pointing it at this page would leave the envelope
        // list with no way into it. Named for what it holds: documents that have
        // finished, and the copies you can hand to a counterparty.
        {
            key: archivePath,
            icon: <InboxOutlined />,
            label: (
                <Link to="/$organizationId/archive" params={{ organizationId }}>
                    Archive
                </Link>
            ),
        },
        {
            key: peoplePath,
            icon: <TeamOutlined />,
            label: (
                <Link to="/$organizationId/people" params={{ organizationId }}>
                    People
                </Link>
            ),
        },
        // Present so the page has a home in the nav and stays lit when the bell's
        // footer link lands here. The bell is still the primary way in — this is the
        // "where did that go" entry, not the everyday one.
        {
            key: notificationsPath,
            icon: <BellOutlined />,
            label: (
                <Link
                    to="/$organizationId/notifications"
                    params={{ organizationId }}
                    search={{ filter: "all" }}
                >
                    Notifications
                </Link>
            ),
        },
        // CG-050. In the nav for EVERYONE, with no role branch — the same call
        // People makes above, and for the same reason: the destination is not the
        // privileged fact, what you can do there is, and the layout route already
        // explains itself to anyone who may not act.
        //
        // This entry is the point of CG-050 as much as any of the tabs behind it.
        // The route existed before and nothing in the app linked to it; it was
        // reachable only by typing the URL, which is indistinguishable from not
        // existing.
        {
            key: settingsPath,
            icon: <SettingOutlined />,
            label: (
                <Link to="/$organizationId/settings" params={{ organizationId }}>
                    Settings
                </Link>
            ),
        },
    ];

    return (
        <App_VerticalNav_Frame
            isMobile={isMobile}
            mobileOpen={mobileOpen}
            collapsed={collapsed}
            token={token}
            menu={
                <Menu
                    mode="inline"
                    selectedKeys={selectedKeys}
                    style={{ flex: 1, borderRight: 0 }}
                    items={menuItems}
                />
            }
            footer={
                // Never collapsed inside the drawer: the drawer is only ever open at
                // full width, and the icon-only switcher would be unreadable there.
                <App_OrgSwitcher collapsed={isMobile ? false : collapsed} />
            }
        />
    );
};

// The chrome, shared by both scopes.
//
// EXTRACTED WHEN CG-048 ADDED THE SECOND BRANCH, because the alternative was a
// second copy of the drawer/sider pair — and the two would have drifted the first
// time either the mobile width or the collapse behaviour was touched. It holds no
// state and makes no decisions: what goes IN it is the caller's business.
const App_VerticalNav_Frame = ({
    isMobile,
    mobileOpen,
    collapsed,
    token,
    menu,
    footer,
}: {
    isMobile: boolean;
    mobileOpen: boolean;
    collapsed: boolean;
    token: ReturnType<typeof theme.useToken>["token"];
    menu: React.ReactNode;
    /** `null` in the personal workspace, which has nothing to switch between. */
    footer: React.ReactNode;
}) => {
    const navBody = (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {menu}
            {footer}
        </div>
    );

    // A drawer, not a narrower sider. Even the 64px collapsed sider is 16% of a
    // 390px screen spent on navigation that is not being used — and the icon-only
    // form is exactly the version a first-time visitor cannot read.
    if (isMobile) {
        return (
            <Drawer
                open={mobileOpen}
                onClose={() => Store_VerticalNav_Actions.setMobileOpen(false)}
                placement="left"
                width={const_AppShell_VerticalNavWidth}
                title="ContractGo"
                styles={{ body: { padding: 0 } }}
            >
                {navBody}
            </Drawer>
        );
    }

    return (
        <Sider
            trigger={null}
            collapsible
            collapsed={collapsed}
            width={const_AppShell_VerticalNavWidth}
            collapsedWidth={const_AppShell_VerticalNavCollapsedWidth}
            style={{
                background: token.colorBgContainer,
                borderRight: `1px solid ${token.colorBorder}`,
                height: "100%",
                overflow: "auto",
            }}
        >
            {navBody}
        </Sider>
    );
};
