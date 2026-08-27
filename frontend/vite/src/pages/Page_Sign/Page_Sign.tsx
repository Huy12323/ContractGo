// The public signer surface.
//
// Everything about this page is shaped by one fact: the person using it is not
// an ORGANIZATION MEMBER. They arrived from a link in an email. That rules out
// the whole membership stack — `useQ_Me`, the organization provider, any direct
// Supabase table read — and leaves exactly two calls, both to public edge
// functions carrying the access token in their POST body.
//
// It reads `Store_Auth` to answer one question, and since CG-031 the question's
// WEIGHT depends on what the sender chose FOR THIS SIGNER — CG-032 made that
// choice per recipient, so a witness on the same envelope can owe a different
// proof. The resolution happens server-side; this page reads one value:
//
//   'account'    a signer must be signed in as the address the document names,
//                and NOTHING below that check renders until they are — not the
//                steps, not the fields, not the document. The block sits here,
//                once, rather than on each step.
//   'email_otp'  the ceremony renders for anyone holding the link, and identity
//                is proved at the COMMIT instead — by a passcode, or by a
//                session on the signer's own address if one already exists,
//                which is the stronger of the two and so skips the passcode.
//                Gating the document here would be a login wall on the mode
//                that exists to avoid one.
//
// It is the courteous half of a rule the server enforces anyway:
// `signing_submit` and `signing_decline` run `assertSignerIdentity` and refuse
// what this page merely declines to offer. This page cannot grant what they
// refuse — a determined visitor can still read `signing_session_open`'s
// response, which stays token-only because it is also what serves CC observers
// holding read-only links, and because the page needs the signer's email to say
// WHICH account to sign in as.
//
// `Page_OnboardingFiller`, the v1 ancestor, arrived at a similar place by a
// worse route: it lived under `_protected/` and fought the route guard it was
// sitting behind, so the guard decided who could sign by asking who was a member
// of the sending organization. Here the token says which signer, the session
// says it is really them, and neither question is answered by a route guard.
//
// FOUR STEPS, one component each:
//   Welcome  — what this is, who sent it, and consent BEFORE anything is filled
//   Filler   — the document with the signer's fields editable
//   Sign     — capture the mark, review, commit
//   Complete — receipt
//
// The step is local state, not a route: a half-filled document must not be
// recoverable by URL, and the back button should leave the document rather than
// walk backwards through a signing ceremony.

import { useEffect, useMemo, useState } from "react";
import { Result, Skeleton, Steps, theme } from "antd";
import { PageSign_Welcome } from "./PageSign_Welcome";
import { PageSign_BrandProvider } from "./PageSign_BrandProvider";
import { PageSign_Filler } from "./PageSign_Filler";
import { PageSign_SignStep } from "./PageSign_SignStep";
import { PageSign_Complete } from "./PageSign_Complete";
import { PageSign_IdentityStep } from "./PageSign_IdentityStep"; // [ekyc]
import { utils_PageSign_IdentityCheckReady } from "./utils_PageSign_IdentityCheckReady"; // [ekyc]
import { utils_PageSign_StepIndex, utils_PageSign_Steps } from "./utils_PageSign_Steps"; // [ekyc]
import { utils_Embed_Post } from "./utils_Embed_PostMessage"; // CG-047
import { useQ_Signing_Session, utils_Signing_IsSignatureField } from "@/hooks/useQ_Signing_Session";
import { useM_Signing_Submit } from "@/hooks/useM_Signing_Submit";
import { useM_Signing_Decline } from "@/hooks/useM_Signing_Decline";
import { useM_Signatures_Create } from "@/hooks/useM_Signatures_Create";
import { App_SigningDeclineModal } from "@/components/signing/App_SigningDeclineModal";
import type { SignatureCapture_Method } from "@/components/signing/App_SignatureCapture";
import {
    App_SigningAccountGate,
    type SigningAccount_Status,
} from "@/components/signing/App_SigningAccountGate";
import { useStore_Auth_Loading, useStore_Auth_User } from "@/stores/Store_Auth";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import {
    PageSign_Assistant,
    PageSign_AssistantTrigger,
    utils_PageSign_AssistantAvailable,
} from "./PageSign_Assistant"; // CG-049
import { Store_SigningAssistant_Actions } from "@/stores/Store_SigningAssistant"; // CG-049

