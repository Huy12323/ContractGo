import { useState } from "react";
import { Utils_String_GetInitials } from "@/utils/Utils_String_GetInitials";
import { useM_OrgSettings_InvitationCreate } from "@/hooks/useM_OrgSettings_InvitationCreate";
import { useM_OrgSettings_InvitationCancel } from "@/hooks/useM_OrgSettings_InvitationCancel";
import { useM_OrgSettings_OrganizationDelete } from "@/hooks/useM_OrgSettings_OrganizationDelete";
import { Modal, Tabs, Table, Input, Button, Avatar, Tag, Space, Typography, Alert } from "antd";
import { SendOutlined, DeleteOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import { useQ_Tables_OrgAdmins } from "@/hooks/useQ_Tables_OrgAdmins";
import { useQ_Tables_OrgInvitations } from "@/hooks/useQ_Tables_OrgInvitations";

interface OrgSettingsModalProps {
    open: boolean;
    onClose: () => void;
    organizationId: string;
    organizationName: string;
}

export const App_OrgSettingsModal = ({ open, onClose, organizationId, organizationName }: OrgSettingsModalProps) => {
    const [inviteEmail, setInviteEmail] = useState("");
    const [deleteConfirm, setDeleteConfirm] = useState("");

    const qAdmins = useQ_Tables_OrgAdmins({ organizationId });
    const qInvitations = useQ_Tables_OrgInvitations({ organizationId });
    const mInvitationCreate = useM_OrgSettings_InvitationCreate({ organizationId });
    const mInvitationCancel = useM_OrgSettings_InvitationCancel({ organizationId });
    const mOrganizationDelete = useM_OrgSettings_OrganizationDelete({ organizationId, onSuccess: onClose });

    function handleSendInvite() {
        const email = inviteEmail.trim().toLowerCase();
        if (!email) return;
        mInvitationCreate.mutation.mutate(email, {
            onSuccess: () => setInviteEmail(""),
        });
    }

    // Combined table: pending invitations first, then current admins
    const pendingRows = qInvitations.invitations.map((inv) => ({
        key: `inv-${inv.id}`,
        type: "invitation" as const,
        id: inv.id,
        name: null,
        email: inv.email,
        avatarUrl: null,
        expiresAt: inv.expires_at,
    }));

    const adminRows = qAdmins.admins.map((admin) => ({
        key: `admin-${admin.id}`,
        type: "admin" as const,
        id: admin.id,
        name: admin.profiles?.full_name ?? null,
        email: admin.profiles?.email ?? "",
        avatarUrl: admin.profiles?.avatar_url ?? null,
        expiresAt: null,
    }));

    const allRows = [...pendingRows, ...adminRows];

    const columns = [
        {
            title: "Member",
            key: "member",
            render: (_: unknown, record: (typeof allRows)[number]) => (
                <Space>
                    <Avatar size={28} style={{ backgroundColor: record.type === "invitation" ? "#faad14" : "#0958d9" }}>
                        {record.type === "invitation" ? "?" : Utils_String_GetInitials(record.name)}
                    </Avatar>
                    <div>
                        <Typography.Text strong style={{ display: "block", fontSize: 13 }}>
                            {record.type === "invitation" ? record.email : (record.name ?? "No name")}
                        </Typography.Text>
                        {record.type === "admin" && (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {record.email}
                            </Typography.Text>
                        )}
                    </div>
                </Space>
            ),
        },
        {
            title: "Status",
            key: "status",
            width: 120,
            render: (_: unknown, record: (typeof allRows)[number]) => {
                if (record.type === "invitation") {
                    const expired = record.expiresAt ? new Date(record.expiresAt) < new Date() : false;
                    return expired ? <Tag color="red">Expired</Tag> : <Tag color="orange">Pending</Tag>;
                }
                return <Tag color="blue">Active</Tag>;
            },
        },
        {
            title: "",
            key: "action",
            width: 60,
            render: (_: unknown, record: (typeof allRows)[number]) => {
                if (record.type !== "invitation") return null;
                return (
                    <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        loading={mInvitationCancel.mutation.isPending}
                        onClick={() => mInvitationCancel.mutation.mutate(record.id)}
                    />
                );
            },
        },
    ];

    const deleteEnabled = deleteConfirm === organizationName;

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={`${organizationName} — Settings`}
            footer={null}
            width="80vw"
            styles={{ body: { height: "70vh", overflow: "auto" } }}
            destroyOnHidden
        >
            <Tabs
                style={{ height: "100%" }}
                items={[
                    {
                        key: "admins",
                        label: "Admins",
                        children: (
                            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                <div style={{ display: "flex", gap: 0 }}>
                                    <Input
                                        placeholder="Invite by email address"
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        onPressEnter={handleSendInvite}
                                        disabled={mInvitationCreate.mutation.isPending}
                                        style={{ borderRadius: "4px 0 0 4px", height: 36 }}
                                    />
                                    <Button
                                        type="primary"
                                        icon={<SendOutlined />}
                                        loading={mInvitationCreate.mutation.isPending}
                                        onClick={handleSendInvite}
                                        style={{ borderRadius: "0 4px 4px 0", height: 36 }}
                                    >
                                        Send Invite
                                    </Button>
                                </div>
                                <Table
                                    dataSource={allRows}
                                    columns={columns}
                                    rowKey="key"
                                    loading={qAdmins.query.isLoading || qInvitations.query.isLoading}
                                    pagination={false}
                                    size="small"
                                    locale={{ emptyText: "No admins yet — send an invitation above" }}
                                />
                            </div>
                        ),
                    },
                    {
                        key: "general",
                        label: "General",
                        children: (
                            <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 480 }}>
                                <Typography.Text type="secondary">More settings coming soon.</Typography.Text>
                            </div>
                        ),
                    },
                    {
                        key: "danger",
                        label: <span style={{ color: "#ff4d4f" }}>Danger Zone</span>,
                        children: (
                            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                <Alert
                                    type="error"
                                    showIcon
                                    icon={<ExclamationCircleOutlined />}
                                    message="Delete this organization"
                                    description={
                                        <div>
                                            <Typography.Text type="secondary">
                                                Permanently delete <strong>{organizationName}</strong> and all associated data including admins, employees, and
                                                invitations. This action cannot be undone.
                                            </Typography.Text>
                                            <div style={{ marginTop: 16 }}>
                                                <Typography.Text style={{ fontSize: 13, display: "block", marginBottom: 8 }}>
                                                    Type <strong>{organizationName}</strong> to confirm:
                                                </Typography.Text>
                                                <Input
                                                    placeholder={organizationName}
                                                    value={deleteConfirm}
                                                    onChange={(e) => setDeleteConfirm(e.target.value)}
                                                    style={{ marginBottom: 12, maxWidth: 320 }}
                                                />
                                                <div>
                                                    <Button
                                                        danger
                                                        type="primary"
                                                        disabled={!deleteEnabled}
                                                        loading={mOrganizationDelete.mutation.isPending}
                                                        onClick={() => mOrganizationDelete.mutation.mutate()}
                                                    >
                                                        Delete Organization
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    }
                                />
                            </div>
                        ),
                    },
                ]}
            />
        </Modal>
    );
};
