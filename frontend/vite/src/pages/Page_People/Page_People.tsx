import { useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
    Avatar,
    Button,
    Card,
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
import { DeleteOutlined, SendOutlined, UserAddOutlined } from "@ant-design/icons";
import { Page_People_InviteModal } from "@/pages/Page_People/Page_People_InviteModal";
import { Page_People_PersonDrawer } from "@/pages/Page_People/Page_People_PersonDrawer";
import type { PersonRow } from "@/pages/Page_People/Page_People_Row";
import { Page_People_PermissionIcons } from "@/pages/Page_People/Page_People_PermissionIcons";
import { ROLE_TAG, STATUS_TAG } from "@/pages/Page_People/Page_People_Row";
import { useM_People_InvitationCancel } from "@/hooks/useM_People_InvitationCancel";
import { useM_People_InvitationCreate } from "@/hooks/useM_People_InvitationCreate";
import type { InvitationRole } from "@/hooks/useM_People_InvitationCreate";
import { useQ_Tables_Admins } from "@/hooks/useQ_Tables_Admins";
import { useQ_Tables_Invitations } from "@/hooks/useQ_Tables_Invitations";
import { useQ_Tables_Members } from "@/hooks/useQ_Tables_Members";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";
import { useQ_Tables_OrganizationOwner } from "@/hooks/useQ_Tables_OrganizationOwner";
import { useQ_Tables_MyOrganizations } from "@/hooks/useQ_Tables_MyOrganizations";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Avatar_Src } from "@/utils/Utils_Avatar_Src";
import { Utils_String_GetInitials } from "@/utils/Utils_String_GetInitials";

/**
 * Everyone in the organization, and everyone on their way in.
 *
 * ONE TABLE, not one per tier. An invitation is a person who will shortly be in
 * the list, and splitting them off means the answer to "is Dana in this
 * workspace?" depends on which panel you happened to look at. The `status`
 * column carries the difference instead.
 *
 * The tiers come from three different places by design — the owner is a column
 * on `organizations`, admins and members are their own tables — so the merge
 * happens here rather than in a view. That is the membership model, not an
 * accident: see .claude/skills/ext-supabase-auth/SKILL.md.
 */
