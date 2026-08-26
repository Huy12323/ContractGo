import { useSearch } from "@tanstack/react-router";
import { App_LoginForm } from "@/components/auth/App_LoginForm";
import { Typography, theme } from "antd";
import { TeamOutlined } from "@ant-design/icons";

export const Page_Login = () => {
    const { token } = theme.useToken();
    const { redirect, error } = useSearch({ from: "/_auth/login" });

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
                <Typography.Text type="secondary">Sign in to your workspace</Typography.Text>
            </div>
            <App_LoginForm redirect={redirect} error={error} />
        </>
    );
};
