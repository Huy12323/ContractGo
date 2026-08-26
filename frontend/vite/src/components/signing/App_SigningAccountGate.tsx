// The account gate — "prove who you are before you sign, not before you read".
//
// The emailed link proves that someone reached the signer's mailbox. It does not
// prove WHO: links get forwarded, inboxes get shared, mail archives outlive the
// people who read them. So the signing surface asks for one more thing before
// the irreversible act, and only before the irreversible act:
//
//   READING  — token only. A signer must be able to see what they are being
//              asked to sign before deciding whether to create an account for
//              it, and mail scanners that pre-fetch the link must land on a
//              document rather than on a login wall.
//   SIGNING  — token AND a session on the address the document names. Both
//              travel to `signing_submit` / `signing_decline`, which refuse
//              unless they agree. This component is the courteous half of that
//              refusal; the server is the enforcing half.
//
// It renders a WAY BACK IN rather than an error, because in both failure cases
// the right person is very likely the one reading it — they just have the wrong
// session, or none. A dead end here means an unsigned contract.
//
// IT NEVER PRINTS THE SIGNER'S ADDRESS. This screen is reachable by anyone
// holding the link, and the link is the one thing that travels — forwarded,
// archived, scanned. Naming the address here would turn every leaked link into a
// disclosure of who the document is for, which is a fact about the contract, not
// a hint the reader needs: the person it was sent to received it at that
// address and already knows it. So the copy says "the account it was sent to",
// and the only address on screen is the visitor's own. The server is written to
// the same rule — see `assertSignerAccount`, which names neither address.

import { useState, type ReactNode } from "react";
import { Alert, Button, Card, Space, Typography, theme } from "antd";
import { LockOutlined, SwapOutlined } from "@ant-design/icons";
import { useNavigate } from "@tanstack/react-router";
import { Store_Auth_Actions } from "@/stores/Store_Auth";
import { supabase } from "@/configs/supabase/config";

/**
 * `ok` is the only state that lets the commit through. `loading` is separate
 * from `signed_out` on purpose: the auth store starts with `loading: true` while
 * Supabase restores the session from storage, and treating that instant as
 * "signed out" would flash a login prompt at a signer who is already signed in.
 */
export type SigningAccount_Status = "loading" | "ok" | "signed_out" | "mismatch";

type Props = {
    status: Exclude<SigningAccount_Status, "ok" | "loading">;
    /**
     * Who is signed in right now, for the mismatch copy. The visitor's OWN
     * address, which is the only one this screen is allowed to print — see the
     * note above about not naming the signer's.
     */
    currentEmail: string | null;
    /** Where to come back to after signing in. The `/sign/{token}` path. */
    returnTo: string;
    /**
     * The address the document names — USED, never rendered (CG-031). It is what
     * the one-time sign-in link is sent to, so the signer never types it and the
     * screen never shows it, which keeps the no-disclosure rule above intact
     * while removing the dead end it used to create.
     *
     * Optional so the mismatch case, where the visitor must sign out and switch
     * accounts rather than be emailed anything, can omit it.
     */
    signerEmail?: string;
    /** Rendered under the actions — the step's own Back button, typically. */
    footer?: ReactNode;
};

