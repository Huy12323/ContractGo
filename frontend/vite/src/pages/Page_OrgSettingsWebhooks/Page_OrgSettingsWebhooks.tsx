import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import {
    Alert,
    Button,
    Card,
    Empty,
    Popconfirm,
    Skeleton,
    Space,
    Switch,
    Tag,
    Tooltip,
    Typography,
    theme,
} from "antd";
import {
    ApiOutlined,
    DeleteOutlined,
    EditOutlined,
    HistoryOutlined,
    PlusOutlined,
    RedoOutlined,
    SendOutlined,
} from "@ant-design/icons";
import { Page_OrgSettingsWebhooks_EndpointModal } from "./Page_OrgSettingsWebhooks_EndpointModal";
import { Page_OrgSettingsWebhooks_DeliveriesDrawer } from "./Page_OrgSettingsWebhooks_DeliveriesDrawer";
import { Page_OrgSettingsApiKeys_RevealPanel } from "@/pages/Page_OrgSettingsApiKeys/Page_OrgSettingsApiKeys_RevealPanel";
import {
    useQ_Tables_WebhookEndpoints,
    type Tables_WebhookEndpoints_Row,
} from "@/hooks/useQ_Tables_WebhookEndpoints";
import { useM_Webhooks_Create } from "@/hooks/useM_Webhooks_Create";
import { useM_Webhooks_Update } from "@/hooks/useM_Webhooks_Update";
import { useM_Webhooks_Delete } from "@/hooks/useM_Webhooks_Delete";
import { useM_Webhooks_RotateSecret } from "@/hooks/useM_Webhooks_RotateSecret";
import {
    useM_Webhooks_TestSend,
    type Webhook_TestSend_Result,
} from "@/hooks/useM_Webhooks_TestSend";
import { Modal } from "antd";

/**
 * Webhook endpoints and their health — CG-045/CG-046's surface.
 *
 * ═══ CARDS, NOT A TABLE ═══
 *
 * The API keys page is a table because a key has one state and five short
 * attributes. An endpoint has a URL that is too long for a cell, a list of
 * subscribed events, four health figures, and — when the breaker has tripped —
 * a reason and a recovery action that must be read rather than glanced at. That
 * does not fit in a row without hiding the thing most worth seeing.
 *
 * ═══ A DISABLED ENDPOINT IS THE MOST IMPORTANT STATE ON THIS PAGE ═══
 *
 * When the circuit breaker switches an endpoint off, NOTHING IS RETRYING IT and
 * no further events will ever arrive until a person acts. That is how an
 * integration dies unnoticed, and it is why CG-046 added an in-app notification
 * for it. Here it gets the full-width alert, the reason the breaker recorded,
 * and a re-enable that also clears the failure count.
 *
 * A HEALTHY-LOOKING endpoint with a non-zero failure count gets a quieter
 * warning for the same reason: nine failures is one delivery away from being
 * switched off, and telling someone only after it goes dark is telling them too
 * late.
 */
