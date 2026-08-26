import { useEffect, useState } from "react";
import { useMatch } from "@tanstack/react-router";
import { Badge, Button, Drawer, Dropdown, theme } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { App_NotificationPanel } from "@/components/notifications/App_NotificationPanel";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { useQ_Notifications_UnreadCount } from "@/hooks/useQ_Notifications_UnreadCount";
import { useStore_Auth_Session } from "@/stores/Store_Auth";

/**
 * The bell, immediately left of the avatar in the app shell.
 *
 * CLICK, NOT HOVER, for the same reasons `App_UserMenu` documents: the panel is
 * a list of navigation targets, opening it in passing is a mis-fire generator,
 * and a hover-only trigger cannot be reached from the keyboard at all.
 *
 * ORG-AGNOSTIC. The header renders on `/_protected/` too, where there is no
 * organization in scope — resolved the same way `App_UserMenu` does, with
 * `shouldThrow: false`. The unread count is never org-filtered; the org id only
 * decides whether the panel can offer a "view all" page to link to.
 *
 * DROPDOWN ON DESKTOP, DRAWER ON MOBILE — the same fork `App_VerticalNav` makes,
 * for the same reason. A popover anchored under the header is already almost the
 * full width of a phone, and what it buys at that size is a card with nowhere to
 * hang: it clipped its own footer and left the page dimly visible around a 4px
 * margin. The drawer gives the rows the whole screen and a close button that is
 * where a phone user expects one.
 */
export const App_NotificationBell = () => {
    const { token } = theme.useToken();
    const session = useStore_Auth_Session();
    const { isMobile } = useApp_Breakpoint();
    const [open, setOpen] = useState(false);

    const organizationId =
        useMatch({
            from: "/_protected/$organizationId",
            shouldThrow: false,
            select: (m) => m.params.organizationId,
        }) ?? null;

    const qUnread = useQ_Notifications_UnreadCount({ enabled: !!session });

    // A drawer left open while the viewport grows past `md` would sit over the
    // desktop layout with no trigger still rendering it. Same guard as the nav's.
    useEffect(() => {
        if (!isMobile) setOpen(false);
    }, [isMobile]);

    const trigger = (
        <Badge count={qUnread.unreadCount} size="small" overflowCount={99} offset={[-2, 2]}>
            <Button
                type="text"
                aria-label={
                    qUnread.unreadCount > 0
                        ? `Notifications, ${qUnread.unreadCount} unread`
                        : "Notifications"
                }
                icon={<BellOutlined />}
                style={{ fontSize: 16, color: token.colorText }}
                onClick={isMobile ? () => setOpen(true) : undefined}
            />
        </Badge>
    );

    if (isMobile) {
        return (
            <>
                {trigger}
                <Drawer
                    open={open}
                    onClose={() => setOpen(false)}
                    placement="right"
                    // `'100%'`, not `100vw`: a percentage of the drawer's container respects
                    // the scrollbar where a viewport unit would push past it.
                    width="100%"
                    title="Notifications"
                    // The panel scrolls its own list so the header and the "view all" footer
                    // stay put; a scrolling body would take them with it.
                    styles={{ body: { padding: 0, display: "flex", flexDirection: "column" } }}
                >
                    <App_NotificationPanel
                        variant="drawer"
                        organizationId={organizationId}
                        onClose={() => setOpen(false)}
                    />
                </Drawer>
            </>
        );
    }

    return (
        <Dropdown
            open={open}
            onOpenChange={setOpen}
            trigger={["click"]}
            placement="bottomRight"
            popupRender={() => (
                <App_NotificationPanel
                    organizationId={organizationId}
                    onClose={() => setOpen(false)}
                />
            )}
        >
            {trigger}
        </Dropdown>
    );
};
