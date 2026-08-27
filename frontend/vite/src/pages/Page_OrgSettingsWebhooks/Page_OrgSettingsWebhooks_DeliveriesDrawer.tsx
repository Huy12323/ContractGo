import { Drawer, Empty, Skeleton, Space, Table, Tag, Tooltip, Typography, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
    useQ_Webhook_Deliveries,
    type Webhook_Delivery_Row,
} from "@/hooks/useQ_Webhook_Deliveries";
import type { Tables_WebhookEndpoints_Row } from "@/hooks/useQ_Tables_WebhookEndpoints";

/**
 * "Did it arrive, and if not, why?" — the whole job of this drawer.
 *
 * NO PAYLOAD COLUMN, by design. `webhook_deliveries_list` does not return the
 * body (CG-045) and the drawer is better for it: a column of JSON blobs makes
 * the failure harder to spot, not easier, and the integrator already has the
 * body — it was POSTed to their own server.
 *
 * WHAT IS HERE INSTEAD is the four facts that answer the question: the status,
 * the HTTP code their server returned, how many attempts have been made, and
 * when the next one is due. A `pending` row with `next_attempt_at` in twelve
 * hours is the single most useful thing this page can show someone whose
 * integration has gone quiet — it says "we are still trying", which is different
 * from "we gave up" and different again from "we never tried".
 */

const STATUS_TAG: Record<string, { color: string; label: string; help: string }> = {
    delivered: {
        color: "success",
        label: "Delivered",
        help: "Your server answered with a 2xx.",
    },
    pending: {
        color: "processing",
        label: "Pending",
        help: "Queued or waiting for its next retry.",
    },
    delivering: {
        color: "warning",
        label: "Sending",
        help: "In flight right now.",
    },
    failed: {
        color: "error",
        label: "Failed",
        help: "Every retry was used up. This event will not be delivered.",
    },
};

export const Page_OrgSettingsWebhooks_DeliveriesDrawer = ({
    endpoint,
    onClose,
}: {
    endpoint: Tables_WebhookEndpoints_Row | null;
    onClose: () => void;
}) => {
    const { token } = theme.useToken();
    const qDeliveries = useQ_Webhook_Deliveries({ endpointId: endpoint?.id ?? null });

    const columns: ColumnsType<Webhook_Delivery_Row> = [
        {
            title: "Event",
            dataIndex: "event_type",
            render: (eventType: string, row) => (
                <Space direction="vertical" size={0}>
                    <Typography.Text code style={{ fontSize: token.fontSizeSM }}>
                        {eventType}
                    </Typography.Text>
                    {/* The event id, which is what a consumer dedupes on. Shown
                        so an integrator debugging a double-processed event can
                        find the same id in their own logs. */}
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        {row.event_id}
                    </Typography.Text>
                </Space>
            ),
        },
        {
            title: "Status",
            dataIndex: "status",
            width: 120,
            render: (status: string) => {
                const tag = STATUS_TAG[status] ?? {
                    color: "default",
                    label: status,
                    help: "",
                };
                return (
                    <Tooltip title={tag.help}>
                        <Tag color={tag.color}>{tag.label}</Tag>
                    </Tooltip>
                );
            },
        },
        {
            title: "Code",
            dataIndex: "last_status_code",
            width: 80,
            render: (code: number | null) =>
                code === null ? (
                    // No code at all means we never got an HTTP response —
                    // DNS, TLS or a timeout. Distinct from a 500, and the
                    // distinction is the difference between "your server is
                    // broken" and "your server is unreachable".
                    <Tooltip title="No HTTP response — DNS failure, TLS failure, or a timeout.">
                        <Typography.Text type="secondary">—</Typography.Text>
                    </Tooltip>
                ) : (
                    <Typography.Text type={code >= 200 && code < 300 ? "success" : "danger"}>
                        {code}
                    </Typography.Text>
                ),
        },
        {
            title: "Attempts",
            dataIndex: "attempt_count",
            width: 90,
            render: (attempts: number, row) =>
                row.status === "pending" && row.next_attempt_at ? (
                    <Tooltip
                        title={`Next attempt ${new Date(row.next_attempt_at).toLocaleString()}`}
                    >
                        <Typography.Text>{attempts}</Typography.Text>
                    </Tooltip>
                ) : (
                    attempts
                ),
        },
        {
            title: "When",
            dataIndex: "created_at",
            width: 170,
            render: (createdAt: string, row) => (
                <Space direction="vertical" size={0}>
                    <Typography.Text style={{ fontSize: token.fontSizeSM }}>
                        {new Date(createdAt).toLocaleString()}
                    </Typography.Text>
                    {row.last_error && (
                        <Typography.Text
                            type="danger"
                            style={{ fontSize: token.fontSizeSM }}
                            ellipsis={{ tooltip: row.last_error }}
                        >
                            {row.last_error}
                        </Typography.Text>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <Drawer
            open={!!endpoint}
            onClose={onClose}
            width={720}
            title={
                <Space direction="vertical" size={0}>
                    <Typography.Text strong>Recent deliveries</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        {endpoint?.name}
                    </Typography.Text>
                </Space>
            }
        >
            {qDeliveries.query.isPending ? (
                <Skeleton active paragraph={{ rows: 6 }} />
            ) : qDeliveries.deliveries.length === 0 ? (
                <Empty
                    description={
                        <Space direction="vertical" size={4}>
                            <Typography.Text strong>Nothing sent yet</Typography.Text>
                            <Typography.Text type="secondary">
                                Deliveries appear here as documents move. Use “Send test” to check
                                the endpoint before waiting for a real one.
                            </Typography.Text>
                        </Space>
                    }
                />
            ) : (
                <Table<Webhook_Delivery_Row>
                    rowKey="id"
                    columns={columns}
                    dataSource={qDeliveries.deliveries}
                    pagination={false}
                    size="small"
                    scroll={{ x: "max-content" }}
                />
            )}
        </Drawer>
    );
};
