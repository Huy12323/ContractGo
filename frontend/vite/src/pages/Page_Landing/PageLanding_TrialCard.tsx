// The trial's entry point, sitting beside the pitch.
//
// IT IS A REAL DROP TARGET, not a link wearing a dashed border. It started as
// the latter — click through and drop the file on the trial's own zone — on the
// reasoning that one code path beats two. That was wrong in the way that matters
// here: a box that looks droppable and silently ignores a dropped file is a
// small lie told to the exact visitor this feature was built for, the one who
// arrived with a contract in hand. The extra path is a validated file and a
// navigation, and `Store_Trial` carries it across.
//
// VALIDATED HERE, not on the other side. The trial trusts what it takes out of
// the store, so the magic-byte check has to happen before the file goes in —
// otherwise a renamed `.docx` sails past this card and fails two steps later
// with an error the visitor cannot connect to what they did.
//
// The privacy line is not decoration. `Page_Verify` established the pattern and
// the reason: on a confidential contract, one reassurance reads as marketing and
// two read as a policy. This is the first of the two; the trial's upload step
// carries the second.

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Alert, Button, Typography, theme } from "antd";
import { CloudUploadOutlined, LockOutlined } from "@ant-design/icons";
import { Store_Trial_Actions } from "@/stores/Store_Trial";
import { utils_Pdf_ValidateTrialFile } from "@/utils/pdf/utils_Pdf_ValidateTrialFile";
import { const_Landing_TrialCard } from "./const_LandingContent";

export const PageLanding_TrialCard = () => {
    const { token } = theme.useToken();
    const navigate = useNavigate();
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
        Store_Trial_Actions.setPendingFile(file);
        void navigate({ to: "/try" });
    };

    return (
        <div
            style={{
                background: token.colorBgContainer,
                borderRadius: token.borderRadiusLG,
                border: `1px solid ${token.colorBorderSecondary}`,
                boxShadow: token.boxShadowSecondary,
                padding: token.paddingLG,
            }}
        >
            <Typography.Title level={4} style={{ marginTop: 0, marginBottom: token.marginXXS }}>
                {const_Landing_TrialCard.heading}
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: token.margin }}>
                {const_Landing_TrialCard.body}
            </Typography.Paragraph>

            {/* A <label> wrapping a hidden input, so a CLICK anywhere in the zone
                opens the file picker without any JS, and the drag handlers add
                the drop path on top. A <div> with an onClick would need its own
                keyboard and focus handling to match what a label gives free. */}
            <label
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                    // Without `preventDefault` the browser NAVIGATES to the
                    // dropped file, replacing the page with a raw PDF viewer —
                    // the default behaviour, and the most common way a
                    // hand-rolled drop zone appears to do nothing.
                    e.preventDefault();
                    setDragActive(false);
                    void handleFile(e.dataTransfer.files[0]);
                }}
                style={{
                    display: "block",
                    border: `2px dashed ${dragActive ? token.colorPrimary : token.colorBorder}`,
                    borderRadius: token.borderRadius,
                    background: dragActive ? token.colorPrimaryBg : token.colorFillAlter,
                    padding: `${token.paddingXL}px ${token.paddingLG}px`,
                    textAlign: "center",
                    cursor: "pointer",
                    transition: "border-color 0.15s, background 0.15s",
                }}
            >
                <input
                    type="file"
                    accept="application/pdf,.pdf"
                    style={{ display: "none" }}
                    onChange={(e) => {
                        void handleFile(e.target.files?.[0]);
                        // Cleared so choosing the SAME file again after a
                        // rejection still fires `change`.
                        e.target.value = "";
                    }}
                />
                <CloudUploadOutlined
                    style={{
                        fontSize: 32,
                        color: token.colorPrimary,
                        marginBottom: token.marginXS,
                    }}
                />
                <Typography.Paragraph style={{ marginBottom: token.marginSM, fontWeight: 600 }}>
                    Drop a PDF here
                </Typography.Paragraph>
                <Button type="primary" size="large" style={{ display: "block", margin: "0 auto" }}>
                    {const_Landing_TrialCard.cta}
                </Button>
                <Typography.Text
                    type="secondary"
                    style={{
                        display: "block",
                        marginTop: token.marginXS,
                        fontSize: token.fontSizeSM,
                    }}
                >
                    {const_Landing_TrialCard.limitNote}
                </Typography.Text>
            </label>

            {error && (
                <Alert
                    type="error"
                    showIcon
                    message={error}
                    style={{ marginTop: token.marginSM }}
                />
            )}

            <div
                style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: token.marginXS,
                    marginTop: token.margin,
                }}
            >
                <LockOutlined style={{ color: token.colorSuccess, marginTop: 3 }} />
                <Typography.Text style={{ fontSize: token.fontSizeSM }}>
                    {const_Landing_TrialCard.privacyNote}
                </Typography.Text>
            </div>
        </div>
    );
};