type Props = {
    accessToken: string;
    /**
     * CG-047. Rendered inside an iframe on the integrator's own page.
     *
     * THE ONLY EDIT v1.4.0 MAKES TO THE SIGNER CEREMONY, and it changes nothing
     * about the ceremony itself: the same steps, the same validation, the same
     * commit, the same chain entries, the same certificate. An embedded
     * signature and a mailed one are indistinguishable in the evidence record,
     * which is the property that makes this a rendering flag rather than a
     * second signing path.
     *
     * What it drives is two things:
     *   1. the `postMessage` bridge, so the host page can react to progress
     *   2. the account gate, which cannot work inside a cross-origin frame —
     *      see `EmbeddedAccountNotice` below
     */
    embedded?: boolean;
};

// `declined` is a terminal step rather than a re-read of the session, and that
// is deliberate: `signing_decline` consumes the token, so the refetch that
// follows it answers 401. The page already knows what happened — it is what
// asked — and must not replace that with "this link cannot be opened".
// `identity` is [ekyc] (CG-033) and is only ever entered when the server says
// this signer owes a check — see `needsIdentity`.
type Step = "welcome" | "identity" | "fill" | "sign" | "complete" | "declined";

export const Page_Sign = ({ accessToken, embedded = false }: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const [step, setStep] = useState<Step>("welcome");
    const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
    const [signature, setSignature] = useState<string | null>(null);
    const [captureMethod, setCaptureMethod] = useState<SignatureCapture_Method>("drawn");
    // CG-029. Opt-in, and acted on only after the commit succeeds — see
    // `handleSubmit`. A signature saved for a ceremony that then failed would put
    // a mark in the library from a document that was never signed.
    const [saveSignature, setSaveSignature] = useState(false);
    const [consent, setConsent] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [declineOpen, setDeclineOpen] = useState(false);
    // Whether THIS signature was the last one. The session says so too, but the
    // copy that would answer it is the pre-signature one — the refetch that
    // would have carried the new status 401s on a consumed token.
    const [completedAll, setCompletedAll] = useState<boolean | undefined>(undefined);
    /**
     * The credential the receipt downloads with — see `UseM_Signing_Submit_Result`.
     *
     * Seeded from the submit response, and falling back to `accessToken` for a
     * party who arrived at an already-signed document through
     * `signing_link_for_me`: their link is live and unconsumed, so it is its own
     * download credential. The two cases are why this is state rather than a
     * derived value — nothing on the session can tell them apart.
     */
    const [downloadToken, setDownloadToken] = useState<string | null>(null);
    /** One-shot: the "would you like a copy?" prompt is offered at the moment the
     *  signature lands and never re-raised. The receipt keeps a button. */
    const [copyPromptOpen, setCopyPromptOpen] = useState(false);
    // CG-031. Local to the ceremony, and seeded from the session below rather
    // than refetched: `useQ_Signing_Session` is deliberately `retry: false` with
    // no refetch-on-focus because each fetch costs a use of the signer's link, so
    // re-reading it to learn a boolean would be the expensive way to ask.
    // `signing_submit` re-checks the passcode server-side either way, which is
    // what makes holding this locally safe rather than merely convenient.
    const [otpVerified, setOtpVerified] = useState(false);
    /**
     * Set when the SERVER says a passcode is needed after the page had concluded
     * it was not.
     *
     * The page skips the gate for a visitor signed in as the signer, because
     * `assertSignerIdentity` accepts that session in place of a code. But the
     * page only checks the ADDRESS; the server also requires the mailbox to have
     * been proved, which only it can see. So there is one case where the two
     * disagree — signed in as the right address, on an account that never proved
     * it — and without this the signer would be told to enter a code with no
     * box to enter it in. This turns that refusal into the gate they need.
     */
    const [otpRequired, setOtpRequired] = useState(false);
    /**
     * [ekyc] The identity arm's twin of `otpVerified` — CG-033.
     *
     * Held locally for the same reason and with the same authority: the session
     * is fetched once (each fetch costs a use of the link), the gate raises this
     * when the server records an approval, and `signing_submit` re-checks at the
     * commit, which is what makes holding it locally safe.
     */
    const [identityVerified, setIdentityVerified] = useState(false);

    // Read, never awaited: the page renders fully for a signed-out visitor, and
    // only the sign step consults this.
    const authUser = useStore_Auth_User();
    const authLoading = useStore_Auth_Loading();

    const qSession = useQ_Signing_Session({ accessToken });
    const session = qSession.session;
    const mSubmit = useM_Signing_Submit();
    const mSaveSignature = useM_Signatures_Create();
    const mDecline = useM_Signing_Decline();

    // ════════════════════════════════════════════════════════════
    // The embed bridge — CG-047
    // ════════════════════════════════════════════════════════════
    //
    // Every emission goes through `utils_Embed_Post`, which refuses unless the
    // session carries an origin AND this page is genuinely framed. So for the
    // overwhelming majority of ceremonies — an emailed link opened in a tab —
    // every one of these effects is a no-op, and `embedded` is false besides.
    //
    // The origin comes from the SESSION, which read it off the credential. It is
    // never read from the frame, never defaulted, and never `'*'`; a page framed
    // by an origin the sender did not register receives nothing at all.
    const hostWindow =
        typeof window !== "undefined" && window.parent !== window ? window.parent : null;
    const isFramed = hostWindow !== null;
    const embedOrigin = embedded ? (session?.embed_origin ?? null) : null;

    // ⚠ `ready` FIRES WHEN THE SESSION RESOLVES, NOT ON MOUNT, and that is forced
    // rather than chosen. The target origin is stamped on the CREDENTIAL, so this
    // page cannot know where it is allowed to speak until it has read the
    // session — a mount-time emission would have no origin to send to and would
    // be dropped by the bridge, provably and silently.
    //
    // The consequence for an integrator is stated in `docs/embedding.md`: `ready`
    // means "the frame is alive AND its session opened", so a host waiting on it
    // should also arrange its own timeout for the case where the token was
    // already expired. `error` covers that case whenever the session call itself
    // fails, but a token so broken that nothing resolves cannot announce itself
    // to an origin it never learned.
    useEffect(() => {
        if (!embedded || !session) return;
        utils_Embed_Post(hostWindow, embedOrigin, isFramed, "ready");
        utils_Embed_Post(hostWindow, embedOrigin, isFramed, "loaded", {
            envelopeId: session.request.id,
            signerId: session.signer.id,
        });
    }, [embedded, session, hostWindow, embedOrigin, isFramed]);

    useEffect(() => {
        if (!embedded || step !== "complete") return;
        utils_Embed_Post(hostWindow, embedOrigin, isFramed, "completed", {
            envelopeId: session?.request.id,
            signerId: session?.signer.id,
            // Whether THIS signature finished the document. A host that closes
            // the frame on the first signature of a three-party contract has
            // closed it two signatures early, so the distinction is carried
            // rather than inferred.
            completedAll: completedAll,
        });
    }, [embedded, step, completedAll, session, hostWindow, embedOrigin, isFramed]);

    useEffect(() => {
        if (!embedded || step !== "declined") return;
        utils_Embed_Post(hostWindow, embedOrigin, isFramed, "declined", {
            envelopeId: session?.request.id,
            signerId: session?.signer.id,
        });
    }, [embedded, step, session, hostWindow, embedOrigin, isFramed]);

    useEffect(() => {
        if (!embedded || !qSession.query.isError) return;
        // NO REASON IS CARRIED. The host page belongs to the integrator, not to
        // the signer, and this surface's refusals can name a mailbox, a passcode
        // state or an identity verdict. The signer reads the reason inside the
        // frame, where the token already entitles them to it.
        utils_Embed_Post(hostWindow, embedOrigin, isFramed, "error");
    }, [embedded, qSession.query.isError, hostWindow, embedOrigin, isFramed]);

    // Seed from what the server has: values this signer entered on an earlier
    // visit, then any defaults they have not overridden. Server values win —
    // a default must never silently replace something already submitted.
    useEffect(() => {
        if (!session) return;
        // Every field of this signer's role that carries a default, not just the
        // editable ones: `signing_submit` validates a required read-only field
        // like any other and accepts a value for it, so dropping its default
        // would leave the signer holding a required box they cannot type into.
        const defaults = Object.fromEntries(
            session.fields
                .filter(
                    (f) =>
                        f.role_id === session.signer.role_id &&
                        !utils_Signing_IsSignatureField(f) &&
                        f.default_value !== undefined
                )
                .map((f) => [f.id, f.default_value])
        );
        setFieldValues({ ...defaults, ...session.field_values });
    }, [session]);

    // A passcode answered on an earlier visit still counts, for as long as the
    // server says it does. Seeded rather than assumed false so a signer who
    // verified and then reloaded is not asked for a second code they do not need.
    useEffect(() => {
        if (session?.otp_verified) setOtpVerified(true);
    }, [session?.otp_verified]);

    // A signer returning to a document they already signed lands on the receipt
    // rather than on a filler that would refuse everything they typed into it.
    useEffect(() => {
        if (!session) return;
        if (session.signer.status === "signed" || session.request.status === "completed") {
            setStep("complete");
        }
    }, [session]);

    const roleColors = useMemo(
        () =>
            Object.fromEntries((session?.signer_roles ?? []).map((role) => [role.id, role.color])),
        [session?.signer_roles]
    );

    // CG-049. Rehydrates a transcript belonging to THIS credential and discards
    // one belonging to another signer in the same tab. Keyed off the token so a
    // second link opened in the same tab starts clean.
    useEffect(() => {
        Store_SigningAssistant_Actions.hydrate(accessToken);
    }, [accessToken]);

    // The ceremony is over, and the questions that led to it are the signer's
    // own business — leaving them in a shared browser is the one avoidable
    // disclosure this feature has.
    useEffect(() => {
        if (step !== "welcome" && step !== "identity" && step !== "fill" && step !== "sign") {
            Store_SigningAssistant_Actions.clear();
        }
    }, [step]);

    if (qSession.query.isPending) {
        return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: token.paddingLG }} />;
    }

    // BEFORE the error branch, not after: the decline consumed this token, so
    // the invalidation it triggers refetches into a 401. That is the expected
    // consequence of a successful action, not a failure to report.
    if (step === "declined") {
        return (
            <Result
                status="info"
                title="You declined to sign this document"
                subTitle="The sender has been notified and no further action is needed from you. The document is now closed to every party."
            />
        );
    }

    // Above the error branch for exactly the reason `declined` is: a successful
    // submit consumes the token, so the invalidation it triggers refetches into
    // a 401. React Query keeps the last good `data` through a failed refetch, so
    // the receipt still has everything it renders — and replacing a signature
    // that WAS recorded with "this link cannot be opened" would tell the signer
    // their signature failed when it did not.
    if (step === "complete" && session) {
        return (
            <PageSign_Complete
                session={session}
                completedOverride={completedAll}
                // The receipt reads back what was signed, and after a submit this
                // page holds the only current copy of both: the session cannot be
                // refetched on a consumed token, so its `field_values` are the
                // pre-submit ones and it carries no mark at all for the ceremony
                // that just ran. Both fall back to the session's own copies for a
                // party returning to a document they signed earlier.
                fieldValues={fieldValues}
                signaturePreview={signature}
                roleColors={roleColors}
                // A returning party's own link is live and unconsumed, so it is
                // its own download credential; a signer who just signed has the
                // minted one instead.
                downloadToken={downloadToken ?? accessToken}
                copyPromptOpen={copyPromptOpen}
                onCopyPromptClose={() => setCopyPromptOpen(false)}
            />
        );
    }

    if (qSession.query.isError) {
        return (
            <Result
                status="warning"
                title="This signing link cannot be opened"
                subTitle={
                    qSession.query.error instanceof Error
                        ? qSession.query.error.message
                        : "The link may have expired, been replaced by a newer one, or already been used."
                }
            />
        );
    }

    if (!session) return null;

    // A signer whose turn has not arrived — or whose document was voided while
    // they had the tab open — is shown why rather than a filler that cannot
    // submit. The server enforces this too; this is the courteous half.
    if (!session.can_sign) {
        return (
            <Result
                status="info"
                title={utils_PageSign_CannotSignTitle(session)}
                subTitle={utils_PageSign_CannotSignReason(session)}
            />
        );
    }

    const accountStatus = utils_PageSign_AccountStatus(
        authLoading,
        authUser?.email ?? null,
        session.signer.email
    );
    // The path, not the full URL: `/login?redirect=` feeds a router navigation,
    // and an absolute URL there would be an open redirect waiting to be pointed
    // somewhere else.
    const returnTo = `/sign/${accessToken}`;

    // THE WHOLE CEREMONY IS BEHIND THE ACCOUNT, not just its last button. A
    // signer who is not signed in as the address this document names sees this
    // and nothing else: no steps, no fields, no document.
    //
    // Placed AFTER the `can_sign` branch above and never before it, because that
    // branch is what excludes the people this must not apply to — a CC observer
    // holding a read-only link, a party whose turn has passed, someone opening a
    // withdrawn document. None of them are being asked to sign, so none of them
    // should be asked to prove an account before being told why they are here.
    //
    // `loading` is its own screen rather than falling through to the block: the
    // auth store starts with `loading: true` while Supabase restores the session
    // from storage, and treating that instant as "signed out" would flash a login
    // wall at a signer who is already signed in.
    //
    // CG-031 MADE IT CONDITIONAL. All of the above is still exactly right for an
    // `account` envelope. It is exactly wrong for an `email_otp` one: that
    // recipient has no account and is never going to have one, so blocking the
    // ceremony on a session would put a login wall in front of the mode whose
    // entire purpose is not having one. There the identity check is a passcode,
    // it lives at the commit, and the document stays readable up to that point.
    const authRequirement = session.auth_requirement ?? "account";

    // [ekyc] CG-033. ABSENT MEANS NOT REQUIRED — the block is omitted entirely
    // by `signing_session_open` unless this signer owes a check, so every
    // document that predates CG-033, and every browser holding a page from
    // before it shipped, reads `false` here and gets exactly the three-step
    // ceremony it has always had.
    const needsIdentity = session.identity_check?.required === true;
    const identityReady =
        utils_PageSign_IdentityCheckReady(session.identity_check) || identityVerified;

    if (authRequirement === "account") {
        if (accountStatus === "loading") {
            return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: token.paddingLG }} />;
        }

        if (accountStatus !== "ok") {
            // ⚠ CG-047. INSIDE A FRAME THE ACCOUNT GATE CANNOT DO ITS JOB, and
            // rendering it anyway would be a dead end dressed as an instruction.
            //
            // Two independent reasons, either of which is sufficient:
            //   * Its links navigate to `/login`. Inside an iframe that navigates
            //     THE FRAME, so the signer ends up looking at a login page in a
            //     600px box on someone else's website, with the ceremony gone.
            //   * Browsers partition storage by top-level site. A Supabase
            //     session established on our origin is generally NOT visible to
            //     our page when it is framed by a different site, so even a
            //     signer who is already signed in reads as signed out here, and
            //     one who signs in inside the frame may not be seen to have.
            //
            // So the frame says plainly what is needed and opens a new TAB, where
            // both problems disappear. `/sign/{token}` and not `/embed/sign/...`
            // — the standalone route is the one with chrome, and this credential
            // works on both.
            //
            // This only ever renders for an `account` envelope. `email_otp` — the
            // mode with no login at all, and therefore the mode embedded signing
            // actually suits — never reaches this branch.
            if (embedded) {
                return (
                    <Result
                        status="info"
                        title="Sign in to continue"
                        subTitle={`This document must be signed by ${session.signer.email}. Signing in has to happen in its own tab — open it there and this window will update when you are done.`}
                        extra={
                            <a href={returnTo} target="_blank" rel="noreferrer">
                                Open in a new tab
                            </a>
                        }
                    />
                );
            }

            return (
                <div style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
                    <App_SigningAccountGate
                        status={accountStatus}
                        currentEmail={authUser?.email ?? null}
                        returnTo={returnTo}
                        signerEmail={session.signer.email}
                    />
                </div>
            );
        }
    }

    const handleSubmit = async () => {
        setFieldErrors({});
        try {
            const result = await mSubmit.mutation.mutateAsync({
                access_token: accessToken,
                field_values: fieldValues,
                signature_base64: signature,
                capture_method: captureMethod,
                consent_accepted: consent,
            });
            if (result.status === "signed") {
                // Fire and forget, AFTER the commit. The document is signed
                // either way, so a failed library write must not be reported as a
                // failed signing — `useM_Signatures_Create` shows its own error
                // and the signer can add the mark from Settings instead.
                if (saveSignature && signature) {
                    mSaveSignature.mutation.mutate({
                        dataUrl: signature,
                        capture_method: captureMethod,
                    });
                }
                setCompletedAll(result.completed);
                setDownloadToken(result.download_token ?? null);
                setStep("complete");
                // THE PROMPT, at the one moment it is worth interrupting for. A
                // signer who closes this tab loses the link with it — the token is
                // consumed and the completion email does not arrive until the LAST
                // party signs, which for a first-of-three signer can be days. It is
                // raised only when there is actually something to serve.
                if (result.download_token) setCopyPromptOpen(true);
            }
        } catch (err) {
            // See `otpRequired`. The server wants a code the page thought was
            // unnecessary, so render the gate rather than leaving the signer with
            // an instruction and no way to follow it.
            if ((err as { code?: string }).code === "otp_required") setOtpRequired(true);
            // [ekyc] Same shape, same reason: the server wants a check the page
            // thought was satisfied (an approval that expired mid-ceremony, or a
            // stale tab). Send them to the step that can fix it rather than
            // leaving them an instruction with nowhere to follow it.
            if ((err as { code?: string }).code === "identity_check_required") {
                setIdentityVerified(false);
                setStep("identity");
            }

            // Server-side validation is authoritative — the client's own
            // completeness check can drift from the snapshot, and only the
            // server sees what was actually sent. Map its answer back onto the
            // fields so the signer is shown where the problem is, not just told.
            const missing = (err as { missing_fields?: { id: string; label: string }[] })
                .missing_fields;
            if (missing?.length) {
                // Only fields the FILLER can satisfy send the signer backwards. A
                // missing signature is reported against a box that step 2 has no
                // control over, and bouncing there for it produced a loop with no
                // exit: step 2 said "all required fields complete", step 3 said
                // nothing was missing, and the sign button kept throwing them back.
                const byId = new Map(session.fields.map((f) => [f.id, f]));
                const fillable = missing.filter((m) => {
                    const field = byId.get(m.id);
                    return !field || !utils_Signing_IsSignatureField(field);
                });
                setFieldErrors(Object.fromEntries(fillable.map((f) => [f.id, "Required"])));
                if (fillable.length > 0) setStep("fill");
            }
        }
    };

    const handleDecline = async (reason: string) => {
        try {
            await mDecline.mutation.mutateAsync({ access_token: accessToken, reason });
            setDeclineOpen(false);
            setStep("declined");
        } catch (err) {
            // Declining is gated identically to signing, so it can hit the same
            // disagreement. Closing the modal sends them back to the sign step,
            // where the gate this raises is now rendered.
            if ((err as { code?: string }).code === "otp_required") {
                setOtpRequired(true);
                setDeclineOpen(false);
            }
            // [ekyc] A decline is gated by the same `assertSignerIdentity` as a
            // signature — a leaked link must not be able to kill a live
            // multi-party contract — so it can be refused for the identity arm
            // too, and needs the same route to the fix.
            if ((err as { code?: string }).code === "identity_check_required") {
                setIdentityVerified(false);
                setDeclineOpen(false);
                setStep("identity");
            }
            // The modal renders the thrown message inline — closing it here
            // would hide the reason the decline did not take effect.
        }
    };

    // [ekyc] Extracted to `utils_PageSign_Steps` and PINNED BY A UNIT TEST. The
    // literals that used to live here were the riskiest thing v1.2.0 touches: a
    // conditional fourth step must not shift the numbering for the envelopes —
    // all of them, today — that do not use eKYC. See that file's header.
    const assistantAvailable = utils_PageSign_AssistantAvailable(session, step);

    const stepIndex = utils_PageSign_StepIndex(step, needsIdentity);

    return (
        // CG-050. The sender's accent colour, scoped to the ceremony and nowhere
        // else — see `PageSign_BrandProvider` on why this is a NESTED provider.
        <PageSign_BrandProvider brandColor={session.branding?.brand_color}>
            <div
                style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: isMobile ? token.marginXS : token.marginMD,
                    minHeight: 0,
                }}
            >
                {/* `progressDot` on a phone. Three titles across 390px either wrap to
                three lines of chrome above a document that has none to spare, or
                truncate to "Compl…" — and the step the signer is ON is named by the
                content below it anyway. */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: token.marginSM,
                        flexShrink: 0,
                    }}
                >
                    <Steps
                        size="small"
                        progressDot={isMobile}
                        responsive={false}
                        current={stepIndex}
                        items={utils_PageSign_Steps(needsIdentity)}
                        style={{ flex: 1, minWidth: 0, maxWidth: 640 }}
                    />
                    {/* CG-049. In the header row and not a floating button: a FAB
                    here would sit on top of `App_SigningFieldSheet`'s fixed bar
                    and over the field boxes the signer is trying to tap. */}
                    {assistantAvailable && <PageSign_AssistantTrigger />}
                </div>

                {/* The fill step is a fixed-height frame that scrolls its own document
                pane and must keep its footer visible; welcome and sign are ordinary
                content blocks that can outgrow the viewport, so they scroll here. */}
                {/* CG-049 turned this into a ROW. The step column below keeps its
                `overflow`/`minHeight` semantics byte-for-byte — that is what
                makes the fill step still scroll its own document pane with its
                footer visible — and gains `minWidth: 0`, for the reason
                `App_DocumentFiller` already states at its PDF column: a flex
                child's default `min-width: auto` refuses to shrink below its
                content and pushes the sibling off screen instead.

                The assistant is hoisted HERE rather than into `PageSign_Filler`,
                which is the only place literally beside the PDF and is still
                wrong: each step unmounts on transition, so a conversation started
                while filling would die on the way to Sign — and the sign step,
                standing in front of the commit button, is where it matters most.
                It also keeps the panel outside `App_DocumentFiller`'s flex row,
                whose `App_PdfDocument` has a documented ResizeObserver feedback
                loop; the filler only ever sees a narrower parent, which is what a
                smaller window already does. */}
                <div style={{ flex: 1, minHeight: 0, display: "flex", gap: token.marginMD }}>
                    <div
                        style={{
                            flex: 1,
                            minWidth: 0,
                            minHeight: 0,
                            overflow: step === "fill" ? "hidden" : "auto",
                        }}
                    >
                        {step === "welcome" && (
                            <PageSign_Welcome
                                session={session}
                                consent={consent}
                                onConsentChange={setConsent}
                                // [ekyc] The identity step goes BETWEEN Review and
                                // Complete fields, so nothing valuable is in local state
                                // when a rejection lands — and so the document stays
                                // readable first, which both existing gates state as a
                                // principle in their headers.
                                onContinue={() =>
                                    setStep(needsIdentity && !identityReady ? "identity" : "fill")
                                }
                            />
                        )}

                        {/* [ekyc] CG-033. One render block; removing eKYC deletes it. */}
                        {step === "identity" && (
                            <PageSign_IdentityStep
                                accessToken={accessToken}
                                identityCheck={session.identity_check}
                                onVerified={() => {
                                    setIdentityVerified(true);
                                    setStep("fill");
                                }}
                                onDecline={() => setDeclineOpen(true)}
                                onBack={() => setStep("welcome")}
                            />
                        )}

                        {step === "fill" && (
                            <PageSign_Filler
                                session={session}
                                fieldValues={fieldValues}
                                onFieldChange={(id, value) =>
                                    setFieldValues((prev) => ({ ...prev, [id]: value }))
                                }
                                fieldErrors={fieldErrors}
                                roleColors={roleColors}
                                signaturePreview={signature}
                                onBack={() => setStep("welcome")}
                                onContinue={() => setStep("sign")}
                            />
                        )}

                        {step === "sign" && (
                            <PageSign_SignStep
                                session={session}
                                accountStatus={accountStatus}
                                accountEmail={authUser?.email ?? null}
                                returnTo={returnTo}
                                signature={signature}
                                onSignatureChange={(dataUrl, method) => {
                                    setSignature(dataUrl);
                                    setCaptureMethod(method);
                                }}
                                saveSignature={saveSignature}
                                onSaveSignatureChange={setSaveSignature}
                                consent={consent}
                                onConsentChange={setConsent}
                                isSubmitting={mSubmit.mutation.isPending}
                                error={
                                    mSubmit.mutation.error instanceof Error
                                        ? mSubmit.mutation.error.message
                                        : null
                                }
                                onBack={() => setStep("fill")}
                                onSubmit={handleSubmit}
                                onDecline={() => setDeclineOpen(true)}
                                authRequirement={authRequirement}
                                accessToken={accessToken}
                                otpVerified={otpVerified}
                                onOtpVerified={() => setOtpVerified(true)}
                                signedInAsSigner={accountStatus === "ok"}
                                otpRequired={otpRequired}
                                identityCheckReady={identityReady} // [ekyc]
                                onIdentityRequired={() => setStep("identity")} // [ekyc]
                            />
                        )}
                    </div>

                    {assistantAvailable && (
                        <PageSign_Assistant
                            session={session}
                            accessToken={accessToken}
                            step={step}
                            onRequestFillStep={() => setStep("fill")}
                        />
                    )}
                </div>

                <App_SigningDeclineModal
                    open={declineOpen}
                    documentTitle={session.request.title}
                    isSubmitting={mDecline.mutation.isPending}
                    error={
                        mDecline.mutation.error instanceof Error
                            ? mDecline.mutation.error.message
                            : null
                    }
                    onCancel={() => setDeclineOpen(false)}
                    onConfirm={handleDecline}
                />
            </div>
        </PageSign_BrandProvider>
    );
};

