import { App, Button, Result, Typography, theme } from "antd";
import {
    ClockCircleOutlined,
    LogoutOutlined,
    ReloadOutlined,
    TeamOutlined,
} from "@ant-design/icons";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQ_Me_Whitelisted } from "@/hooks/useQ_Me_Whitelisted";
import { Store_Auth_Actions, useStore_Auth_User } from "@/stores/Store_Auth";

// CG-027. Renders inside the `_auth` centred card, so it supplies content only.
//
// The account exists and the email is verified — the only thing missing is an
// operator adding the address to `public.whitelist`. That happens out of band
// and with no signal back to the browser, hence the manual re-check below rather
// than polling or a realtime subscription (the table has no RLS policies, so
// realtime could never deliver to this user anyway).
export const Page_PendingAccess = () => {
    const { token } = theme.useToken();
    const { message: messageApi } = App.useApp();
    const navigate = useNavigate();
    const user = useStore_Auth_User();
    const qWhitelisted = useQ_Me_Whitelisted();

    const [checking, setChecking] = useState(false);

    const handleCheckAgain = async () => {
        if (checking) return;
        setChecking(true);
        try {
            const result = await qWhitelisted.query.refetch();
            if (result.data) {
                navigate({ to: "/home" });
                return;
            }
            messageApi.info("Your account has not been approved yet.");
        } catch {
            messageApi.error("Could not check your access. Please try again.");
        } finally {
            setChecking(false);
        }
    };

    return (
        <>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
                <div
                    style={{
                        width: 48,
                        height: 48,
                        borderRadius: 10,
                        background: token.colorPrimary,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 16,
                    }}
                >
                    <TeamOutlined style={{ fontSize: 24, color: token.colorWhite }} />
                </div>
                <Typography.Title level={4} style={{ marginBottom: 0 }}>
                    ContractGo
                </Typography.Title>
            </div>

            <Result
                icon={<ClockCircleOutlined style={{ color: token.colorWarning }} />}
                title="Access pending approval"
                subTitle={
                    <>
                        <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                            Your account has been created, but ContractGo is currently limited to
                            approved accounts. An administrator needs to approve yours before you
                            can continue.
                        </Typography.Paragraph>
                        {/* Shown so somebody who signed in with the wrong address of two can
                see that immediately, rather than waiting on an approval that was
                granted to their other one. */}
                        {user?.email && (
                            <Typography.Paragraph
                                type="secondary"
                                style={{ fontSize: 12, marginBottom: 0 }}
                            >
                                Signed in as <Typography.Text strong>{user.email}</Typography.Text>
                            </Typography.Paragraph>
                        )}
                    </>
                }
                style={{ padding: "0 0 16px" }}
            />

            <Button
                type="primary"
                block
                size="large"
                icon={<ReloadOutlined />}
                loading={checking}
                onClick={handleCheckAgain}
            >
                Check again
            </Button>

            <div style={{ textAlign: "center", marginTop: 16 }}>
                <Button
                    type="text"
                    icon={<LogoutOutlined />}
                    onClick={() => Store_Auth_Actions.signOut()}
                    style={{ fontSize: 13, color: token.colorTextSecondary }}
                >
                    Sign out
                </Button>
            </div>
        </>
    );
};
