// Step 4 — the receipt.
//
// Two different endings share this screen, and conflating them would be a lie:
//
//   * the signer signed and OTHERS still have to. The document is not yet a
//     signed agreement, and telling them it is invites them to act on it.
//   * the signer was the last, and the document is complete.
//
// AND A READ-BACK OF WHAT THEY SIGNED, because "your signature has been
// recorded" is a claim about a document the signer can no longer see. The
// ceremony replaces the document with a sentence about it, and a party who wants
// to check what they just agreed to had to have kept the tab open.
//
// BEHIND A TOGGLE, not open by default. The message above is what the signer
// came for and most of them are done; a full document viewer rendered
// unprompted buries the one sentence that matters under the thing it is about,
// and pulls a PDF over the wire for everyone who was never going to look.

import { useState } from "react";
import { Alert, Button, Modal, Result, Space, Tag, Typography, theme } from "antd";
import { CheckCircleOutlined, DownloadOutlined, FileTextOutlined } from "@ant-design/icons";
import { useM_Signing_DownloadCopy } from "@/hooks/useM_Signing_DownloadCopy";
import { App_DocumentFiller } from "@/components/signing/App_DocumentFiller";
import { App_PdfDocument } from "@/components/pdf/App_PdfDocument";
import { App_PdfZoomControls } from "@/components/pdf/App_PdfZoomControls";
import type { Signing_Session } from "@/hooks/useQ_Signing_Session";

type Props = {
    session: Signing_Session;
    /**
     * `completed` as `signing_submit` just reported it. The session's own status
     * cannot answer this after a submit — the token is consumed, so the refetch
     * that would carry the new status 401s and the page keeps the pre-signature
     * copy. Undefined for a signer arriving back at a document they already
     * signed, where the session IS current.
     */
    completedOverride?: boolean;
    /**
     * What the signer entered, as the page still holds it.
     *
     * PREFERRED OVER `session.field_values` for the same reason
     * `completedOverride` is preferred over `session.request.status`: after a
     * submit the session is the pre-submit copy and cannot be refetched. It is
     * seeded FROM the session on load, so for a party returning to a document
     * they signed earlier the two agree and this is simply the current one.
     */
    fieldValues: Record<string, unknown>;
    /**
     * The mark made in this browser, or null for a party who arrived after the
     * fact. Falls back to `session.my_signature_url`, which is the server's copy
     * of the same capture — see that field's note on why it is only ever a
     * fallback.
     */
    signaturePreview: string | null;
    /** Colour per role id, so the read-back is keyed the way the filler was. */
    roleColors: Record<string, string>;
    /**
     * The credential `signing_document_download` runs on — the short-lived `view`
     * token minted at submit, or a returning party's own live link token.
     */
    downloadToken: string;
    /** Raised once, by the page, at the moment the signature landed. */
    copyPromptOpen: boolean;
    onCopyPromptClose: () => void;
};

