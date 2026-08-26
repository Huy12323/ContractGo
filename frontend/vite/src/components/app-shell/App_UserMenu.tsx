import { useState } from "react";
import { useMatch, useNavigate } from "@tanstack/react-router";
import { Avatar, Badge, Button, Divider, Dropdown, Tag, Typography, theme } from "antd";
import { KeyOutlined, LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { App_ProfilePasswordModal } from "@/components/profile/App_ProfilePasswordModal";
import { useQ_Me } from "@/hooks/useQ_Me";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";
import { Store_Auth_Actions, useStore_Auth_Session } from "@/stores/Store_Auth";
import { Utils_Avatar_Src } from "@/utils/Utils_Avatar_Src";
import { Utils_String_GetInitials } from "@/utils/Utils_String_GetInitials";

/** `owner` → `Owner`. The RPC returns a bare string, so this is display-only
 *  formatting rather than an options file for a column that has no enum. */
const formatRole = (role: string) =>
    role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, " ");

/**
 * The account menu: who you are signed in as, and the three things you can do
 * about it.
 *
 * WHY THE PROFILE IS NOW A ROUTE AND THE PASSWORD IS STILL A MODAL. This menu
 * used to open both as modals, on the reasoning that an account route would have
 * to be org-agnostic — a shape the shell had no precedent for, since
 * `App_VerticalNav` renders nothing outside an organization. CG-029 changed the
 * balance rather than the reasoning: the saved signature library is a card grid
 * that does not fit in a 420px dialog, so a real account page had to exist, and
 * once it did the profile form belonged on it. The half-built chrome is the cost,
 * and `/_protected/` (the organization picker) already looks that way.
 *
 * The PASSWORD form stays a modal because nothing about it wanted a page: it is a
 * short transaction with its own success and failure, launched from here and from
 * Settings, and it returns the user exactly where they were.
 */
export const App_UserMenu = () => {
    const { token } = theme.useToken();
    const qMe = useQ_Me();
    const session = useStore_Auth_Session();

    const [passwordOpen, setPasswordOpen] = useState(false);
    const navigate = useNavigate();

    // One match, two answers: whether we are inside an organization at all, and
    // which one. `shouldThrow: false` is what makes this legal off-org.
    const organizationId =
        useMatch({
            from: "/_protected/$organizationId",
            shouldThrow: false,
            select: (m) => m.params.organizationId,
        }) ?? null;

    // `enabled: !!organizationId` inside the hook, so the off-org case is an idle
    // query rather than an error.
    const qRole = useQ_Tables_MyRole({ organizationId: organizationId ?? "" });

    const displayName = qMe.profile?.full_name ?? qMe.profile?.email ?? "User";
    const initials = Utils_String_GetInitials(qMe.profile?.full_name);

    const panel = (
        <div
            style={{
                // See the note in `App_NotificationPanel`: unchanged on desktop, clamped
                // to the viewport on a narrow screen.
                width: "min(264px, calc(100vw - 32px))",
                background: token.colorBgElevated,
                borderRadius: token.borderRadiusLG,
                boxShadow: token.boxShadowSecondary,
                padding: token.paddingSM,
            }}
        >
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                Welcome back!
            </Typography.Text>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginSM,
                    marginTop: token.marginXS,
                }}
            >
                {/* The dot reports that a SESSION exists, which is the only thing this
            client can actually know — it is not presence, and there is no
            heartbeat behind it. The tooltip says exactly that much so the green
            circle is not read as a claim the app cannot support. */}
                <Badge
                    dot={!!session}
                    color={token.colorSuccess}
                    offset={[-4, 34]}
                    title={session ? "Signed in" : undefined}
                >
                    <Avatar
                        size={40}
                        src={Utils_Avatar_Src(qMe.profile)}
                        style={{ backgroundColor: token.colorPrimaryBg, color: token.colorPrimary }}
                    >
                        {initials}
                    </Avatar>
                </Badge>

                <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <Typography.Text strong ellipsis>
                        {displayName}
                    </Typography.Text>
                    {qMe.profile?.email && (
                        <Typography.Text
                            type="secondary"
                            ellipsis
                            style={{ fontSize: token.fontSizeSM }}
                        >
                            {qMe.profile.email}
                        </Typography.Text>
                    )}
                    {/* Only when there IS a role. Rendering "No role" outside an
              organization would read as a permissions problem rather than as
              "this question does not apply here". */}
                    {qRole.role && (
                        <Tag
                            color="blue"
                            style={{ marginInlineEnd: 0, marginTop: 4, alignSelf: "flex-start" }}
                        >
                            {formatRole(qRole.role)}
                        </Tag>
                    )}
                </div>
            </div>

            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Button
                type="text"
                block
                icon={<KeyOutlined />}
                style={{ textAlign: "left", justifyContent: "flex-start" }}
                onClick={() => setPasswordOpen(true)}
            >
                Update password
            </Button>
            <Button
                type="text"
                block
                icon={<UserOutlined />}
                style={{ textAlign: "left", justifyContent: "flex-start" }}
                onClick={() => navigate({ to: "/settings" })}
            >
                Personal information
            </Button>
            <Button
                type="text"
                block
                danger
                icon={<LogoutOutlined />}
                style={{ textAlign: "left", justifyContent: "flex-start" }}
                onClick={() => Store_Auth_Actions.signOut()}
            >
                Logout
            </Button>
        </div>
    );

    return (
        <>
            {/* Click, not hover. This panel holds three buttons and launches two
          modals; opening it by accident on the way to something else is a
          mis-fire generator, and a hover-only trigger cannot be reached from the
          keyboard at all. */}
            <Dropdown popupRender={() => panel} trigger={["click"]} placement="bottomRight">
                <Avatar
                    size={28}
                    src={Utils_Avatar_Src(qMe.profile)}
                    style={{
                        backgroundColor: token.colorPrimaryBg,
                        color: token.colorPrimary,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 600,
                    }}
                >
                    {initials}
                </Avatar>
            </Dropdown>

            <App_ProfilePasswordModal
                open={passwordOpen}
                onClose={() => setPasswordOpen(false)}
                email={qMe.profile?.email ?? null}
            />
        </>
    );
};
