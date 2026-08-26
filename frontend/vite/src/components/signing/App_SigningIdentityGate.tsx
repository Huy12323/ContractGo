// [ekyc] The identity gate — CG-033. The third and strongest of the three, and
// the only one that asks about the person rather than about the mailbox.
//
// WHERE IT SITS IS THE DESIGN, and it matches NEITHER of its siblings.
// `App_SigningAccountGate` replaces the whole ceremony pre-Welcome;
// `App_SigningOtpGate` sits inside the sign step at the commit. This is an
// interstitial STEP between Review and Complete fields. Test the OTP gate's
// three stated reasons against an identity check and they come apart:
//
//   - "the code lives ten minutes, so asking early would expire it" INVERTS. A
//     verdict is a durable row on the signer, not a credential on the token;
//     there is nothing to expire by doing it early, and re-running it later
//     would be billable and hostile.
//   - "sign straight from the email" WEAKENS. A sender who ticks this box has
//     explicitly traded that promise — and eKYC still needs no account, no
//     password and no sign-up, so the promise is only half spent.
//   - "mail scanners pre-fetch" SURVIVES, modified. Nothing is emailed here, but
//     a prefetch must not START a check and burn an attempt for a robot. Hence
//     NO START ON MOUNT. Same rule, same reason, different cost.
//
// And two arguments with no OTP analogue decide it. `Page_Sign` holds the whole
// ceremony in local state, and `PageSign_SignStep` holds a canvas-drawn
// signature as a base64 dataURL no server has: running a camera-permission
// prompt, a file picker and possibly a tab switch on top of that risks
// destroying work that cannot be recovered. And a REJECTION must land before the
// signer invests effort — telling someone their ID failed on the screen where
// they have just drawn their signature is the worst possible sequencing of that
// news.
//
// IT NEVER PRINTS THE SIGNER'S ADDRESS, under the rule both existing gates state
// in their headers: this page is reachable by anyone holding the link.
//
// AND IT NEVER SHOWS A SCORE. The server does not send one.

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Result, Space, Typography, theme } from "antd";
import { IdcardOutlined } from "@ant-design/icons";
import { useM_Signing_IdentityStart } from "@/hooks/useM_Signing_IdentityStart";
import { useM_Signing_IdentitySubmit } from "@/hooks/useM_Signing_IdentitySubmit";
import type { Signing_Error, Signing_Session } from "@/hooks/useQ_Signing_Session";
import { ENVs } from "@/utils/ENVs/ENVs";

type Props = {
    accessToken: string;
    /** The server's view at page load. The gate drives its own state from there. */
    initial: Signing_Session["identity_check"];
    /** Raised once the server has recorded an approval. */
    onVerified: () => void;
    /** Offered on the dead end, so a rejected signer is never simply stuck. */
    onDecline: () => void;
};

type GateStatus = "not_started" | "pending" | "approved" | "rejected" | "expired";

/** Mirrors `signer_identity_start`'s cooldown. The server is the authority and
 *  says so in `resend_after_seconds`; this is only the pre-answer default. */
const DEFAULT_RETRY_SECONDS = 60;