export const PageSign_Complete = ({
    session,
    completedOverride,
    fieldValues,
    signaturePreview,
    roleColors,
    downloadToken,
    copyPromptOpen,
    onCopyPromptClose,
}: Props) => {
    const { token } = theme.useToken();
    const [showDocument, setShowDocument] = useState(false);
    const [scale, setScale] = useState(1.0);
    const [loadFailed, setLoadFailed] = useState(false);
    const mDownloadCopy = useM_Signing_DownloadCopy();

    const isFullyComplete = completedOverride ?? session.request.status === "completed";

    // The finished, burned document — present only once EVERY party has signed.
    // `?? null` because the key is absent, not null, on a page held from before
    // this shipped.
    const signedPdfUrl = session.signed_pdf_url ?? null;

    // The ceremony's own mark first, the server's copy second. Both can be
    // missing — a signer whose fields carried no signature box, or a page from
    // before `my_signature_url` shipped — and a receipt without it still reads
    // correctly, so nothing here is gated on having one.
    const mark = signaturePreview ?? session.my_signature_url ?? null;

    // ONE ACTION, TWO PLACES. The prompt is the moment it matters and the button
    // is the second chance; routing both through here means they cannot end up
    // fetching different documents or naming the file differently.
    const downloadCopy = () =>
        mDownloadCopy.mutation.mutate({
            access_token: downloadToken,
            title: session.request.title,
        });

    return (
        <div
            style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                padding: token.paddingMD,
            }}
        >
            <div style={{ maxWidth: 640, margin: "0 auto", flexShrink: 0 }}>
                <Result
                    icon={<CheckCircleOutlined style={{ color: token.colorSuccess }} />}
                    status="success"
                    title={
                        isFullyComplete
                            ? "Document signed and completed"
                            : "Your signature has been recorded"
                    }
                    subTitle={
                        isFullyComplete
                            ? `“${session.request.title}” has been signed by everyone. A copy will be emailed to you.`
                            : `“${session.request.title}” is now with the remaining signers. You will be emailed a copy once everyone has signed.`
                    }
                    extra={
                        <Space direction="vertical" align="center" size={token.marginSM}>
                            <Typography.Text type="secondary">
                                Signed as {session.signer.name} ({session.signer.email}). This
                                action and its evidence are recorded in the document's audit trail.
                            </Typography.Text>
                            <Space wrap>
                                {/* PRIMARY, and deliberately ahead of the viewer.
                                    The signer is one click from closing this tab,
                                    and a copy on their disk is the only outcome
                                    that survives it. */}
                                <Button
                                    type="primary"
                                    icon={<DownloadOutlined />}
                                    loading={mDownloadCopy.mutation.isPending}
                                    onClick={downloadCopy}
                                >
                                    Download a copy
                                </Button>
                                <Button
                                    icon={<FileTextOutlined />}
                                    onClick={() => setShowDocument((open) => !open)}
                                >
                                    {showDocument ? "Hide the document" : "See what you signed"}
                                </Button>
                            </Space>
                            {/* Said before they click, not after they open the
                                file and wonder. An interim copy is a real record
                                of what they agreed to and is NOT the executed
                                agreement — the distinction is the sender's to
                                explain later, but it starts here. */}
                            {!signedPdfUrl && (
                                <Typography.Text
                                    type="secondary"
                                    style={{ fontSize: token.fontSizeSM }}
                                >
                                    Your copy shows the document as it stands today. The final
                                    signed version is emailed to you once everyone has signed.
                                </Typography.Text>
                            )}
                        </Space>
                    }
                />
            </div>

            {showDocument && (
                <div
                    style={{
                        flex: 1,
                        minHeight: 0,
                        display: "flex",
                        flexDirection: "column",
                        maxWidth: 1100,
                        width: "100%",
                        margin: "0 auto",
                    }}
                >
                    {/* A SIGNED URL THAT EXPIRED IS NOT RETRIED HERE, unlike
                        `App_EnvelopeDocumentViewer` which refetches on load error.
                        That recovery works because its query can be re-run; this
                        one cannot — a submit consumes the access token, so
                        refetching the session 401s and would replace a correct
                        receipt with "this link cannot be opened". Saying what
                        happened and leaving the receipt standing is the honest
                        failure. */}
                    {loadFailed ? (
                        <Alert
                            type="warning"
                            showIcon
                            message="The document link has expired"
                            description="Your signature is still recorded — this only affects the preview. Open the link from your email again to view the document."
                        />
                    ) : signedPdfUrl ? (
                        <PageSign_SignedDocument
                            url={signedPdfUrl}
                            scale={scale}
                            onScaleChange={setScale}
                            onLoadError={() => setLoadFailed(true)}
                        />
                    ) : (
                        // NO SIGNED PDF YET, so the honest read-back is the source
                        // document with this signer's entries laid over it — which
                        // is what they actually agreed to. `readOnly` locks every
                        // input; the ceremony is over and there is nothing here to
                        // change.
                        //
                        // The overlay is drawn ONLY in this branch. `signing_submit`
                        // burns every value into the signed PDF, so painting them
                        // again on top of the finished file would double-render the
                        // document at exactly the moment its fidelity matters most —
                        // the same rule `App_EnvelopeDocumentViewer` follows.
                        <App_DocumentFiller
                            pdfUrl={session.pdf_url}
                            fields={session.fields}
                            fieldValues={fieldValues}
                            onChange={() => {}}
                            otherFieldValues={session.other_field_values}
                            signaturePreview={mark}
                            signerRoleId={session.signer.role_id}
                            roleColors={roleColors}
                            readOnly
                        />
                    )}
                </div>
            )}

            {/* THE PROMPT. A Modal rather than a toast: a toast that disappears
                after four seconds is exactly the affordance a signer misses, and
                missing it is the whole complaint this feature answers.
                Dismissible, because "no thanks" is a legitimate answer and the
                receipt keeps the button either way. */}
            <Modal
                open={copyPromptOpen}
                onCancel={onCopyPromptClose}
                title="Would you like a copy?"
                okText="Download a copy"
                cancelText="No thanks"
                confirmLoading={mDownloadCopy.mutation.isPending}
                onOk={async () => {
                    // Awaited so the modal stays up — and stays disabled — until the
                    // file is actually produced. Closing on click would leave a
                    // signer who hit a failure with a dismissed dialog, no file, and
                    // an error toast referring to something no longer on screen.
                    await mDownloadCopy.mutation.mutateAsync({
                        access_token: downloadToken,
                        title: session.request.title,
                    });
                    onCopyPromptClose();
                }}
            >
                <Typography.Paragraph>
                    {isFullyComplete
                        ? `Everyone has signed “${session.request.title}”. Save the signed PDF now — this link stops working when you close this page.`
                        : `Save a copy of “${session.request.title}” as you signed it. This link stops working when you close this page, and the final signed version is emailed to you once everyone has signed.`}
                </Typography.Paragraph>
            </Modal>
        </div>
    );
};

// The finished document, with no field overlay — see the note at the call site.
const PageSign_SignedDocument = ({
    url,
    scale,
    onScaleChange,
    onLoadError,
}: {
    url: string;
    scale: number;
    onScaleChange: (scale: number) => void;
    onLoadError: () => void;
}) => {
    const { token } = theme.useToken();

    return (
        <>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginSM,
                    padding: `0 0 ${token.paddingXS}px`,
                }}
            >
                <Typography.Text strong>Signed document</Typography.Text>
                <Tag color="green">Final</Tag>
                <div style={{ marginLeft: "auto" }}>
                    <App_PdfZoomControls scale={scale} onScaleChange={onScaleChange} />
                </div>
            </div>

            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusLG,
                    overflow: "hidden",
                }}
            >
                <App_PdfDocument fileUrl={url} scale={scale} onLoadError={onLoadError} />
            </div>
        </>
    );
};
