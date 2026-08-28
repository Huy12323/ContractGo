import { useState, useEffect } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { App, Button, Result, Typography, Spin, theme } from "antd";
import { MailOutlined, TeamOutlined, LogoutOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { supabase } from "@/configs/supabase/config";
import { Store_Auth_Actions } from "@/stores/Store_Auth";
import {
    consumePostVerifyRedirect,
    POST_VERIFY_REDIRECT_KEY,
} from "@/configs/auth/postVerifyRedirect";

export const Page_VerifyEmail = () => {
    const { token: searchToken, redirect } = useSearch({ from: "/_auth/verify-email" });

    return searchToken ? (
        <TokenVerification token={searchToken} redirectTo={redirect} />
    ) : (
        <WaitingForEmail redirectTo={redirect} />
    );
};

// supabase.functions.invoke wraps non-2xx responses in a FunctionsHttpError whose
// .message is always "Edge Function returned a non-2xx status code" — useless to users.
// The real message lives in the underlying Response's JSON body, accessible via
// the SDK's undocumented `.context` property. This helper extracts it, with a
// friendly fallback if anything about the parsing fails.
const extractEdgeFunctionErrorMessage = async (
    error: unknown,
    fallback: string
): Promise<string> => {
    if (!error || typeof error !== "object") return fallback;
    const ctx = (error as { context?: Response }).context;
    if (!ctx || typeof ctx.json !== "function") return fallback;
    try {
        const body = await ctx.json();
        if (body && typeof body === "object") {
            const serverError = (body as { error?: unknown }).error;
            if (typeof serverError === "string" && serverError.trim()) return serverError;
        }
    } catch {
        // Body wasn't JSON, or was already consumed — fall through
    }
    return fallback;
};

// --- Mode 1: User clicked the email link ---

function TokenVerification({ token, redirectTo }: { token: string; redirectTo?: string }) {
    const { token: themeToken } = theme.useToken();
    const navigate = useNavigate();
    const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
    const [errorMessage, setErrorMessage] = useState("");
    const [hasSession, setHasSession] = useState(false);
    const [resolvedRedirect, setResolvedRedirect] = useState<string | undefined>(redirectTo);

    useEffect(() => {
        const verify = async () => {
            // Session check runs regardless of verification outcome so both success
            // and error states know whether to show "Back to Home" vs "Sign In".
            const sb_Auth_GetSession = await supabase.auth.getSession();
            setHasSession(!!sb_Auth_GetSession.data.session);

            const sb_FunctionsAuthVerifyToken_Invoke = await supabase.functions.invoke(
                "auth_verify-token",
                { body: { token, type: "verification" } }
            );

            if (sb_FunctionsAuthVerifyToken_Invoke.error) {
                const message = await extractEdgeFunctionErrorMessage(
                    sb_FunctionsAuthVerifyToken_Invoke.error,
                    "This verification link is invalid or has already been used."
                );
                setStatus("error");
                setErrorMessage(message);
                return;
            }

            // URL redirect takes precedence; fall back to localStorage for cross-tab signup flow.
            // Consume (read + delete) so stale values don't leak into unrelated sessions.
            const stored = consumePostVerifyRedirect();
            if (!redirectTo && stored) setResolvedRedirect(stored);

            setStatus("success");
        };
        verify();
    }, [token, redirectTo]);

    const handleContinue = () => {
        if (hasSession && resolvedRedirect) {
            // Already signed in + have a target — go straight there, skip /login entirely.
            window.location.href = resolvedRedirect;
            return;
        }
        navigate({ to: "/login", search: { redirect: resolvedRedirect } });
    };

    if (status === "verifying") {
        return (
            <div style={{ textAlign: "center", padding: "48px 0" }}>
                <Spin size="large" />
                <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
                    Verifying your email...
                </Typography.Paragraph>
            </div>
        );
    }

    if (status === "success") {
        const buttonLabel = hasSession && resolvedRedirect ? "Continue" : "Sign In";
        const subTitle =
            hasSession && resolvedRedirect
                ? "Your email has been verified. Continuing where you left off..."
                : "Your email has been verified. You can now sign in.";
        return (
            <>
                <Logo themeToken={themeToken} />
                <Result
                    icon={<CheckCircleOutlined style={{ color: themeToken.colorSuccess }} />}
                    title="Email verified!"
                    subTitle={subTitle}
                    style={{ padding: "0 0 16px" }}
                />
                <Button type="primary" block size="large" onClick={handleContinue}>
                    {buttonLabel}
                </Button>
            </>
        );
    }

    return (
        <>
            <Logo themeToken={themeToken} />
            <Result
                status="warning"
                title="Can't verify this link"
                subTitle={
                    <>
                        <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                            {errorMessage}
                        </Typography.Paragraph>
                        <Typography.Paragraph
                            type="secondary"
                            style={{ fontSize: 12, marginBottom: 0 }}
                        >
                            This usually means the link was already used, has expired, or was meant
                            for a different account. You can request a new verification email after
                            signing in.
                        </Typography.Paragraph>
                    </>
                }
                style={{ padding: "0 0 16px" }}
            />
            <Button
                type="primary"
                block
                size="large"
                onClick={() => navigate({ to: "/login", search: { redirect: resolvedRedirect } })}
            >
                Go to Sign In
            </Button>
            {hasSession && (
                <Button
                    type="text"
                    block
                    style={{ marginTop: 8 }}
                    onClick={() => {
                        window.location.href = "/home";
                    }}
                >
                    Back to Home
                </Button>
            )}
        </>
    );
}

// --- Mode 2: User just signed up, waiting for email ---

function WaitingForEmail({ redirectTo }: { redirectTo?: string }) {
    const { token: themeToken } = theme.useToken();
    const { message: messageApi } = App.useApp();

    const [email, setEmail] = useState<string | null>(null);
    const [resending, setResending] = useState(false);
    const [countdown, setCountdown] = useState(0);

    // Mirror the URL redirect into localStorage so cross-tab verification
    // (user opens the email in a different tab) can still resolve the destination.
    useEffect(() => {
        if (redirectTo) localStorage.setItem(POST_VERIFY_REDIRECT_KEY, redirectTo);
    }, [redirectTo]);

    useEffect(() => {
        supabase.auth.getUser().then((sb_Auth_GetUser) => {
            if (sb_Auth_GetUser.data.user?.email) setEmail(sb_Auth_GetUser.data.user.email);
        });
    }, []);

    useEffect(() => {
        if (countdown <= 0) return;
        const id = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(id);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(id);
    }, [countdown]);

    const handleResend = async () => {
        if (resending) return;
        setResending(true);
        try {
            const sb_FunctionsAuthSendVerification_Invoke = await supabase.functions.invoke(
                "auth_send-verification",
                { body: { type: "verification" } }
            );
            if (sb_FunctionsAuthSendVerification_Invoke.error)
                throw sb_FunctionsAuthSendVerification_Invoke.error;
            messageApi.success("Verification email sent!");

            setCountdown(60);
        } catch (err) {
            messageApi.error(
                err instanceof Error ? err.message : "Failed to resend verification email"
            );
        } finally {
            setResending(false);
        }
    };

    return (
        <>
            <Logo themeToken={themeToken} />
            <Result
                icon={<MailOutlined style={{ color: themeToken.colorPrimary }} />}
                title="Check your email"
                subTitle={
                    email
                        ? `We sent a verification link to ${email}. Click the link to activate your account.`
                        : "We sent a verification link to your email. Click the link to activate your account."
                }
                style={{ padding: "0 0 16px" }}
            />

            <div style={{ textAlign: "center" }}>
                <Button
                    type="link"
                    loading={resending}
                    disabled={countdown > 0}
                    onClick={handleResend}
                >
                    {countdown > 0 ? `Resend (${countdown}s)` : "Resend verification email"}
                </Button>
            </div>

            <div style={{ textAlign: "center", marginTop: 16 }}>
                <Button
                    type="text"
                    icon={<LogoutOutlined />}
                    onClick={() => Store_Auth_Actions.signOut()}
                    style={{ fontSize: 13, color: themeToken.colorTextSecondary }}
                >
                    Sign out
                </Button>
            </div>
        </>
    );
}

// --- Shared ---

function Logo({ themeToken }: { themeToken: { colorPrimary: string; colorWhite: string } }) {
    return (
        <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div
                style={{
                    width: 48,
                    height: 48,
                    borderRadius: 10,
                    background: themeToken.colorPrimary,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                }}
            >
                <TeamOutlined style={{ fontSize: 24, color: themeToken.colorWhite }} />
            </div>
            <Typography.Title level={4} style={{ marginBottom: 0 }}>
                ContractGo
            </Typography.Title>
        </div>
    );
}