export const App_SigningIdentityGate = ({ accessToken, initial, onVerified, onDecline }: Props) => {
    const { token } = theme.useToken();
    const [status, setStatus] = useState<GateStatus>(initial?.status ?? "not_started");
    const [reason, setReason] = useState<string | null>(initial?.reason ?? null);
    const [cooldown, setCooldown] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const mStart = useM_Signing_IdentityStart();
    const mSubmit = useM_Signing_IdentitySubmit();

    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setInterval(() => setCooldown((prev) => Math.max(prev - 1, 0)), 1000);
        return () => clearInterval(timer);
    }, [cooldown]);

    // The gate does not sit there congratulating itself. An approval is a
    // transition, so it advances the ceremony as soon as one lands — including
    // one that was already true when the page loaded.
    useEffect(() => {
        if (status === "approved") onVerified();
    }, [status, onVerified]);

    const handleStart = useCallback(async () => {
        setError(null);
        try {
            const result = await mStart.mutation.mutateAsync({ access_token: accessToken });
            // `approved` here is the already-passed short circuit, not a new
            // verdict: the signer had already been checked and a resend must not
            // ask them again.
            setStatus(result.status === "approved" ? "approved" : "pending");
            setCooldown(result.resend_after_seconds ?? DEFAULT_RETRY_SECONDS);
        } catch (err) {
            const signingError = err as Signing_Error;
            if (typeof signingError.retry_after_seconds === "number") {
                setCooldown(signingError.retry_after_seconds);
            }
            setError(signingError.message);
        }
    }, [accessToken, mStart.mutation]);

    const handleCheck = useCallback(async () => {
        setError(null);
        try {
            const result = await mSubmit.mutation.mutateAsync({ access_token: accessToken });
            setStatus(result.status);
            setReason(result.reason ?? null);
        } catch (err) {
            setError((err as Signing_Error).message);
        }
    }, [accessToken, mSubmit.mutation]);

    // A REJECTED SIGNER IS GIVEN A WAY OUT, NOT A WALL — the same principle
    // `App_SigningAccountGate` applies when the wrong account is signed in. They
    // may try again (the throttle bounds how often), and if they cannot pass they
    // can decline rather than abandoning a document that then sits unresolved
    // until it expires.
    if (status === "rejected" || status === "expired") {
        return (
            <Result
                status="warning"
                title={
                    status === "expired"
                        ? "That identity check has expired"
                        : "We could not verify your identity"
                }
                subTitle={
                    reason ??
                    "The provider could not match you to the document you submitted. You can try again, or decline and contact the sender."
                }
                extra={
                    <Space>
                        <Button
                            type="primary"
                            loading={mStart.mutation.isPending}
                            disabled={cooldown > 0}
                            onClick={handleStart}
                        >
                            {cooldown > 0 ? `Try again in ${cooldown}s` : "Try again"}
                        </Button>
                        <Button onClick={onDecline}>Decline to sign</Button>
                    </Space>
                }
            />
        );
    }

    return (
        <Card style={{ maxWidth: 640 }}>
            <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
                <Space align="start" size={token.marginSM}>
                    <IdcardOutlined style={{ fontSize: 22, color: token.colorPrimary }} />
                    <div>
                        <Typography.Title level={5} style={{ margin: 0 }}>
                            Verify your identity
                        </Typography.Title>
                        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                            The sender has asked every recipient of this document to confirm who
                            they are before signing. You will be asked to photograph a government ID
                            and take a short selfie. You do not need an account.
                        </Typography.Paragraph>
                    </div>
                </Space>

                {/* NO START ON MOUNT — see the header. The signer presses this. */}
                {status === "not_started" && (
                    <Button
                        type="primary"
                        loading={mStart.mutation.isPending}
                        disabled={cooldown > 0}
                        onClick={handleStart}
                    >
                        {cooldown > 0 ? `Please wait ${cooldown}s` : "Start identity check"}
                    </Button>
                )}

                {status === "pending" && (
                    <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
                        <Alert
                            type="info"
                            showIcon
                            message="Your check is with the provider"
                            description="Follow the provider's instructions, then check back here. This can take a minute."
                        />
                        <Button
                            type="primary"
                            loading={mSubmit.mutation.isPending}
                            onClick={handleCheck}
                        >
                            I have finished — check my result
                        </Button>
                    </Space>
                )}

                {error && <Alert type="error" showIcon message={error} />}

                {/* DEV ONLY. A production build must never tell a signer how to
                    fail their own check. Same gating as the dev signing-link
                    action on the sender's detail page. */}
                {ENVs.isDev && (
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        Dev: the identity provider is simulated and approves by default. Set
                        <Typography.Text code>IDENTITY_MOCK_VERDICT=rejected</Typography.Text>
                        in the edge-function env to exercise the rejection path.
                    </Typography.Text>
                )}
            </Space>
        </Card>
    );
};
