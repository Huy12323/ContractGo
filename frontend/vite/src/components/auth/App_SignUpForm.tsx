import { useState } from "react";
import { App, Form, Input, Button, Typography, Divider, theme } from "antd";
import { LockOutlined, MailOutlined, UserOutlined } from "@ant-design/icons";
import { Store_Auth_Actions } from "@/stores/Store_Auth";
import { supabase } from "@/configs/supabase/config";
import { useNavigate } from "@tanstack/react-router";
import { POST_VERIFY_REDIRECT_KEY } from "@/configs/auth/postVerifyRedirect";
import { App_GoogleSignInButton } from "@/components/auth/App_GoogleSignInButton";

interface SignUpValues {
    fullName: string;
    email: string;
    password: string;
    confirmPassword: string;
}

interface SignUpFormProps {
    redirect?: string;
}

export const App_SignUpForm = ({ redirect: redirectTo }: SignUpFormProps) => {
    const [loading, setLoading] = useState(false);
    const { token } = theme.useToken();
    const { message: messageApi } = App.useApp();
    const navigate = useNavigate();
    const [form] = Form.useForm<SignUpValues>();

    async function onFinish(values: SignUpValues) {
        setLoading(true);
        try {
            await Store_Auth_Actions.signUp(values.email, values.password, values.fullName);
            const sb_FunctionsAuthSendVerification_Invoke = await supabase.functions.invoke(
                "auth_send-verification",
                { body: { type: "verification" } }
            );
            // Non-fatal: the account exists either way, and /verify-email offers a resend.
            if (sb_FunctionsAuthSendVerification_Invoke.error)
                console.error(
                    "Failed to send verification email:",
                    sb_FunctionsAuthSendVerification_Invoke.error
                );

            // Cross-tab fallback — if the user opens the verification email in a different tab,
            // the URL's `?redirect=` is lost but this localStorage value survives.
            if (redirectTo) localStorage.setItem(POST_VERIFY_REDIRECT_KEY, redirectTo);
            navigate({
                to: "/verify-email",
                search: { redirect: redirectTo },
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : "";
            if (msg.includes("already registered")) {
                form.setFields([{ name: "email", errors: ["This email is already registered"] }]);
            } else {
                messageApi.error(msg || "Sign up failed. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
            <Form.Item
                name="fullName"
                label="Full Name"
                rules={[{ required: true, message: "Enter your full name" }]}
            >
                <Input
                    prefix={<UserOutlined style={{ color: token.colorTextQuaternary }} />}
                    placeholder="Jane Smith"
                    size="large"
                />
            </Form.Item>

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
                rules={[
                    { required: true, message: "Enter a password" },
                    { min: 8, message: "At least 8 characters" },
                ]}
            >
                <Input.Password
                    prefix={<LockOutlined style={{ color: token.colorTextQuaternary }} />}
                    placeholder="Min. 8 characters"
                    size="large"
                />
            </Form.Item>

            <Form.Item
                name="confirmPassword"
                label="Confirm Password"
                dependencies={["password"]}
                rules={[
                    { required: true, message: "Confirm your password" },
                    ({ getFieldValue }) => ({
                        validator(_, value) {
                            if (!value || getFieldValue("password") === value) {
                                return Promise.resolve();
                            }
                            return Promise.reject(new Error("Passwords don't match"));
                        },
                    }),
                ]}
            >
                <Input.Password
                    prefix={<LockOutlined style={{ color: token.colorTextQuaternary }} />}
                    placeholder="Re-enter password"
                    size="large"
                />
            </Form.Item>

            <Button
                type="primary"
                htmlType="submit"
                block
                size="large"
                loading={loading}
                style={{ marginTop: 8 }}
            >
                Create Account
            </Button>

            <Typography.Paragraph
                type="secondary"
                style={{ textAlign: "center", margin: "12px 0 0", fontSize: 12 }}
            >
                By creating an account, you agree to our Terms of Service and Privacy Policy.
            </Typography.Paragraph>

            <Divider plain style={{ margin: "20px 0" }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    OR
                </Typography.Text>
            </Divider>

            <App_GoogleSignInButton redirect={redirectTo} label="Sign up with Google" />

            <Button
                block
                size="large"
                style={{ marginTop: 12 }}
                onClick={() => navigate({ to: "/login", search: { redirect: redirectTo } })}
            >
                Sign in to existing account
            </Button>
        </Form>
    );
};