export const App_SigningAccountGate = ({
    status,
    currentEmail,
    returnTo,
    signerEmail,
    footer,
}: Props) => {
    const { token } = theme.useToken();
    const navigate = useNavigate();
    const [linkSent, setLinkSent] = useState(false);
    const [sending, setSending] = useState(false);
    const [linkError, setLinkError] = useState<string | null>(null);

    // CG-031. The way IN for a signer who has no account — which, on a document
    // sent to a counterparty, is most of them.
    //
    // `/login` cannot serve them: its form is password-only, so "Sign in to
    // continue" was a button to a dead end for anyone who had never signed up,
    // and the paragraph this replaced said as much out loud. A one-time link to
    // the address the document already names costs the signer nothing to use,
    // proves the same mailbox the document was delivered to, and creates the
    // account on the way through.
    //
    // `shouldCreateUser` is what makes it work for a first-time recipient. The
    // account it creates lands outside the CG-027 whitelist and so cannot reach
    // the app — which is correct and deliberate: they are a counterparty, not a
    // member. The signing surface is under `_public` and never consults it.
    const handleEmailLink = async () => {
        if (!signerEmail) return;
        setSending(true);
        setLinkError(null);
        const sb_Auth_SignInWithOtp = await supabase.auth.signInWithOtp({
            email: signerEmail,
            options: {
                shouldCreateUser: true,
                // Straight back to the document. `_public` has no `beforeLoad` to
                // bounce the return leg, and the client is configured
                // `detectSessionInUrl`, so it exchanges the code on arrival —
                // which is why this needs no trip through `/auth/callback`.
                emailRedirectTo: `${window.location.origin}${returnTo}`,
            },
        });
        setSending(false);
        if (sb_Auth_SignInWithOtp.error) {
            setLinkError(sb_Auth_SignInWithOtp.error.message);
            return;
        }
        setLinkSent(true);
    };

    return (
        <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: token.marginMD }}>
                <Space align="start" size={token.marginSM}>
                    <LockOutlined
                        style={{ fontSize: 20, color: token.colorPrimary, marginTop: 4 }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: token.marginXXS }}>
                        <Typography.Title level={5} style={{ margin: 0 }}>
                            {status === "mismatch"
                                ? "You are signed in as a different account"
                                : "Sign in to sign this document"}
                        </Typography.Title>
                        <Typography.Text type="secondary">
                            {status === "mismatch" ? (
                                <>
                                    You are signed in as <strong>{currentEmail}</strong>, which is
                                    not the account this document was sent to. A signature is
                                    recorded against the account that makes it, so it has to be made
                                    from the one it was addressed to.
                                </>
                            ) : (
                                <>
                                    This document was sent to a named recipient, and it is opened by
                                    signing in to the ContractGo account for the address it was sent
                                    to. Your signature is recorded against that account, not just
                                    against this link.
                                </>
                            )}
                        </Typography.Text>
                    </div>
                </Space>

                <Space wrap>
                    {status === "mismatch" ? (
                        <Button
                            type="primary"
                            icon={<SwapOutlined />}
                            // Sign out FIRST and let the store carry the
                            // destination: `/_auth` bounces an authenticated
                            // visitor to `/`, so navigating to the login page
                            // while still signed in as the wrong account would
                            // land them on a dashboard instead of a form.
                            onClick={() => Store_Auth_Actions.signOutAndRedirect(returnTo)}
                        >
                            Sign out and switch account
                        </Button>
                    ) : (
                        <Button
                            type="primary"
                            onClick={() =>
                                navigate({ to: "/login", search: { redirect: returnTo } })
                            }
                        >
                            Sign in to continue
                        </Button>
                    )}
                    {footer}
                </Space>

                {/* The way in for someone with no account. Offered only on the
                    signed-out branch: a visitor signed in as the WRONG account
                    must sign out first, and emailing them a link while the other
                    session is live would land them right back in the mismatch. */}
                {status === "signed_out" &&
                    signerEmail &&
                    (linkSent ? (
                        <Alert
                            type="success"
                            showIcon
                            message="Check your email"
                            // Still does not name the address, under the rule at
                            // the top of this file. "The one it was sent to" is
                            // the whole of what the right person needs.
                            description="We've emailed a sign-in link to the address this document was sent to. Open it on this device and you'll come straight back here."
                        />
                    ) : (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: token.marginXXS,
                            }}
                        >
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: token.fontSizeSM }}
                            >
                                No ContractGo account, or no password?
                            </Typography.Text>
                            <div>
                                <Button onClick={handleEmailLink} loading={sending}>
                                    Email me a sign-in link instead
                                </Button>
                            </div>
                            {linkError && (
                                <Typography.Text
                                    type="danger"
                                    style={{ fontSize: token.fontSizeSM }}
                                >
                                    {linkError}
                                </Typography.Text>
                            )}
                        </div>
                    ))}
            </div>
        </Card>
    );
};
