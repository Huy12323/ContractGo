import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import {
    Alert,
    Button,
    Empty,
    Popconfirm,
    Skeleton,
    Space,
    Table,
    Tag,
    Tooltip,
    Typography,
    theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { KeyOutlined, PlusOutlined, StopOutlined } from "@ant-design/icons";
import { Page_SettingsApiKeys_CreateModal } from "./Page_SettingsApiKeys_CreateModal";
import { useQ_Tables_ApiKeys, type Tables_ApiKeys_Row } from "@/hooks/useQ_Tables_ApiKeys";
import { useM_ApiKeys_Issue } from "@/hooks/useM_ApiKeys_Issue";
import { useM_ApiKeys_Revoke } from "@/hooks/useM_ApiKeys_Revoke";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

/**
 * The organization's API keys — CG-044's surface.
 *
 * Until this page existed, minting a key meant calling an RPC by hand. That is
 * the whole reason it is here: the machine surface shipped in Phase B and had no
 * door a human could open.
 *
 * ═══ WHAT THE LIST SHOWS AND WHY ═══
 *
 * The PREFIX, never the key. `api_keys_list` never selects `key_hash`, and the
 * prefix is stored in the clear precisely so this table can say WHICH key
 * without holding a credential. An admin matching a row against the value in
 * their deployment config compares eleven characters, which is enough to be
 * unambiguous and useless to anyone who reads it over a shoulder.
 *
 * LAST USED is the column that earns its width. A key nobody has used in three
 * months is a credential nobody is watching, and "never used" on a key created
 * last quarter is an integration that was configured and then abandoned — both
 * are things you revoke. This is the only place either fact is visible.
 *
 * ═══ THE STATES A KEY CAN BE IN ═══
 *
 * Live, revoked, and expired are three different facts and the table keeps them
 * apart. A revoked key was switched off by a person; an expired one ran out on
 * its own. Collapsing them into "inactive" would lose the difference at exactly
 * the moment someone is asking why an integration stopped.
 */
export const Page_SettingsApiKeys = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const { organizationId } = useParams({
        from: "/_protected/$organizationId/settings/api-keys",
    });

    const [createOpen, setCreateOpen] = useState(false);
    /**
     * The plaintext key, held HERE and nowhere else.
     *
     * Not in the query cache, not in a store, not in `localStorage`. It exists
     * for as long as this modal is open and is gone the moment it closes, which
     * is the correct lifetime for something the server itself cannot recover.
     */
    const [issuedKey, setIssuedKey] = useState<string | null>(null);

    const qApiKeys = useQ_Tables_ApiKeys({ organizationId });
    const mIssue = useM_ApiKeys_Issue({ organizationId });
    const mRevoke = useM_ApiKeys_Revoke({ organizationId });

    const handleCreate = async (values: {
        name: string;
        scopes: Parameters<typeof mIssue.mutation.mutateAsync>[0]["scopes"];
        allowedEmbedOrigins: string[];
        expiresAt: string | null;
    }) => {
        try {
            const issued = await mIssue.mutation.mutateAsync({ organizationId, ...values });
            setIssuedKey(issued.api_key);
        } catch {
            // `useM_ApiKeys_Issue` already surfaced it. Swallowed here so a
            // failed create leaves the form open with what was typed in it,
            // rather than throwing past the modal.
        }
    };

    const closeCreate = () => {
        setCreateOpen(false);
        setIssuedKey(null);
    };

    const statusOf = (row: Tables_ApiKeys_Row) => {
        if (row.revoked_at) return "revoked" as const;
        if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return "expired" as const;
        return "live" as const;
    };

    const columns: ColumnsType<Tables_ApiKeys_Row> = [
        {
            title: "Name",
            dataIndex: "name",
            render: (name: string, row) => (
                <Space direction="vertical" size={0}>
                    <Typography.Text strong>{name}</Typography.Text>
                    <Typography.Text code type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        {row.key_prefix}…
                    </Typography.Text>
                </Space>
            ),
        },
        {
            title: "Status",
            key: "status",
            width: 120,
            render: (_v, row) => {
                const status = statusOf(row);
                if (status === "live") return <Tag color="success">Live</Tag>;
                if (status === "revoked") return <Tag color="error">Revoked</Tag>;
                return <Tag color="warning">Expired</Tag>;
            },
        },
        {
            title: "Can do",
            dataIndex: "scopes",
            responsive: ["md"],
            render: (scopes: string[]) => (
                <Space size={[4, 4]} wrap>
                    {scopes.map((s) => (
                        <Tag key={s}>{s.replace(/_/g, " ")}</Tag>
                    ))}
                </Space>
            ),
        },
        {
            title: "Embeds from",
            dataIndex: "allowed_embed_origins",
            responsive: ["lg"],
            render: (origins: string[]) =>
                origins.length === 0 ? (
                    // Not "none" as an absence — it is a REFUSAL. An empty
                    // allowlist means `api_envelopes_embed-url` rejects this key
                    // outright, which is different from "not configured yet" in
                    // a way an admin debugging a 403 needs to see.
                    <Tooltip title="This key cannot mint embedded signing links. An empty list is a refusal, not a wildcard.">
                        <Typography.Text type="secondary">—</Typography.Text>
                    </Tooltip>
                ) : (
                    <Space direction="vertical" size={0}>
                        {origins.map((o) => (
                            <Typography.Text key={o} style={{ fontSize: token.fontSizeSM }}>
                                {o}
                            </Typography.Text>
                        ))}
                    </Space>
                ),
        },
        {
            title: "Last used",
            dataIndex: "last_used_at",
            width: 160,
            render: (lastUsed: string | null, row) =>
                lastUsed ? (
                    new Date(lastUsed).toLocaleString()
                ) : (
                    <Tooltip
                        title={`Created ${new Date(row.created_at).toLocaleDateString()} and never used. Either the integration was never finished, or it is using a different key.`}
                    >
                        <Typography.Text type="secondary">Never</Typography.Text>
                    </Tooltip>
                ),
        },
        {
            title: "",
            key: "actions",
            width: 100,
            align: "right",
            render: (_v, row) =>
                statusOf(row) === "revoked" ? null : (
                    <Popconfirm
                        title="Revoke this key?"
                        // The confirm NAMES WHAT BREAKS. "Are you sure?" is not
                        // a question anyone can answer about a credential whose
                        // consumers they cannot see from here.
                        description={
                            <span style={{ maxWidth: 320, display: "inline-block" }}>
                                Any integration using <strong>{row.name}</strong> stops working
                                immediately, on its very next request. This cannot be undone — you
                                would have to create a new key and update whatever uses it.
                            </span>
                        }
                        okText="Revoke"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => mRevoke.mutation.mutate(row.id)}
                    >
                        <Button
                            size="small"
                            danger
                            type="text"
                            icon={<StopOutlined />}
                            loading={
                                mRevoke.mutation.isPending && mRevoke.mutation.variables === row.id
                            }
                        >
                            Revoke
                        </Button>
                    </Popconfirm>
                ),
        },
    ];

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
                    API keys let your own systems send and read documents without a person signing
                    in. Each key carries only the permissions you give it, and every action it takes
                    is recorded against the key by name in the document&rsquo;s audit trail.
                </Typography.Text>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                    New key
                </Button>
            </div>

            {qApiKeys.query.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="Could not load API keys"
                    description={
                        qApiKeys.query.error instanceof Error
                            ? qApiKeys.query.error.message
                            : undefined
                    }
                />
            )}

            {qApiKeys.query.isPending ? (
                <Skeleton active paragraph={{ rows: 4 }} />
            ) : qApiKeys.apiKeys.length === 0 ? (
                <Empty
                    image={
                        <KeyOutlined style={{ fontSize: 48, color: token.colorTextQuaternary }} />
                    }
                    description={
                        <Space direction="vertical" size={4}>
                            <Typography.Text strong>No API keys yet</Typography.Text>
                            <Typography.Text type="secondary">
                                Create one to let another system send documents on your behalf.
                            </Typography.Text>
                        </Space>
                    }
                />
            ) : (
                <Table<Tables_ApiKeys_Row>
                    rowKey="id"
                    columns={columns}
                    dataSource={qApiKeys.apiKeys}
                    pagination={false}
                    size={isMobile ? "small" : "middle"}
                    scroll={{ x: "max-content" }}
                />
            )}

            <Page_SettingsApiKeys_CreateModal
                open={createOpen}
                isSubmitting={mIssue.mutation.isPending}
                issuedKey={issuedKey}
                onCreate={handleCreate}
                onClose={closeCreate}
            />
        </Space>
    );
};
