// Step 3 — sign, see the result, download it.
//
// The document pane is `App_DocumentFiller`, the REAL signing filler, unchanged.
// It has no supabase, auth or query imports, so it renders from a locally
// synthesized `Signing_Field[]` exactly as it does from a live session. That is
// the most valuable reuse in this feature: what the visitor sees here is
// pixel-for-pixel the experience they would be buying, not an approximation of
// it. It stays EDITABLE rather than read-only, because on a phone step 2 has no
// values rail — this is where those fields get filled.
//
// THE DOWNLOAD IS UNGATED. No modal, no email wall, no "enter your address to
// receive it". Any friction here would break the promise the landing page just
// made, and a visitor who cannot get their own document back has been wasted.
//
// THE ALERT ABOVE IT IS NOT OPTIONAL. This is a trust product, and a flattened
// PDF from a marketing demo must never be mistaken for an evidenced signature.
// The wording says what is missing — no audit trail, no identity check, no
// certificate, no hash — because that list IS the paid product, and naming it is
// simultaneously the honest disclosure and the most convincing sales argument on
// the page.

import { Alert, Button, Space, Typography, theme } from "antd";
import { Link } from "@tanstack/react-router";
import { DownloadOutlined } from "@ant-design/icons";
import { App_DocumentFiller } from "@/components/signing/App_DocumentFiller";
import { App_SignatureCapture } from "@/components/signing/App_SignatureCapture";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import type { TemplateLayout } from "@/types/template.types";
import {
    const_Trial_RoleColors,
    const_Trial_SignerRole,
    utils_Trial_ToSigningFields,
} from "./utils_Trial_Layout";

type Props = {
    pdfUrl: string;
    layout: TemplateLayout;
    values: Record<string, unknown>;
    onValueChange: (fieldId: string, value: unknown) => void;
    signature: string | null;
    onSignatureChange: (dataUrl: string | null) => void;
    onDownload: () => void;
    downloading: boolean;
};

export const PageTrial_SignAndDownload = ({
    pdfUrl,
    layout,
    values,
    onValueChange,
    signature,
    onSignatureChange,
    onDownload,
    downloading,
}: Props) => {
    const { token } = theme.useToken();
    const { isDesktop } = useApp_Breakpoint();

    const signPanel = (
        <Space direction="vertical" size={token.margin} style={{ width: "100%" }}>
            <div>
                <Typography.Text strong>Your signature</Typography.Text>
                <Typography.Paragraph
                    type="secondary"
                    style={{ fontSize: token.fontSizeSM, marginBottom: token.marginXS }}
                >
                    Draw it, type it, or upload an image. It appears in every signature box you
                    placed.
                </Typography.Paragraph>
                <App_SignatureCapture
                    value={signature}
                    onChange={(dataUrl) => onSignatureChange(dataUrl)}
                />
            </div>

            <Alert
                type="info"
                showIcon
                message="This is a demo, not a signature record."
                description="The PDF you download was flattened in your browser. There is no audit trail, no identity check, no certificate of completion, and no hash we could verify later. Sending a document to someone else — with an email code, identity verification, a tamper-evident audit log and a certificate — needs a free account."
            />

            <Space size={token.marginSM} wrap>
                <Button
                    type="primary"
                    size="large"
                    icon={<DownloadOutlined />}
                    loading={downloading}
                    onClick={onDownload}
                >
                    Download PDF
                </Button>
                {/* A LINK, never a disabled "Send" button teasing a paywall. The
                    destination is the personal-workspace composer, so signing up
                    lands them where they were trying to get to. */}
                <Link to="/signup" search={{ redirect: "/me/documents/new", from: "trial" }}>
                    <Button size="large">Create a free account to send</Button>
                </Link>
            </Space>
        </Space>
    );

    return (
        <div
            style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: isDesktop ? "row" : "column",
                minWidth: 0,
                // Below desktop the two panes stack, and stacking inside a fixed
                // frame needs a scroll of its own or the second one is unreachable.
                overflowY: isDesktop ? "hidden" : "auto",
            }}
        >
            <div
                style={{
                    flex: isDesktop ? 1 : undefined,
                    minWidth: 0,
                    minHeight: isDesktop ? 0 : 420,
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                <App_DocumentFiller
                    pdfUrl={pdfUrl}
                    fields={utils_Trial_ToSigningFields(layout)}
                    fieldValues={values}
                    onChange={onValueChange}
                    signaturePreview={signature}
                    signerRoleId={const_Trial_SignerRole.id}
                    roleColors={const_Trial_RoleColors}
                />
            </div>

            <div
                style={{
                    width: isDesktop ? 380 : undefined,
                    minWidth: isDesktop ? 380 : undefined,
                    boxSizing: "border-box",
                    borderLeft: isDesktop ? `1px solid ${token.colorBorderSecondary}` : undefined,
                    borderTop: isDesktop ? undefined : `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgContainer,
                    padding: token.paddingMD,
                    paddingBottom: `calc(${token.paddingMD}px + var(--app-safe-bottom))`,
                    overflowY: isDesktop ? "auto" : undefined,
                }}
            >
                {signPanel}
            </div>
        </div>
    );
};
