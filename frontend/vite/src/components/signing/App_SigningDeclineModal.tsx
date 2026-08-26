// Refusing to sign, deliberately.
//
// A decline ends the document for EVERY party, not just this one, so the modal
// says so before it asks for confirmation — a signer who thinks they are only
// removing themselves from the routing has not made an informed decision.
//
// The reason is required here because it is required by the server: it is
// hashed into the `signer_declined` audit entry and quoted verbatim to the
// sender, and "declined, no reason given" is a route that stops with nothing
// anyone can act on.

import { useState } from "react";
import { Alert, Input, Modal, Typography, theme } from "antd";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Modal_Responsive } from "@/utils/Utils_Modal_Responsive";

type Props = {
    open: boolean;
    documentTitle: string;
    isSubmitting: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: (reason: string) => void;
};

const MAX_REASON_LENGTH = 1000;

export const App_SigningDeclineModal = ({
    open,
    documentTitle,
    isSubmitting,
    error,
    onCancel,
    onConfirm,
}: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const [reason, setReason] = useState("");

    const trimmed = reason.trim();

    return (
        <Modal
            open={open}
            title={`Decline to sign “${documentTitle}”`}
            okText="Decline to sign"
            okButtonProps={{ danger: true, disabled: !trimmed }}
            cancelText="Go back"
            confirmLoading={isSubmitting}
            maskClosable={!isSubmitting}
            // The reason is cleared on close rather than on open: a signer who
            // cancels mid-sentence and reopens should find what they typed.
            afterClose={() => setReason("")}
            onCancel={onCancel}
            onOk={() => onConfirm(trimmed)}
            {...Utils_Modal_Responsive(isMobile)}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
                <Alert
                    type="warning"
                    showIcon
                    message="This closes the document for everyone"
                    description="No other party will be able to sign it, and every signing link — including yours — stops working. This cannot be undone; the sender would have to send the document again."
                />

                <div>
                    <Typography.Text strong>Why are you declining?</Typography.Text>
                    <Typography.Paragraph
                        type="secondary"
                        style={{ fontSize: token.fontSizeSM, marginBottom: token.marginXS }}
                    >
                        The sender is emailed this reason, and it is recorded in the document's
                        audit trail.
                    </Typography.Paragraph>
                    <Input.TextArea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={4}
                        maxLength={MAX_REASON_LENGTH}
                        showCount
                        disabled={isSubmitting}
                        placeholder="For example: the payment terms in section 4 do not match what we agreed."
                    />
                </div>

                {error && <Alert type="error" showIcon message={error} />}
            </div>
        </Modal>
    );
};
