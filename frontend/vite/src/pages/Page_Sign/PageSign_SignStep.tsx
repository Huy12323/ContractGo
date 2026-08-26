// Step 3 — capture the mark and commit.
//
// The commit button is the point of no return, so it is deliberately gated on
// three separate facts being visibly true on screen: consent is given, a
// signature exists, and no request is already in flight. Each is stated rather
// than merely enforced — a disabled button with no explanation is the worst
// possible UI for a legally consequential action.

import type { ReactNode } from "react";
import { Alert, Button, Card, Space, Typography, theme } from "antd";
import type { SignatureCapture_Method } from "@/components/signing/App_SignatureCapture";
import { App_SignaturePicker } from "@/components/signing/App_SignaturePicker";
import { App_SigningConsentGate } from "@/components/signing/App_SigningConsentGate";
import {
    App_SigningAccountGate,
    type SigningAccount_Status,
} from "@/components/signing/App_SigningAccountGate";
import { App_SigningOtpGate } from "@/components/signing/App_SigningOtpGate";
import {
    utils_Signing_IsMyField,
    utils_Signing_IsSignatureField,
    type Signing_Session,
} from "@/hooks/useQ_Signing_Session";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

type Props = {
    session: Signing_Session;
    /** Whether this browser is signed in as the address the document names. */
    accountStatus: SigningAccount_Status;
    /** Who it IS signed in as, for the mismatch copy. */
    accountEmail: string | null;
    /** The `/sign/{token}` path to return to after signing in. */
    returnTo: string;
    signature: string | null;
    onSignatureChange: (dataUrl: string | null, method: SignatureCapture_Method) => void;
    /** Whether a freshly made mark joins the signer's library once the commit succeeds. */
    saveSignature: boolean;
    onSaveSignatureChange: (save: boolean) => void;
    consent: boolean;
    onConsentChange: (consent: boolean) => void;
    isSubmitting: boolean;
    error: string | null;
    onBack: () => void;
    onSubmit: () => void;
    /**
     * Opens the decline modal. Offered HERE and not on the welcome step:
     * declining is a judgement about the document's contents, so it should
     * require having reached the end of it.
     */
    onDecline: () => void;
    /**
     * Which proof THIS SIGNER owes (CG-031, resolved per recipient by CG-032).
     * Decides whether the gate below is the account one or the passcode one —
     * they are alternatives, never both.
     *
     * Resolved entirely server-side and delivered as `session.auth_requirement`.
     * This surface cannot tell whether the answer came from the envelope or from
     * an exception on this recipient's row, and must not need to.
     */
    authRequirement: "account" | "email_otp";
    /** The raw token, for the passcode calls. Never rendered. */
    accessToken: string;
    /** Whether a passcode has been answered during this ceremony. */
    otpVerified: boolean;
    onOtpVerified: () => void;
    /**
     * Whether this browser is already signed in as the address the document
     * names. On an `email_otp` envelope that satisfies the identity gate on its
     * own — `assertSignerIdentity` accepts a matching session in place of a code
     * — so the passcode step is skipped entirely rather than asked for on top.
     */
    signedInAsSigner: boolean;
    /** The server asked for a passcode anyway. See `otpRequired` in `Page_Sign`. */
    otpRequired: boolean;
    /**
     * [ekyc] Whether the identity arm is satisfied — CG-033. OPTIONAL, and
     * `undefined` means ready: a caller that does not know about identity checks
     * (or an envelope that does not use them) is unaffected.
     */
    identityCheckReady?: boolean;
    /**
     * [ekyc] Sends the signer back to the identity step. A disabled button with
     * no route to the fix is exactly the failure mode this file's header exists
     * to prevent.
     */
    onIdentityRequired?: () => void;
};

