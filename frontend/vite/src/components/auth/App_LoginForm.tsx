import { useState } from "react";
import { Alert, Form, Input, Button, Checkbox, Typography, Divider, theme } from "antd";
import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { Store_Auth_Actions } from "@/stores/Store_Auth";
import { useNavigate } from "@tanstack/react-router";
import { App_GoogleSignInButton } from "@/components/auth/App_GoogleSignInButton";

interface LoginValues {
    email: string;
    password: string;
    remember: boolean;
}

interface LoginFormProps {
    redirect?: string;
    /** `?error=` set by /auth/callback when the OAuth round trip produced no session. */
    error?: string;
}

export const App_LoginForm = ({ redirect: redirectTo, error: oauthError }: LoginFormProps) => {
    const [loading, setLoading] = useState(false);
    const { token } = theme.useToken();
    const navigate = useNavigate();
    const [form] = Form.useForm<LoginValues>();

    async function onFinish(values: LoginValues) {
        setLoading(true);
        try {
            await Store_Auth_Actions.signInWithPassword(values.email, values.password);
            navigate({ to: redirectTo || "/" });
        } catch (err) {
            const message = err instanceof Error ? err.message : "";

            if (message.includes("Email not confirmed")) {
                navigate({ to: "/verify-email" });
                return;
            }

            form.setFields([
                {
                    name: "password",
                    errors: [
                        message.includes("Invalid login credentials")
                            ? "Invalid email or password"
                            : "Unable to sign in. Please try again.",
                    ],
                },
            ]);
        } finally {
            setLoading(false);
        }
    }

    return (
        <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            initialValues={{ remember: true }}
            requiredMark={false}
        >
            {oauthError === "oauth_failed" && (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="Google sign-in didn't complete"
                    description="We couldn't finish signing you in with Google. Try again, or use your email and password."
                />
            )}

            <Form.Item
                name="email"
                label="Work Email"
                rules={[
                    { required: true, message: "Enter your email" },
                    { type: "email", message: "Enter a valid email" },
                ]}
            >
                <Input
                    prefix={<MailOutlined style={{ color: token.colorTextQuaternary }} />}
                    placeholder="you@company.com"
                    size="large"
                />
            </Form.Item>

            <Form.Item
                name="password"
                label="Password"
                rules={[{ required: true, message: "Enter your password" }]}
            >
                <Input.Password
                    prefix={<LockOutlined style={{ color: token.colorTextQuaternary }} />}
                    placeholder="Enter password"
                    size="large"
                />
            </Form.Item>

            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 24,
                }}
            >
                <Form.Item name="remember" valuePropName="checked" noStyle>
                    <Checkbox>Remember me</Checkbox>
                </Form.Item>
                <Typography.Link
                    style={{ fontSize: 13 }}
                    onClick={() => navigate({ to: "/forgot-password" })}
                >
                    Forgot password?
                </Typography.Link>
            </div>

            <Button type="primary" htmlType="submit" block size="large" loading={loading}>
                Sign In
            </Button>

            <Typography.Paragraph
                type="secondary"
                style={{ textAlign: "center", margin: "12px 0 0", fontSize: 12 }}
            >
                By signing in, you agree to our Terms of Service and Privacy Policy.
            </Typography.Paragraph>

            <Divider plain style={{ margin: "20px 0" }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    OR
                </Typography.Text>
            </Divider>

            <App_GoogleSignInButton redirect={redirectTo} label="Continue with Google" />

            <Button
                block
                size="large"
                style={{ marginTop: 12 }}
                onClick={() => navigate({ to: "/signup", search: { redirect: redirectTo } })}
            >
                Create a new account
            </Button>
        </Form>
    );
};
