import { useSearch } from "@tanstack/react-router";
import { App_SignUpForm } from "@/components/auth/App_SignUpForm";
import { Typography, theme } from "antd";
import { TeamOutlined } from "@ant-design/icons";

export const Page_SignUp = () => {
    const { token } = theme.useToken();
    const { redirect } = useSearch({ from: "/_auth/signup" });

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
                <Typography.Text type="secondary">Create your workspace</Typography.Text>
            </div>
            <App_SignUpForm redirect={redirect} />
        </>
    );
};