export const PageSign_SignStep = ({
    session,
    accountStatus,
    accountEmail,
    returnTo,
    signature,
    onSignatureChange,
    saveSignature,
    onSaveSignatureChange,
    consent,
    onConsentChange,
    isSubmitting,
    error,
    onBack,
    onSubmit,
    authRequirement,
    accessToken,
    otpVerified,
    onOtpVerified,
    signedInAsSigner,
    otpRequired,
    identityCheckReady = true, // [ekyc] — absent means "this arm does not apply"
    onIdentityRequired, // [ekyc]
    onDecline,
}: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();

    // A template can legitimately place no signature box for a party — a witness
    // who only fills in details, say. In that case there is nothing to capture
    // and the commit rests on consent alone.
    //
    // Tested by ROLE, not by `editable`: the session marks every `signature`
    // field non-editable (they are captured here, not typed into the page), so
    // keying off `editable` concluded "no mark needed" for every signer whose
    // template used `signature` rather than `initials` — the pad never rendered,
    // and `signing_submit` then rejected the commit for the missing signature.
    const needsSignature = session.fields.some(
        (f) =>
            utils_Signing_IsMyField(f, session.signer.role_id) && utils_Signing_IsSignatureField(f)
    );
    // CG-031. In `email_otp` mode the passcode is a precondition of the commit
    // exactly as the signature is, so it joins the same predicate rather than
    // disabling the button from somewhere else — one place decides whether this
    // signer may press Sign, and `canSubmitReason` below reads from the same
    // facts to say why not.
    //
    // In `email_otp` mode there are TWO ways to be ready, matching the server:
    // a passcode answered, or a session already signed in as this signer. The
    // second is the stronger of the two, so asking for a code on top of it would
    // be friction that buys nothing — see `assertSignerIdentity`.
    //
    // `otpRequired` overrides the session shortcut. It is only ever set by the
    // server refusing a commit the page thought was ready, which happens for an
    // account signed in on the right address that never proved the mailbox — the
    // one condition the page cannot see for itself.
    const identityReady =
        authRequirement === "account" || otpVerified || (signedInAsSigner && !otpRequired);
    // [ekyc] A SEPARATE CONJUNCT, AND `identityReady` ABOVE IS NOT TOUCHED —
    // CG-033 decision 6. The two answer different questions with different
    // freshness requirements: the mailbox arm asks "does whoever is here control
    // that address RIGHT NOW", where freshness IS the claim, so it must happen at
    // the commit; the identity arm asks "who is this human", which is durable and
    // was answered once, early. Folding eKYC into `identityReady` would let a
    // passed identity check satisfy the PASSCODE requirement, which is a genuine
    // authorisation bug rather than a tidier expression.
    const canSubmit =
        consent &&
        (!needsSignature || !!signature) &&
        identityReady &&
        identityCheckReady &&
        !isSubmitting;

    const frame = (children: ReactNode) => (
        <div
            style={{
                maxWidth: 640,
                margin: "0 auto",
                paddingBottom: token.paddingLG,
                display: "flex",
                flexDirection: "column",
                gap: token.marginMD,
            }}
        >
            {children}
        </div>
    );

    // A SESSION THAT DIED MID-CEREMONY. `Page_Sign` will not render a step to
    // anyone who is not signed in as this signer, so reaching this state means
    // the session expired or was signed out in another tab while the document was
    // open. The commit is withdrawn rather than left to fail against the server:
    // `signing_submit` refuses it, and a button that throws is worse than a
    // button that explains.
    //
    // Decline goes with it, deliberately — `signing_decline` refuses the same
    // callers, and a decline ends the document for every party on it.
    // ONLY IN `account` MODE. In `email_otp` mode there is deliberately no
    // session at all — the recipient has no account, which is the entire point —
    // so `accountStatus` is permanently `signed_out` there and this branch would
    // replace the ceremony with a sign-in prompt for a document that does not
    // want one.
    if (authRequirement === "account" && accountStatus !== "ok") {
        return frame(
            <App_SigningAccountGate
                status={accountStatus === "loading" ? "signed_out" : accountStatus}
                currentEmail={accountEmail}
                returnTo={returnTo}
                signerEmail={session.signer.email}
                footer={<Button onClick={onBack}>Back to the document</Button>}
            />
        );
    }

    return frame(
        <>
            <Card>
                <div style={{ display: "flex", flexDirection: "column", gap: token.marginMD }}>
                    <Typography.Title level={5} style={{ margin: 0 }}>
                        Sign “{session.request.title}”
                    </Typography.Title>

                    {needsSignature ? (
                        // The PICKER rather than the pad directly. It falls back
                        // to the pad, unchanged, for anyone with an empty library
                        // — which is every signer until they save one — so this
                        // swap adds a step for nobody.
                        <App_SignaturePicker
                            value={signature}
                            onChange={onSignatureChange}
                            defaultTypedName={session.signer.name}
                            saveForLater={saveSignature}
                            onSaveForLaterChange={onSaveSignatureChange}
                        />
                    ) : (
                        <Alert
                            type="info"
                            showIcon
                            message="This document does not ask you for a signature mark — your agreement below completes it."
                        />
                    )}

                    <App_SigningConsentGate
                        checked={consent}
                        onChange={onConsentChange}
                        signerName={session.signer.name}
                        signerEmail={session.signer.email}
                        disabled={isSubmitting}
                    />

                    {error && <Alert type="error" showIcon message={error} />}

                    {/* Decline sits opposite the commit rather than beside it.
                        It is a real option and must be findable without hunting,
                        but it is not an alternative the page should invite —
                        hence a text button against a large primary one.
                        On a phone "opposite" becomes "below", and the vertical
                        separation does the same job the horizontal one did:
                        a thumb reaching for Sign must not be able to land on
                        Decline, which ends the document for every party on it. */}
                    {isMobile ? (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: token.marginXS,
                            }}
                        >
                            <Button
                                block
                                type="primary"
                                size="large"
                                loading={isSubmitting}
                                disabled={!canSubmit}
                                onClick={onSubmit}
                            >
                                Sign document
                            </Button>
                            <Button block onClick={onBack} disabled={isSubmitting}>
                                Back
                            </Button>
                            <Button
                                block
                                type="text"
                                danger
                                disabled={isSubmitting}
                                onClick={onDecline}
                            >
                                Decline to sign
                            </Button>
                        </div>
                    ) : (
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: token.marginSM,
                                flexWrap: "wrap",
                            }}
                        >
                            <Button type="text" danger disabled={isSubmitting} onClick={onDecline}>
                                Decline to sign
                            </Button>

                            <Space>
                                <Button onClick={onBack} disabled={isSubmitting}>
                                    Back
                                </Button>
                                <Button
                                    type="primary"
                                    size="large"
                                    loading={isSubmitting}
                                    disabled={!canSubmit}
                                    onClick={onSubmit}
                                >
                                    Sign document
                                </Button>
                            </Space>
                        </div>
                    )}

                    {/* Directly above the commit, and only while it is still
                        owed. Once the code is accepted the gate disappears
                        rather than sitting there confirming itself — the signer
                        is done with it, and the next thing they need is the
                        button. */}
                    {authRequirement === "email_otp" && !identityReady && (
                        <App_SigningOtpGate accessToken={accessToken} onVerified={onOtpVerified} />
                    )}

                    {/* [ekyc] The route to the fix. The identity gate itself is
                        NOT rendered here — it lives on its own step, before the
                        document is filled and before a signature is drawn, so
                        that a rejection never lands on top of unsaved work. What
                        belongs here is a way back to it. */}
                    {!identityCheckReady && onIdentityRequired && (
                        <div style={{ textAlign: isMobile ? "center" : "right" }}>
                            <Button type="link" style={{ padding: 0 }} onClick={onIdentityRequired}>
                                Go to identity verification
                            </Button>
                        </div>
                    )}

                    {!canSubmit && !isSubmitting && (
                        <Typography.Text
                            type="secondary"
                            style={{ textAlign: isMobile ? "center" : "right" }}
                        >
                            {/* [ekyc] ONE ARM INSERTED BEFORE THE EXISTING FINAL
                                FALLBACK, so the shipped consent → signature →
                                code ordering is preserved bit for bit. It is
                                last of the three that come before the fallback
                                because it is the only one the signer cannot fix
                                on this screen — hence the link. */}
                            {!consent
                                ? "Tick the agreement above to continue."
                                : needsSignature && !signature
                                  ? "Add your signature above to continue."
                                  : !identityCheckReady
                                    ? "Verify your identity before signing."
                                    : "Confirm the emailed code above to continue."}
                        </Typography.Text>
                    )}
                </div>
            </Card>
        </>
    );
};
