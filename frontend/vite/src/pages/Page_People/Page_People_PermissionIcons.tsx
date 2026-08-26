import { Space, Tooltip, theme } from "antd";
import { FileTextOutlined, SendOutlined } from "@ant-design/icons";
import type { PersonRow } from "@/pages/Page_People/Page_People_Row";

/**
 * The two CG-027 permissions, as a pair of icons.
 *
 * DELIBERATELY THE NAV'S OWN ICONS. `FileTextOutlined` is Templates in
 * `App_VerticalNav` and `SendOutlined` is Documents; reusing them means the
 * column needs no legend — the icon already means that section everywhere else
 * in the product, so "can they change Templates" is readable without a label.
 *
 * BOTH SLOTS ALWAYS RENDER, granted or not. Hiding the ungranted one would make
 * each row a different width and turn a vertical scan of the column into a
 * reading exercise; with fixed slots, "who can send?" is answered by looking
 * down one position. Off is a faint outline rather than a missing icon, which
 * is the difference between "not granted" and "no information".
 *
 * Pending invitations show what the person WILL hold on acceptance, at reduced
 * opacity and with the tooltip saying so — an admin invitation carries both, a
 * member invitation carries neither, and neither is in effect yet.
 */
export const Page_People_PermissionIcons = ({ row }: { row: PersonRow }) => {
    const { token } = theme.useToken();

    const isInvitation = !!row.invitationId;
    // Owners and admins hold both by tier and cannot have one taken away without
    // changing the tier — worth saying, because the icons look identical to a
    // member who was granted both.
    const byTier = row.role === "owner" || row.role === "admin";

    const permissions = [
        {
            key: "send",
            icon: <SendOutlined />,
            granted: row.canSendDocuments,
            noun: "send documents",
        },
        {
            key: "templates",
            icon: <FileTextOutlined />,
            granted: row.canManageTemplates,
            noun: "manage templates",
        },
    ];

    return (
        <Space size={token.marginXS}>
            {permissions.map((permission) => {
                const subject = isInvitation ? "They will be able to" : "Can";
                const negative = isInvitation ? "They will not be able to" : "Cannot";
                const reason =
                    byTier && permission.granted ? ` — ${row.role}s hold every permission` : "";

                return (
                    <Tooltip
                        key={permission.key}
                        title={`${permission.granted ? subject : negative} ${permission.noun}${reason}`}
                    >
                        <span
                            style={{
                                display: "inline-flex",
                                fontSize: 15,
                                lineHeight: 1,
                                color: permission.granted
                                    ? token.colorPrimary
                                    : token.colorTextQuaternary,
                                // Pending invitations describe a future state, so the whole pair
                                // sits back from the rows where the permission is live.
                                opacity: isInvitation ? 0.5 : 1,
                            }}
                        >
                            {permission.icon}
                        </span>
                    </Tooltip>
                );
            })}
        </Space>
    );
};