export const Page_OrgSettingsWebhooks = () => {
    const { token } = theme.useToken();
    const { organizationId } = useParams({
        from: "/_protected/$organizationId/settings/_integrations/webhooks",
    });

    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Tables_WebhookEndpoints_Row | null>(null);
    const [drawerFor, setDrawerFor] = useState<Tables_WebhookEndpoints_Row | null>(null);
    /** See `Page_OrgSettingsApiKeys` — held here and nowhere else, dies with the modal. */
    const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
    const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<Webhook_TestSend_Result | null>(null);

    const qEndpoints = useQ_Tables_WebhookEndpoints({ organizationId });
    const mCreate = useM_Webhooks_Create({ organizationId });
    const mUpdate = useM_Webhooks_Update({ organizationId });
    const mDelete = useM_Webhooks_Delete({ organizationId });
    const mRotate = useM_Webhooks_RotateSecret({ organizationId });
    const mTest = useM_Webhooks_TestSend();

    const handleSubmit = async (values: {
        name: string;
        url: string;
        events: Parameters<typeof mCreate.mutation.mutateAsync>[0]["events"];
    }) => {
        try {
            if (editing) {
                await mUpdate.mutation.mutateAsync({ endpointId: editing.id, ...values });
                closeModal();
            } else {
                const created = await mCreate.mutation.mutateAsync({
                    organizationId,
                    ...values,
                });
                setIssuedSecret(created.signing_secret);
            }
        } catch {
            // Already surfaced by the hook. Swallowed so the form stays open
            // with what was typed rather than throwing past the modal.
        }
    };

    const closeModal = () => {
        setModalOpen(false);
        setEditing(null);
        setIssuedSecret(null);
    };

    const handleTest = async (endpoint: Tables_WebhookEndpoints_Row) => {
        try {
            const result = await mTest.mutation.mutateAsync({
                organization_id: organizationId,
                endpoint_id: endpoint.id,
            });
            // Shown whether or not it worked. `delivered: false` is a RESULT,
            // not an error — the diagnostic did its job and is reporting bad
            // news, which is exactly what it exists for.
            setTestResult(result);
        } catch {
            // Only reached when the call to US failed; the hook said so.
        }
    };

    const renderEndpoint = (endpoint: Tables_WebhookEndpoints_Row) => (
        <Card
            key={endpoint.id}
            size="small"
            title={
                <Space wrap>
                    <Typography.Text strong>{endpoint.name}</Typography.Text>
                    {endpoint.is_enabled ? (
                        <Tag color="success">Enabled</Tag>
                    ) : (
                        <Tag color="error">Disabled</Tag>
                    )}
                </Space>
            }
            extra={
                <Space size={4} wrap>
                    <Tooltip title="Send a synthetic event to check the endpoint is reachable. Writes nothing and appears in no log.">
                        <Button
                            size="small"
                            icon={<SendOutlined />}
                            onClick={() => handleTest(endpoint)}
                            loading={
                                mTest.mutation.isPending &&
                                mTest.mutation.variables?.endpoint_id === endpoint.id
                            }
                        >
                            Send test
                        </Button>
                    </Tooltip>
                    <Button
                        size="small"
                        icon={<HistoryOutlined />}
                        onClick={() => setDrawerFor(endpoint)}
                    >
                        Deliveries
                    </Button>
                    <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => {
                            setEditing(endpoint);
                            setModalOpen(true);
                        }}
                    />
                    <Popconfirm
                        title="Rotate the signing secret?"
                        description={
                            <span style={{ maxWidth: 340, display: "inline-block" }}>
                                <strong>Deliveries will start failing immediately</strong> and keep
                                failing until you update the secret on your server. There is no
                                overlap period — the old secret stops working the moment the new one
                                is created.
                            </span>
                        }
                        okText="Rotate"
                        okButtonProps={{ danger: true }}
                        onConfirm={async () => {
                            try {
                                const secret = await mRotate.mutation.mutateAsync(endpoint.id);
                                setRotatedSecret(secret);
                            } catch {
                                /* surfaced by the hook */
                            }
                        }}
                    >
                        <Tooltip title="Replace the signing secret">
                            <Button size="small" icon={<RedoOutlined />} />
                        </Tooltip>
                    </Popconfirm>
                    <Popconfirm
                        title="Delete this endpoint?"
                        description={
                            <span style={{ maxWidth: 340, display: "inline-block" }}>
                                Your server will simply stop hearing from us — nothing will tell it
                                why. Its delivery history is deleted too.
                            </span>
                        }
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => mDelete.mutation.mutate(endpoint.id)}
                    >
                        <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            }
        >
            <Space direction="vertical" size="small" style={{ width: "100%" }}>
                {!endpoint.is_enabled && (
                    <Alert
                        type="error"
                        showIcon
                        message="Switched off after repeated failures"
                        description={
                            <Space direction="vertical" size={4}>
                                <Typography.Text>
                                    {endpoint.disabled_reason ??
                                        "This endpoint failed too many times in a row."}
                                </Typography.Text>
                                <Typography.Text type="secondary">
                                    Nothing is being retried and no further events will arrive until
                                    it is switched back on. Fix the endpoint, use{" "}
                                    <strong>Send test</strong> to confirm, then re-enable — which
                                    also resets the failure count.
                                </Typography.Text>
                            </Space>
                        }
                        action={
                            <Switch
                                checked={false}
                                loading={mUpdate.mutation.isPending}
                                onChange={() =>
                                    mUpdate.mutation.mutate({
                                        endpointId: endpoint.id,
                                        isEnabled: true,
                                    })
                                }
                            />
                        }
                    />
                )}

                {endpoint.is_enabled && endpoint.consecutive_failures > 0 && (
                    <Alert
                        type="warning"
                        showIcon
                        message={`${endpoint.consecutive_failures} failures in a row`}
                        description="Still enabled, but it will be switched off automatically if this keeps up."
                    />
                )}

                <Typography.Text code style={{ wordBreak: "break-all" }}>
                    {endpoint.url}
                </Typography.Text>

                <Space size={[4, 4]} wrap>
                    {endpoint.events.map((e) => (
                        <Tag key={e} style={{ fontSize: token.fontSizeSM }}>
                            {e}
                        </Tag>
                    ))}
                </Space>

                <Space size="large" wrap>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        Last delivery:{" "}
                        {endpoint.last_delivery_at
                            ? new Date(endpoint.last_delivery_at).toLocaleString()
                            : "never"}
                    </Typography.Text>
                    {endpoint.pending_count > 0 && (
                        <Typography.Text type="warning" style={{ fontSize: token.fontSizeSM }}>
                            {endpoint.pending_count} queued
                        </Typography.Text>
                    )}
                    {endpoint.failed_count > 0 && (
                        <Tooltip title="Events that used up every retry. They will not be delivered.">
                            <Typography.Text type="danger" style={{ fontSize: token.fontSizeSM }}>
                                {endpoint.failed_count} gave up
                            </Typography.Text>
                        </Tooltip>
                    )}
                    {endpoint.is_enabled && (
                        <Space size={4}>
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: token.fontSizeSM }}
                            >
                                Enabled
                            </Typography.Text>
                            <Switch
                                size="small"
                                checked
                                loading={mUpdate.mutation.isPending}
                                onChange={() =>
                                    mUpdate.mutation.mutate({
                                        endpointId: endpoint.id,
                                        isEnabled: false,
                                    })
                                }
                            />
                        </Space>
                    )}
                </Space>
            </Space>
        </Card>
    );

    return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: token.marginSM,
                    flexWrap: "wrap",
                }}
            >
                <Typography.Text type="secondary" style={{ maxWidth: 620 }}>
                    We POST a signed JSON payload to your server whenever a document moves, so you
                    do not have to poll. Every request carries an HMAC signature your server should
                    verify, and an event id you should use to ignore repeats.
                </Typography.Text>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                        setEditing(null);
                        setModalOpen(true);
                    }}
                >
                    Add endpoint
                </Button>
            </div>

            {qEndpoints.query.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="Could not load endpoints"
                    description={
                        qEndpoints.query.error instanceof Error
                            ? qEndpoints.query.error.message
                            : undefined
                    }
                />
            )}

            {qEndpoints.query.isPending ? (
                <Skeleton active paragraph={{ rows: 4 }} />
            ) : qEndpoints.endpoints.length === 0 ? (
                <Empty
                    image={
                        <ApiOutlined style={{ fontSize: 48, color: token.colorTextQuaternary }} />
                    }
                    description={
                        <Space direction="vertical" size={4}>
                            <Typography.Text strong>No endpoints yet</Typography.Text>
                            <Typography.Text type="secondary">
                                Add one to have your systems told the moment a document is signed.
                            </Typography.Text>
                        </Space>
                    }
                />
            ) : (
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                    {qEndpoints.endpoints.map(renderEndpoint)}
                </Space>
            )}

            <Page_OrgSettingsWebhooks_EndpointModal
                open={modalOpen}
                editing={editing}
                isSubmitting={mCreate.mutation.isPending || mUpdate.mutation.isPending}
                issuedSecret={issuedSecret}
                onSubmit={handleSubmit}
                onClose={closeModal}
            />

            {/* The rotated secret gets its own modal rather than reusing the
                endpoint one: rotation happens from the card, not from a form,
                and routing it through the editor would mean opening an editor
                nobody asked for. */}
            <Modal
                open={!!rotatedSecret}
                title="Your new signing secret"
                maskClosable={false}
                keyboard={false}
                closable={false}
                footer={null}
                onCancel={() => setRotatedSecret(null)}
                destroyOnHidden
            >
                {rotatedSecret && (
                    <Page_OrgSettingsApiKeys_RevealPanel
                        label="Signing secret"
                        value={rotatedSecret}
                        warning="Deliveries to this endpoint are failing right now and will keep failing until your server is using this new secret. The old one has already stopped working."
                        onDone={() => setRotatedSecret(null)}
                    />
                )}
            </Modal>

            <Modal
                open={!!testResult}
                title="Test event"
                footer={null}
                onCancel={() => setTestResult(null)}
                destroyOnHidden
            >
                {testResult && (
                    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                        <Alert
                            type={testResult.delivered ? "success" : "error"}
                            showIcon
                            message={
                                testResult.delivered
                                    ? `Delivered in ${testResult.latency_ms} ms`
                                    : "Your server did not accept it"
                            }
                            description={
                                testResult.delivered
                                    ? `Your server answered ${testResult.status_code}.`
                                    : testResult.status_code !== null
                                      ? `Your server answered ${testResult.status_code}. We treat anything outside 2xx as a failure — including redirects, which we deliberately do not follow.`
                                      : `We never got a response: ${testResult.error ?? "the request did not complete"}. That usually means DNS, TLS, or a timeout rather than a bug in your handler.`
                            }
                        />

                        {/* Echoed so an integrator whose verification is failing
                            can compare our bytes against theirs. The secret is
                            never echoed — this is a MAC over the payload, which
                            reveals nothing. */}
                        <div>
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: token.fontSizeSM }}
                            >
                                Signature header we sent
                            </Typography.Text>
                            <Typography.Paragraph
                                code
                                copyable
                                style={{ wordBreak: "break-all", fontSize: token.fontSizeSM }}
                            >
                                {testResult.signature_header}
                            </Typography.Paragraph>
                        </div>

                        <div>
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: token.fontSizeSM }}
                            >
                                The exact string that was signed
                            </Typography.Text>
                            <Typography.Paragraph
                                code
                                copyable
                                style={{ wordBreak: "break-all", fontSize: token.fontSizeSM }}
                            >
                                {testResult.signed_payload_preview}
                            </Typography.Paragraph>
                        </div>

                        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            This test wrote no delivery record and appears in no document&rsquo;s
                            history. Its event type is{" "}
                            <Typography.Text code>webhook.test</Typography.Text>, which is
                            deliberately not one of the real events — a consumer switching on the
                            event name will fall through to its default branch.
                        </Typography.Text>
                    </Space>
                )}
            </Modal>

            <Page_OrgSettingsWebhooks_DeliveriesDrawer
                endpoint={drawerFor}
                onClose={() => setDrawerFor(null)}
            />
        </Space>
    );
};
