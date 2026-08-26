import { Link } from "@tanstack/react-router";
import { Button, Divider, Empty, Skeleton, Typography, theme } from "antd";
import { App_NotificationItem } from "@/components/notifications/App_NotificationItem";
import { useM_Notifications_MarkAllRead } from "@/hooks/useM_Notifications_MarkAllRead";
import { useQ_Tables_Notifications } from "@/hooks/useQ_Tables_Notifications";

/** How many the dropdown shows before deferring to the full page. */
const PANEL_LIMIT = 10;

/**
 * The bell's dropdown body.
 *
 * A hand-rolled panel rather than a `Menu`, matching `App_UserMenu`: these rows
 * are two lines of wrapping text with their own icon and timestamp, which is not
 * what a menu item is for, and the footer is a link rather than an action.
 *
 * NOT ORG-SCOPED. The bell is in the app shell, which renders on `/_protected/`
 * where no organization is in scope at all — and even inside one, hiding a
 * notification because the user happens to be looking at a different
 * organization is how it goes unread forever. The full page is where filtering
 * lives.
 *
 * TWO HOSTS, ONE BODY. On a phone the bell opens a full-screen `Drawer` instead
 * of a popover, so the same rows have to render inside two very different
 * containers. `variant` decides only who owns the chrome: in `'dropdown'` this
 * component draws its own card, in `'drawer'` the Drawer already has a surface,
 * a title and a close button, and drawing a second one inside it would show the
 * word "Notifications" twice above a shadow with nothing behind it.
 */
export const App_NotificationPanel = ({
    organizationId,
    onClose,
    variant = "dropdown",
}: {
    organizationId: string | null;
    onClose: () => void;
    variant?: "dropdown" | "drawer";
}) => {
    const { token } = theme.useToken();
    const qNotifications = useQ_Tables_Notifications({ limit: PANEL_LIMIT });
    const mMarkAllRead = useM_Notifications_MarkAllRead();

    const hasUnread = qNotifications.notifications.some((n) => !n.read_at);
    const isDrawer = variant === "drawer";

    return (
        <div
            style={
                isDrawer
                    ? // The Drawer owns the surface and its own scroll is disabled below,
                      // so the list — not the panel — is what scrolls.
                      { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }
                    : {
                          // 380px is wider than a 390px phone once the trigger's own 16px gutters
                          // are taken off, so the panel hung off the edge and clipped its actions.
                          // `min()` keeps the desktop width exactly as it was and only bites below it.
                          width: "min(380px, calc(100vw - 32px))",
                          background: token.colorBgElevated,
                          borderRadius: token.borderRadiusLG,
                          boxShadow: token.boxShadowSecondary,
                          paddingBlock: token.paddingSM,
                      }
            }
        >
            {/* In the drawer the title lives in the Drawer's own header, so this row
          exists only to carry the action — and only when there is one. */}
            {(!isDrawer || hasUnread) && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: isDrawer ? "flex-end" : "space-between",
                        gap: token.marginSM,
                        paddingInline: token.padding,
                        paddingTop: isDrawer ? token.paddingSM : 0,
                        flexShrink: 0,
                    }}
                >
                    {!isDrawer && <Typography.Text strong>Notifications</Typography.Text>}
                    {/* Only when there is something to clear — a permanently visible
              "Mark all read" on an empty inbox is a button that does nothing. */}
                    {hasUnread && (
                        <Button
                            type="link"
                            size="small"
                            style={{ paddingInline: 0 }}
                            loading={mMarkAllRead.mutation.isPending}
                            onClick={() => mMarkAllRead.mutation.mutate({})}
                        >
                            Mark all read
                        </Button>
                    )}
                </div>
            )}

            {(!isDrawer || hasUnread) && <Divider style={{ margin: `${token.marginXS}px 0` }} />}

            <div
                style={{
                    // Drawer: take whatever the header and footer leave. Dropdown: the old
                    // 420px, but clamped to the viewport — on a landscape phone a fixed 420
                    // pushed the footer link off the bottom of the screen with no way back.
                    ...(isDrawer
                        ? { flex: 1, minHeight: 0 }
                        : { maxHeight: "min(420px, calc(var(--app-vh) - 160px))" }),
                    overflowY: "auto",
                    paddingInline: token.paddingXS,
                }}
            >
                {qNotifications.query.isPending ? (
                    <Skeleton active paragraph={{ rows: 4 }} style={{ padding: token.padding }} />
                ) : qNotifications.notifications.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="Nothing yet"
                        style={{ marginBlock: token.marginLG }}
                    />
                ) : (
                    qNotifications.notifications.map((notification) => (
                        <App_NotificationItem
                            key={notification.id}
                            notification={notification}
                            onNavigate={onClose}
                        />
                    ))
                )}
            </div>

            {/* The full page is org-scoped, so this only appears inside an
          organization. Off-org the dropdown IS the whole surface. */}
            {organizationId && (
                <>
                    <Divider style={{ margin: `${token.marginXS}px 0`, flexShrink: 0 }} />
                    <div
                        style={{
                            textAlign: "center",
                            flexShrink: 0,
                            paddingBottom: isDrawer ? token.paddingSM : 0,
                        }}
                    >
                        <Link
                            to="/$organizationId/notifications"
                            params={{ organizationId }}
                            search={{ filter: "all" }}
                            onClick={onClose}
                        >
                            View all notifications
                        </Link>
                    </div>
                </>
            )}
        </div>
    );
};