// ============================================================
// Account matching
// ============================================================

/**
 * Whether the browser is signed in as the person this document names.
 *
 * Compared case-insensitively on the address alone, exactly as
 * `assertSignerAccount` does server-side — the two must agree, or the page
 * offers a commit the server then refuses. This is the courteous copy of that
 * check and never the enforcement: a client that skipped it still cannot sign.
 */
const utils_PageSign_AccountStatus = (
    authLoading: boolean,
    currentEmail: string | null,
    signerEmail: string
): SigningAccount_Status => {
    if (authLoading) return "loading";
    if (!currentEmail) return "signed_out";
    return currentEmail.trim().toLowerCase() === signerEmail.trim().toLowerCase()
        ? "ok"
        : "mismatch";
};

// ============================================================
// "You can't sign right now" copy
// ============================================================

type Session = NonNullable<ReturnType<typeof useQ_Signing_Session>["session"]>;

const utils_PageSign_CannotSignTitle = (session: Session): string => {
    if (session.signer.status === "declined") return "You declined this document";
    if (session.request.status === "cancelled") return "This document was withdrawn";
    if (session.request.status === "declined") return "This document was declined";
    // Reachable since CG-013 gave requests a deadline. It fell through to "Not
    // your turn yet" before, which is both wrong and actively misleading — it
    // promises an email that will never arrive.
    if (session.request.status === "expired") return "This document has expired";
    return "Not your turn yet";
};

const utils_PageSign_CannotSignReason = (session: Session): string => {
    if (session.signer.status === "declined") {
        return "No further action is needed from you.";
    }
    if (session.request.status === "cancelled" || session.request.status === "declined") {
        return "The sender has been notified. You do not need to do anything.";
    }
    if (session.request.status === "expired") {
        return "It passed its signing deadline and is now closed. If you still need to sign it, ask the sender to send it again.";
    }
    return `This document is being signed in order, and it has not reached you yet. You will be emailed when it is your turn to sign.`;
};
