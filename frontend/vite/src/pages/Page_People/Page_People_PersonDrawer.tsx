import {
    Avatar,
    Button,
    Descriptions,
    Divider,
    Drawer,
    Popconfirm,
    Select,
    Space,
    Switch,
    Tag,
    Typography,
    theme,
} from "antd";
import { DeleteOutlined, FileTextOutlined, LogoutOutlined, SendOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { PersonRow } from "@/pages/Page_People/Page_People_Row";
import { ROLE_TAG, STATUS_TAG } from "@/pages/Page_People/Page_People_Row";
import type { InvitationRole } from "@/hooks/useM_People_InvitationCreate";
import { useM_People_InvitationCancel } from "@/hooks/useM_People_InvitationCancel";
import { useM_People_InvitationCreate } from "@/hooks/useM_People_InvitationCreate";
import { useM_People_OwnershipTransfer } from "@/hooks/useM_People_OwnershipTransfer";
import { useM_People_Remove } from "@/hooks/useM_People_Remove";
import { useM_People_PermissionsSet } from "@/hooks/useM_People_PermissionsSet";
import { useM_People_RoleChange } from "@/hooks/useM_People_RoleChange";
import type { People_RoleChange_Role } from "@/hooks/useM_People_RoleChange";
import { useQ_Me } from "@/hooks/useQ_Me";
import { useQ_People_Person } from "@/hooks/useQ_People_Person";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";
import { Utils_String_GetInitials } from "@/utils/Utils_String_GetInitials";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

type Props = {
    open: boolean;
    onClose: () => void;
    organizationId: string;
    row: PersonRow | null;
    /** Called after the viewer removes themselves — the page navigates away. */
    onSelfRemoved: () => void;
};

const formatDate = (value: string | null | undefined) =>
    value ? dayjs(value).format("D MMM YYYY") : "—";

/**
 * One person, and everything that can be done to their membership.
 *
 * The destructive actions live here rather than as buttons on the table row on
 * purpose: removing somebody or changing what they can do should cost a
 * deliberate click to reach, and the drawer is where the viewer can see who
 * they are actually acting on. Invitation resend/cancel stay on the row too —
 * those are cheap and reversible.
 *
 * Every button below is mirrored by a check inside the CG-023 RPCs. Hiding one
 * is a courtesy so nobody clicks into a refusal; it is not the enforcement.
 */
export const Page_People_PersonDrawer = ({
    open,
    onClose,
    organizationId,
    row,
    onSelfRemoved,
}: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();

    const qMe = useQ_Me();
    const qRole = useQ_Tables_MyRole({ organizationId });
    const qPerson = useQ_People_Person({
        organizationId,
        userId: row?.userId ?? null,
        enabled: open,
    });

    const mRoleChange = useM_People_RoleChange({ organizationId });
    const mPermissionsSet = useM_People_PermissionsSet({ organizationId });
    const mRemove = useM_People_Remove({ organizationId });
    const mOwnershipTransfer = useM_People_OwnershipTransfer({ organizationId });
    const mInvitationCreate = useM_People_InvitationCreate({ organizationId });
    const mInvitationCancel = useM_People_InvitationCancel({ organizationId });

    if (!row) return null;

    const label = row.name ?? row.email;
    const myRole = qRole.role;
    const isSelf = !!row.userId && qMe.profile?.id === row.userId;
    const isInvitation = !!row.invitationId;

    // The server's answer wins over the table's merge where both have one — the
    // drawer can be open across somebody else's role change.
    const targetRole = qPerson.person?.role ?? row.role;

    // Mirrors set_organization_role: an admin may promote a member, only the owner
    // may demote an admin, and the owner's own tier is not a tier that moves.
    const canChangeRole =
        !isInvitation &&
        !!row.userId &&
        (targetRole === "member"
            ? myRole === "owner" || myRole === "admin"
            : targetRole === "admin" && myRole === "owner");

    // Mirrors remove_from_organization.
    const canRemove =
        !isInvitation &&
        !!row.userId &&
        targetRole !== "owner" &&
        (isSelf ||
            (targetRole === "admin"
                ? myRole === "owner"
                : myRole === "owner" || myRole === "admin"));

    const canTransfer =
        !isInvitation && !!row.userId && !isSelf && myRole === "owner" && targetRole !== "owner";

    const canManageInvitations = myRole === "owner" || myRole === "admin";

    // CG-027 permissions.
    //
    // Shown for anybody already in the organization, including owners and admins,
    // whose switches read on and locked. Hiding the section for them would be the
    // more obvious choice and the wrong one: the question "why can this admin do
    // that?" is asked of the drawer, and a section that simply vanishes answers it
    // with silence. `get_organization_person` returns both flags true for them for
    // exactly this reason.
    const showPermissions = !isInvitation && !!row.userId;
    // Mirrors set_member_permissions: an admin or the owner may grant, and only a
    // member has flags to grant. An admin's grants come with the tier and move
    // only by changing the tier, which is the Select above.
    const canEditPermissions =
        showPermissions && targetRole === "member" && (myRole === "owner" || myRole === "admin");

    // The icons are the ones the People column and the nav both use, so the
    // switch that grants a permission is visibly the same thing as the icon that
    // reports it a click earlier.
    const permissions = [
        {
            key: "can_send_documents" as const,
            icon: <SendOutlined />,
            label: "Send documents",
            description: "Create, send, remind, void and delete drafts.",
            value: qPerson.person?.can_send_documents ?? false,
        },
        {
            key: "can_manage_templates" as const,
            icon: <FileTextOutlined />,
            label: "Manage templates",
            description: "Create, edit and archive the template library.",
            value: qPerson.person?.can_manage_templates ?? false,
        },
    ];

    // Both flags travel on every call because the RPC takes both — see
    // `useM_People_PermissionsSet`. The one not being toggled is read from the
    // server's answer rather than from local state, so two admins editing the same
    // person cannot silently revert each other's change.
    const handlePermissionToggle = (
        key: "can_send_documents" | "can_manage_templates",
        next: boolean
    ) =>
        mPermissionsSet.mutation.mutate({
            userId: row.userId as string,
            label,
            canSendDocuments:
                key === "can_send_documents" ? next : (qPerson.person?.can_send_documents ?? false),
            canManageTemplates:
                key === "can_manage_templates"
                    ? next
                    : (qPerson.person?.can_manage_templates ?? false),
        });

    const handleRemove = () =>
        mRemove.mutation.mutate(
            { userId: row.userId as string, label },
            {
                onSuccess: (data) => {
                    onClose();
                    if (data?.self) onSelfRemoved();
                },
            }
        );

    const items = [
        { key: "email", label: "Email", children: row.email || "—" },
        {
            key: "role",
            label: "Role",
            children: <Tag color={ROLE_TAG[targetRole].color}>{ROLE_TAG[targetRole].label}</Tag>,
        },
        {
            key: "status",
            label: "Status",
            children: (
                <Tag color={STATUS_TAG[row.status].color}>{STATUS_TAG[row.status].label}</Tag>
            ),
        },
        isInvitation
            ? { key: "invited", label: "Invited", children: formatDate(row.invitedAt) }
            : { key: "joined", label: "Joined", children: formatDate(qPerson.person?.joined_at) },
        isInvitation
            ? { key: "expires", label: "Expires", children: formatDate(row.expiresAt) }
            : { key: "phone", label: "Phone", children: qPerson.person?.phone || "—" },
    ];

    return (
        <Drawer
            open={open}
            onClose={onClose}
            // `'100%'` rather than `100vw`: a percentage of the drawer's container
            // respects the scrollbar, where a viewport unit would push past it.
            width={isMobile ? "100%" : 420}
            destroyOnHidden
            title={
                <Space>
                    <Avatar
                        size={40}
                        src={row.avatarUrl ?? undefined}
                        style={{
                            backgroundColor: isInvitation ? token.colorWarning : token.colorPrimary,
                        }}
                    >
                        {isInvitation ? "?" : Utils_String_GetInitials(row.name)}
                    </Avatar>
                    <div>
                        <Typography.Text strong style={{ display: "block" }}>
                            {label}
                        </Typography.Text>
                        {row.name && (
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: 12, fontWeight: 400 }}
                            >
                                {row.email}
                            </Typography.Text>
                        )}
                    </div>
                </Space>
            }
        >
            <Descriptions column={1} size="small" items={items} />

            {isInvitation && canManageInvitations && (
                <>
                    <Divider />
                    <Space direction="vertical" style={{ width: "100%" }}>
                        <Button
                            block
                            icon={<SendOutlined />}
                            loading={mInvitationCreate.mutation.isPending}
                            onClick={() =>
                                mInvitationCreate.mutation.mutate({
                                    email: row.email,
                                    role: row.role as InvitationRole,
                                })
                            }
                        >
                            Resend invitation
                        </Button>
                        <Popconfirm
                            title="Cancel this invitation?"
                            description="The link they were sent will stop working."
                            okText="Cancel invitation"
                            okButtonProps={{ danger: true }}
                            cancelText="Keep"
                            onConfirm={() =>
                                mInvitationCancel.mutation.mutate(row.invitationId as string, {
                                    onSuccess: onClose,
                                })
                            }
                        >
                            <Button
                                block
                                danger
                                icon={<DeleteOutlined />}
                                loading={mInvitationCancel.mutation.isPending}
                            >
                                Cancel invitation
                            </Button>
                        </Popconfirm>
                    </Space>
                </>
            )}

            {showPermissions && (
                <>
                    <Divider />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        Permissions
                    </Typography.Text>
                    <Space
                        direction="vertical"
                        size={token.marginSM}
                        style={{ width: "100%", marginTop: token.marginXS }}
                    >
                        {permissions.map((permission) => (
                            <div
                                key={permission.key}
                                style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: token.marginSM,
                                }}
                            >
                                <Switch
                                    size="small"
                                    // An owner or admin holds everything by tier, so their
                                    // switches show the truth and refuse the click rather than
                                    // rendering off, which would read as "denied".
                                    checked={targetRole === "member" ? permission.value : true}
                                    disabled={
                                        !canEditPermissions || mPermissionsSet.mutation.isPending
                                    }
                                    onChange={(next) =>
                                        handlePermissionToggle(permission.key, next)
                                    }
                                    style={{ marginTop: 3 }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <Typography.Text style={{ display: "block" }}>
                                        <span
                                            style={{
                                                marginInlineEnd: token.marginXS,
                                                color: (
                                                    targetRole === "member"
                                                        ? permission.value
                                                        : true
                                                )
                                                    ? token.colorPrimary
                                                    : token.colorTextQuaternary,
                                            }}
                                        >
                                            {permission.icon}
                                        </span>
                                        {permission.label}
                                    </Typography.Text>
                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                        {permission.description}
                                    </Typography.Text>
                                </div>
                            </div>
                        ))}
                        {targetRole !== "member" && (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {targetRole === "owner" ? "Owners" : "Admins"} have every
                                permission. Change their role to grant these individually.
                            </Typography.Text>
                        )}
                        {targetRole === "member" && !canEditPermissions && (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                Only an admin or the owner can change these.
                            </Typography.Text>
                        )}
                    </Space>
                </>
            )}

            {(canChangeRole || canTransfer || canRemove) && (
                <>
                    <Divider />
                    <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
                        {canChangeRole && (
                            <div>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                    Role
                                </Typography.Text>
                                <Select
                                    style={{ width: "100%", marginTop: token.marginXXS }}
                                    value={targetRole as People_RoleChange_Role}
                                    loading={mRoleChange.mutation.isPending}
                                    onChange={(role) =>
                                        mRoleChange.mutation.mutate({
                                            userId: row.userId as string,
                                            role,
                                            label,
                                        })
                                    }
                                    options={[
                                        { value: "member", label: "Member" },
                                        { value: "admin", label: "Admin" },
                                    ]}
                                />
                            </div>
                        )}

                        {canTransfer && (
                            <Popconfirm
                                title="Transfer ownership?"
                                description={`${label} becomes the owner and you become an admin. Only they can undo this.`}
                                okText="Transfer"
                                okButtonProps={{ danger: true }}
                                cancelText="Keep ownership"
                                onConfirm={() =>
                                    mOwnershipTransfer.mutation.mutate(
                                        { userId: row.userId as string, label },
                                        { onSuccess: onClose }
                                    )
                                }
                            >
                                <Button block loading={mOwnershipTransfer.mutation.isPending}>
                                    Transfer ownership
                                </Button>
                            </Popconfirm>
                        )}

                        {canRemove && (
                            <Popconfirm
                                title={isSelf ? "Leave this organization?" : `Remove ${label}?`}
                                description={
                                    isSelf
                                        ? "You will lose access immediately and need a new invitation to return."
                                        : "They lose access immediately. Documents they are already party to are unaffected."
                                }
                                okText={isSelf ? "Leave" : "Remove"}
                                okButtonProps={{ danger: true }}
                                cancelText="Cancel"
                                onConfirm={handleRemove}
                            >
                                <Button
                                    block
                                    danger
                                    icon={isSelf ? <LogoutOutlined /> : <DeleteOutlined />}
                                    loading={mRemove.mutation.isPending}
                                >
                                    {isSelf ? "Leave organization" : "Remove from organization"}
                                </Button>
                            </Popconfirm>
                        )}
                    </Space>
                </>
            )}
        </Drawer>
    );
};