export const Page_People = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const navigate = useNavigate();
    const { organizationId } = useParams({ from: "/_protected/$organizationId/people/" });
    const [inviteOpen, setInviteOpen] = useState(false);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);

    const qOrganizations = useQ_Tables_MyOrganizations();
    const organizationName =
        qOrganizations.organizations.find((o) => o.id === organizationId)?.name ??
        "this organization";

    const qRole = useQ_Tables_MyRole({ organizationId });
    const canInvite = qRole.role === "owner" || qRole.role === "admin";

    const qOwner = useQ_Tables_OrganizationOwner({ organizationId });
    const qAdmins = useQ_Tables_Admins({ organizationId });
    const qMembers = useQ_Tables_Members({ organizationId });
    const qInvitations = useQ_Tables_Invitations({ organizationId });

    const mInvitationCreate = useM_People_InvitationCreate({ organizationId });
    const mInvitationCancel = useM_People_InvitationCancel({ organizationId });

    const rows = useMemo<PersonRow[]>(() => {
        const ownerProfile = qOwner.owner?.profiles as
            | {
                  full_name: string | null;
                  email: string | null;
                  avatar_url: string | null;
                  files?: { r2_key: string } | { r2_key: string }[] | null;
              }
            | null
            | undefined;

        const ownerRow: PersonRow[] = qOwner.owner
            ? [
                  {
                      // Keyed by USER, not by tier. The drawer is resolved out of `rows`
                      // by key, and a tier-derived key (`member-…` → `admin-…`) changes
                      // the instant a role does — which would slam the drawer shut on the
                      // person whose role you just changed. Removal still closes it,
                      // because then the row really is gone.
                      key: `user-${qOwner.owner.owner_id}`,
                      invitationId: null,
                      userId: qOwner.owner.owner_id,
                      name: ownerProfile?.full_name ?? null,
                      email: ownerProfile?.email ?? "",
                      avatarUrl: Utils_Avatar_Src(ownerProfile) ?? null,
                      role: "owner",
                      status: "active",
                      invitedAt: null,
                      expiresAt: null,
                      // Held by tier, not by flag — the owner has no `members` row to
                      // read one off. Same for the admins below.
                      canManageTemplates: true,
                      canSendDocuments: true,
                  },
              ]
            : [];

        const adminRows: PersonRow[] = qAdmins.admins.map((admin) => ({
            key: `user-${admin.user_id}`,
            invitationId: null,
            userId: admin.user_id,
            name: admin.profiles?.full_name ?? null,
            email: admin.profiles?.email ?? "",
            avatarUrl: Utils_Avatar_Src(admin.profiles) ?? null,
            role: "admin",
            status: "active",
            invitedAt: null,
            expiresAt: null,
            canManageTemplates: true,
            canSendDocuments: true,
        }));

        const memberRows: PersonRow[] = qMembers.members.map((member) => ({
            key: `user-${member.user_id}`,
            invitationId: null,
            userId: member.user_id,
            // The profile name is preferred, but a just-accepted member may not have
            // one yet — `members.email` is what the invitation was addressed to and is
            // always there.
            name: member.profiles?.full_name ?? null,
            email: member.profiles?.email ?? member.email ?? "",
            avatarUrl: Utils_Avatar_Src(member.profiles) ?? null,
            role: "member",
            status: "active",
            invitedAt: null,
            expiresAt: null,
            canManageTemplates: member.can_manage_templates,
            canSendDocuments: member.can_send_documents,
        }));

        const invitationRows: PersonRow[] = qInvitations.invitations.map((invitation) => ({
            key: `invitation-${invitation.id}`,
            invitationId: invitation.id,
            // Nobody has accepted, so there is no auth user to change a role on or
            // remove — the drawer offers resend and cancel for these rows instead.
            userId: null,
            name: null,
            email: invitation.email,
            avatarUrl: null,
            role: invitation.role === "admin" ? "admin" : "member",
            status:
                invitation.status === "rejected"
                    ? "declined"
                    : new Date(invitation.expires_at) < new Date()
                      ? "expired"
                      : "pending",
            invitedAt: invitation.created_at,
            expiresAt: invitation.expires_at,
            // An invitation to the admin tier carries both permissions the moment it
            // is accepted; one to the member tier carries none until somebody grants
            // them, which is why the invite modal has no permission controls.
            canManageTemplates: invitation.role === "admin",
            canSendDocuments: invitation.role === "admin",
        }));

        // Pending first: they are the rows that need someone to do something.
        return [...invitationRows, ...ownerRow, ...adminRows, ...memberRows];
    }, [qOwner.owner, qAdmins.admins, qMembers.members, qInvitations.invitations]);

    // Shared by the table's actions column and the card list, so resend/cancel
    // cannot end up behaving differently depending on the width of the screen.
    //
    // The row (and the card) opens the drawer, so anything clickable inside it has
    // to stop the click from reaching its parent — otherwise cancelling an
    // invitation also opens a drawer for the row being cancelled.
    const renderInvitationActions = (record: PersonRow) => {
        if (!record.invitationId || !canInvite) return null;
        return (
            <Space size={0} onClick={(e) => e.stopPropagation()}>
                <Tooltip title="Send the invitation again with a fresh link">
                    <Button
                        type="text"
                        size="small"
                        icon={<SendOutlined />}
                        loading={mInvitationCreate.mutation.isPending}
                        onClick={() =>
                            mInvitationCreate.mutation.mutate({
                                email: record.email,
                                role: record.role as InvitationRole,
                            })
                        }
                    />
                </Tooltip>
                <Popconfirm
                    title="Cancel this invitation?"
                    description="The link they were sent will stop working."
                    okText="Cancel invitation"
                    okButtonProps={{ danger: true }}
                    cancelText="Keep"
                    onConfirm={() => mInvitationCancel.mutation.mutate(record.invitationId!)}
                >
                    <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        loading={mInvitationCancel.mutation.isPending}
                    />
                </Popconfirm>
            </Space>
        );
    };

    const columns: ColumnsType<PersonRow> = [
        {
            title: "Person",
            key: "person",
            render: (_, record) => (
                <Space>
                    <Avatar
                        size={32}
                        src={record.avatarUrl ?? undefined}
                        style={{
                            backgroundColor: record.invitationId
                                ? token.colorWarning
                                : token.colorPrimary,
                        }}
                    >
                        {record.invitationId ? "?" : Utils_String_GetInitials(record.name)}
                    </Avatar>
                    <div>
                        <Typography.Text strong style={{ display: "block", fontSize: 13 }}>
                            {record.name ?? record.email}
                        </Typography.Text>
                        {record.name && (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {record.email}
                            </Typography.Text>
                        )}
                    </div>
                </Space>
            ),
        },
        {
            title: "Role",
            key: "role",
            width: 120,
            render: (_, record) => (
                <Tag color={ROLE_TAG[record.role].color}>{ROLE_TAG[record.role].label}</Tag>
            ),
        },
        {
            // CG-027. Its own column rather than tags beside the role, so the icons
            // line up down the page: "who can send?" should be one glance at one
            // position, not a read of every row's tag list. The header is a word
            // because the icons alone would leave the column unnamed.
            title: "Permissions",
            key: "permissions",
            width: 110,
            render: (_, record) => <Page_People_PermissionIcons row={record} />,
        },
        {
            title: "Status",
            key: "status",
            width: 120,
            render: (_, record) => (
                <Tag color={STATUS_TAG[record.status].color}>{STATUS_TAG[record.status].label}</Tag>
            ),
        },
        {
            title: "",
            key: "actions",
            width: 100,
            align: "right",
            render: (_, record) => renderInvitationActions(record),
        },
    ];

    // Resolved from `rows` rather than held in state, so a person who is removed
    // — by this tab or another one — takes their drawer with them instead of
    // leaving it open over a row that no longer exists.
    const selectedRow = rows.find((row) => row.key === selectedKey) ?? null;

    const loading =
        qOwner.query.isLoading ||
        qAdmins.query.isLoading ||
        qMembers.query.isLoading ||
        qInvitations.query.isLoading;

    // Shared by the table's `locale.emptyText` and the card list, so the two
    // surfaces cannot end up explaining an empty organization differently.
    const emptyDescription = canInvite
        ? "Nobody here yet — invite someone to get started"
        : "Nobody here yet";

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
                    People
                </Typography.Title>
                {canInvite && (
                    <Button
                        type="primary"
                        icon={<UserAddOutlined />}
                        onClick={() => setInviteOpen(true)}
                    >
                        {isMobile ? "Invite" : "Invite people"}
                    </Button>
                )}
            </div>

            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    padding: isMobile ? token.paddingSM : token.paddingMD,
                }}
            >
                {/* CARDS ON A PHONE, NOT A SQUASHED TABLE. The columns below carry fixed
            widths, so at 390px ANTD keeps the table wide and the pane scrolls
            sideways — reading one person means panning past their own name. The
            card stacks the same four facts, which is what a phone is shaped for. */}
                {isMobile ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
                        {loading && <Skeleton active paragraph={{ rows: 6 }} />}

                        {!loading && rows.length === 0 && (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={emptyDescription}
                            />
                        )}

                        {!loading &&
                            rows.map((record) => (
                                <Card
                                    key={record.key}
                                    size="small"
                                    hoverable
                                    onClick={() => setSelectedKey(record.key)}
                                    styles={{
                                        body: {
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: token.marginXS,
                                        },
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: token.marginSM,
                                        }}
                                    >
                                        <Avatar
                                            size={32}
                                            src={record.avatarUrl ?? undefined}
                                            style={{
                                                backgroundColor: record.invitationId
                                                    ? token.colorWarning
                                                    : token.colorPrimary,
                                                flexShrink: 0,
                                            }}
                                        >
                                            {record.invitationId
                                                ? "?"
                                                : Utils_String_GetInitials(record.name)}
                                        </Avatar>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <Typography.Text
                                                strong
                                                ellipsis
                                                style={{ display: "block" }}
                                            >
                                                {record.name ?? record.email}
                                            </Typography.Text>
                                            {record.name && (
                                                <Typography.Text
                                                    type="secondary"
                                                    ellipsis
                                                    style={{
                                                        display: "block",
                                                        fontSize: token.fontSizeSM,
                                                    }}
                                                >
                                                    {record.email}
                                                </Typography.Text>
                                            )}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            flexWrap: "wrap",
                                            gap: token.marginXS,
                                        }}
                                    >
                                        <Tag
                                            color={ROLE_TAG[record.role].color}
                                            style={{ marginInlineEnd: 0 }}
                                        >
                                            {ROLE_TAG[record.role].label}
                                        </Tag>
                                        <Tag
                                            color={STATUS_TAG[record.status].color}
                                            style={{ marginInlineEnd: 0 }}
                                        >
                                            {STATUS_TAG[record.status].label}
                                        </Tag>
                                        {/* The card has no columns to align down, so the icons sit
                        with the tags they qualify rather than in a slot. */}
                                        <Page_People_PermissionIcons row={record} />
                                        <div style={{ marginLeft: "auto" }}>
                                            {renderInvitationActions(record)}
                                        </div>
                                    </div>
                                </Card>
                            ))}
                    </div>
                ) : (
                    <Table
                        dataSource={rows}
                        columns={columns}
                        rowKey="key"
                        loading={loading}
                        pagination={false}
                        size="small"
                        // The columns carry fixed widths; without this ANTD squeezes them into
                        // the pane instead of letting the table scroll, and on a narrow screen
                        // the name column collapses to a couple of characters.
                        scroll={{ x: "max-content" }}
                        onRow={(record) => ({
                            onClick: () => setSelectedKey(record.key),
                            style: { cursor: "pointer" },
                        })}
                        locale={{ emptyText: emptyDescription }}
                    />
                )}
            </div>

            <Page_People_InviteModal
                open={inviteOpen}
                onClose={() => setInviteOpen(false)}
                organizationId={organizationId}
                organizationName={organizationName}
            />

            <Page_People_PersonDrawer
                open={!!selectedRow}
                onClose={() => setSelectedKey(null)}
                organizationId={organizationId}
                row={selectedRow}
                // Leaving revokes access to this route, and the layout guard only runs
                // on navigation — without this the page stays up until a reload.
                onSelfRemoved={() => navigate({ to: "/" })}
            />
        </div>
    );
};
