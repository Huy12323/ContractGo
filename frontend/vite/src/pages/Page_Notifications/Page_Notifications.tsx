import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Button, Empty, Skeleton, Tabs, Typography, theme } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { App_NotificationItem } from "@/components/notifications/App_NotificationItem";
import { useM_Notifications_MarkAllRead } from "@/hooks/useM_Notifications_MarkAllRead";
import { useQ_Tables_Notifications } from "@/hooks/useQ_Tables_Notifications";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

const PAGE_LIMIT = 200;

/**
 * Everything the bell's dropdown had to truncate.
 *
 * The filter is a TYPED SEARCH PARAM rather than component state, for the same
 * reason the envelope list's status tab is: "show me what I have not read" is a
 * view worth bookmarking, and the back button should return to the tab the user
 * was on.
 *
 * ORG-SCOPED, unlike the bell. The page lives under `/$organizationId`, so
 * showing another organization's notifications on it would be showing work that
 * belongs to a different left-hand nav. Rows with a NULL organization — an admin
 * invitation, which arrives before membership exists — are therefore reachable
 * only from the dropdown, which is where they are relevant anyway.
 */
export const Page_Notifications = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const navigate = useNavigate();
    const { organizationId } = useParams({ from: "/_protected/$organizationId/notifications/" });
    const { filter } = useSearch({ from: "/_protected/$organizationId/notifications/" });

    const mMarkAllRead = useM_Notifications_MarkAllRead();

    const qNotifications = useQ_Tables_Notifications({
        organizationId,
        unreadOnly: filter === "unread",
        limit: PAGE_LIMIT,
    });

    const hasUnread = qNotifications.notifications.some((n) => !n.read_at);

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: token.marginMD,
                    padding: `${token.paddingSM}px ${isMobile ? token.paddingSM : token.paddingMD}px`,
                    borderBottom: `1px solid ${token.colorBorder}`,
                    background: token.colorBgContainer,
                    flexShrink: 0,
                }}
            >
                <Typography.Title level={5} style={{ margin: 0 }}>
                    Notifications
                </Typography.Title>
                <Button
                    icon={<CheckOutlined />}
                    disabled={!hasUnread}
                    loading={mMarkAllRead.mutation.isPending}
                    onClick={() => mMarkAllRead.mutation.mutate({ organizationId })}
                >
                    {isMobile ? "Mark read" : "Mark all read"}
                </Button>
            </div>

            <div
                style={{
                    padding: `0 ${isMobile ? token.paddingSM : token.paddingMD}px`,
                    flexShrink: 0,
                }}
            >
                <Tabs
                    activeKey={filter}
                    items={[
                        { key: "all", label: "All" },
                        { key: "unread", label: "Unread" },
                    ]}
                    onChange={(key) =>
                        navigate({
                            to: "/$organizationId/notifications",
                            params: { organizationId },
                            search: { filter: key as typeof filter },
                        })
                    }
                />
            </div>

            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    padding: isMobile ? token.paddingSM : token.paddingMD,
                }}
            >
                {qNotifications.query.isPending ? (
                    <Skeleton active paragraph={{ rows: 8 }} />
                ) : qNotifications.notifications.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            filter === "unread"
                                ? "Nothing unread"
                                : "No notifications for this organization yet"
                        }
                        style={{ marginBlock: token.marginXL }}
                    />
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: token.marginXXS }}>
                        {qNotifications.notifications.map((notification) => (
                            <App_NotificationItem
                                key={notification.id}
                                notification={notification}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
