// The passcode gate — the `email_otp` sibling of `App_SigningAccountGate`.
//
// CG-031 made the identity check the sender's choice. This is what the weaker,
// no-account arm looks like: the emailed link proved somebody reached the
// mailbox at some point, and a code redeemed here proves somebody controls it
// NOW. That is the whole of the difference, and it is why this sits in front of
// the commit rather than in front of the document.
//
// WHERE IT SITS IS THE DESIGN. `App_SigningAccountGate` replaces the entire
// ceremony, because in that mode there is nothing useful a signed-out visitor
// can do and the sign-in they need is a page away. This one renders INSIDE the
// sign step, after the signer has read the document and filled their fields,
// because:
//
//   - "sign directly from the email" is the promise; a code wall on arrival
//     would be a login wall wearing a different hat.
//   - the code is only good for ten minutes, so asking for it at the start of a
//     ceremony that takes longer than that would expire it mid-signature.
//   - mail scanners pre-fetch the link. Nothing may be emailed until a human
//     presses something, which is why there is no send-on-mount here.
//
// IT NEVER PRINTS THE SIGNER'S ADDRESS, under the same rule
// `App_SigningAccountGate`'s header sets out: this page is reachable by anyone
// holding the link, and naming the address would turn a leaked link into a
// disclosure about the contract. The person it was sent to received it there and
// already knows.

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Input, Space, Typography, theme } from "antd";
import { MailOutlined } from "@ant-design/icons";
import { useM_Signing_OtpSend } from "@/hooks/useM_Signing_OtpSend";
import { useM_Signing_OtpVerify } from "@/hooks/useM_Signing_OtpVerify";
import type { Signing_Error } from "@/hooks/useQ_Signing_Session";

type Props = {
    accessToken: string;
    /** Raised once the server has accepted a code. */
    onVerified: () => void;
};

/** Mirrors `signer_otp_issue`'s cooldown. The server is the authority and says so
 *  in `resend_after_seconds`; this is only the value used before it has answered
 *  once. */
const DEFAULT_RESEND_SECONDS = 60;

export const App_SigningOtpGate = ({ accessToken, onVerified }: Props) => {
    const { token } = theme.useToken();
    const [code, setCode] = useState("");
    const [sent, setSent] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

    const mSend = useM_Signing_OtpSend();
    const mVerify = useM_Signing_OtpVerify();

    // One interval for the countdown, torn down when it reaches zero or the
    // component leaves. Driven off the value rather than off a timestamp because
    // the only thing it feeds is a button's disabled state and its label.
    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setInterval(() => setCooldown((prev) => Math.max(prev - 1, 0)), 1000);
        return () => clearInterval(timer);
    }, [cooldown]);

    const handleSend = useCallback(async () => {
        setError(null);
        try {
            const result = await mSend.mutation.mutateAsync({ access_token: accessToken });
            setSent(true);
            setCooldown(result.resend_after_seconds ?? DEFAULT_RESEND_SECONDS);
            setAttemptsRemaining(null);
            setCode("");
        } catch (err) {
            const signingError = err as Signing_Error;
            // A cooldown is not a failure — the previous code is still valid and
            // still in their inbox. Saying "sent" here would be a lie, so the
            // countdown starts and the message explains the wait.
            if (typeof signingError.retry_after_seconds === "number") {
                setCooldown(signingError.retry_after_seconds);
                setSent(true);
            }
            setError(signingError.message);
        }
    }, [accessToken, mSend.mutation]);

    const handleVerify = useCallback(async () => {
        setError(null);
        try {
            await mVerify.mutation.mutateAsync({ access_token: accessToken, code });
            onVerified();
        } catch (err) {
            const signingError = err as Signing_Error;
            setError(signingError.message);
            setAttemptsRemaining(signingError.attempts_remaining ?? null);
            // Cleared so the next attempt starts from an empty box. Leaving a
            // wrong code in place invites the signer to re-submit the same digits
            // and spend another of five attempts on it.
            setCode("");
        }
    }, [accessToken, code, mVerify.mutation, onVerified]);

    return (
        <Card size="small">
            <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
                <Space align="start" size={token.marginSM}>
                    <MailOutlined
                        style={{ fontSize: 18, color: token.colorPrimary, marginTop: 4 }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: token.marginXXS }}>
                        <Typography.Text strong>Confirm it's you</Typography.Text>
                        <Typography.Text type="secondary">
                            {sent
                                ? "Enter the 6-digit code we emailed to the address this document was sent to. It expires in 10 minutes."
                                : "We'll email a 6-digit code to the address this document was sent to. Entering it is what records that you signed."}
                        </Typography.Text>
                    </div>
                </Space>

                {!sent ? (
                    <div>
                        <Button
                            type="primary"
                            onClick={handleSend}
                            loading={mSend.mutation.isPending}
                        >
                            Email me a code
                        </Button>
                    </div>
                ) : (
                    <Space direction="vertical" size={token.marginXS}>
                        {/* ANTD's own OTP input rather than a hand-rolled one: it
                            handles paste-across-boxes and mobile autofill, and
                            `one-time-code` is what lets iOS and Android offer the
                            code straight from the notification — which on a phone
                            is the difference between two taps and switching apps. */}
                        <Input.OTP
                            length={6}
                            value={code}
                            onChange={setCode}
                            // Fires when the sixth digit lands, so the common case
                            // needs no button press at all.
                            onInput={(value) => {
                                if (value.filter(Boolean).length === 6) setCode(value.join(""));
                            }}
                            disabled={mVerify.mutation.isPending}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                        />
                        <Space wrap>
                            <Button
                                type="primary"
                                onClick={handleVerify}
                                loading={mVerify.mutation.isPending}
                                disabled={code.length !== 6}
                            >
                                Confirm code
                            </Button>
                            <Button
                                type="link"
                                onClick={handleSend}
                                loading={mSend.mutation.isPending}
                                disabled={cooldown > 0}
                            >
                                {cooldown > 0 ? `Resend in ${cooldown}s` : "Send a new code"}
                            </Button>
                        </Space>
                    </Space>
                )}

                {error && (
                    <Alert
                        type="error"
                        showIcon
                        message={error}
                        // Shown only when the server said so and only when it is
                        // still actionable. "0 attempts remaining" alongside a
                        // message that already says to request a new code would be
                        // the same sentence twice.
                        description={
                            attemptsRemaining && attemptsRemaining > 0
                                ? `${attemptsRemaining} ${attemptsRemaining === 1 ? "try" : "tries"} left before you'll need a new code.`
                                : undefined
                        }
                    />
                )}
            </div>
        </Card>
    );
};
