// Step 1 — take a PDF, and say plainly where it goes.
//
// The privacy line appears here AND on the last step, which is deliberate
// repetition. `Page_Verify` established the pattern and the reason: on a
// confidential contract, one reassurance reads as marketing and two read as a
// policy. A visitor decides whether to drop a real agreement here in about two
// seconds, and this sentence is what they decide on.
//
// VALIDATION IS ASYNC because the honest check is the file's magic bytes, not
// its reported type — see `utils_Pdf_ValidateTrialFile`. The rejection reason is
// rendered verbatim; every string it returns is written to be read by a stranger.

import { useState } from "react";
import { Alert, Button, Typography, theme } from "antd";
import { CloudUploadOutlined, LockOutlined } from "@ant-design/icons";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { utils_Pdf_ValidateTrialFile } from "@/utils/pdf/utils_Pdf_ValidateTrialFile";
import { const_Trial_MaxFileSizeMB } from "@/utils/pdf/const_TrialLimits";

type Props = {
    onAccepted: (file: File) => void;
};

export const PageTrial_Upload = ({ onAccepted }: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const [error, setError] = useState<string | null>(null);
    const [dragActive, setDragActive] = useState(false);

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        const result = await utils_Pdf_ValidateTrialFile(file);
        if (!result.ok) {
            setError(result.reason);
            return;
        }
        setError(null);
        onAccepted(file);
    };

    return (
        <div
            style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: isMobile ? token.paddingMD : token.paddingXL,
            }}
        >
            <div style={{ width: "100%", maxWidth: 620, textAlign: "center" }}>
                <Typography.Title level={2} style={{ marginTop: 0, marginBottom: token.marginXS }}>
                    Try signing a document
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ marginBottom: token.marginXL }}>
                    Upload a PDF, place a signature and a few fields, sign it, and download the
                    result. No account, no email.
                </Typography.Paragraph>

                <label
                    onDragOver={(e) => {
                        e.preventDefault();
                        setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setDragActive(false);
                        void handleFile(e.dataTransfer.files[0]);
                    }}
                    style={{
                        display: "block",
                        border: `2px dashed ${dragActive ? token.colorPrimary : token.colorBorder}`,
                        background: dragActive ? token.colorPrimaryBg : token.colorBgContainer,
                        borderRadius: token.borderRadiusLG,
                        padding: `${token.paddingXL * 1.5}px ${token.paddingLG}px`,
                        cursor: "pointer",
                    }}
                >
                    <input
                        type="file"
                        accept="application/pdf,.pdf"
                        style={{ display: "none" }}
                        onChange={(e) => {
                            void handleFile(e.target.files?.[0]);
                            // Cleared so picking the SAME file twice after a
                            // rejection still fires `change`.
                            e.target.value = "";
                        }}
                    />
                    <CloudUploadOutlined
                        style={{
                            fontSize: 40,
                            color: token.colorPrimary,
                            marginBottom: token.marginSM,
                        }}
                    />
                    <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 4 }}>
                        Drop a PDF here, or choose a file
                    </Typography.Title>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        PDF only, up to {const_Trial_MaxFileSizeMB}MB
                    </Typography.Text>
                    <div style={{ marginTop: token.margin }}>
                        {/* Inside the label, so the click reaches the input either
                            way — a button that only sometimes opens the picker is
                            the classic failure here. */}
                        <Button type="primary" size="large">
                            Choose a PDF
                        </Button>
                    </div>
                </label>

                {error && (
                    <Alert
                        type="error"
                        showIcon
                        message={error}
                        style={{ marginTop: token.margin, textAlign: "left" }}
                    />
                )}

                <div
                    style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "center",
                        gap: token.marginXS,
                        marginTop: token.marginLG,
                    }}
                >
                    <LockOutlined style={{ color: token.colorSuccess, marginTop: 3 }} />
                    <Typography.Text style={{ textAlign: "left" }}>
                        Your document never leaves this browser. It is not uploaded, not stored and
                        not sent to anyone.
                    </Typography.Text>
                </div>
            </div>
        </div>
    );
};
