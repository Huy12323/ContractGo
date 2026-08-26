// Sending one signer's turn back.
//
// The sibling of `App_SigningDeclineModal` and deliberately shaped like it: a
// required free-text reason, a warning that states the consequence in full before
// asking to confirm, and the same 1000-character cap the server enforces because
// the chain hashes the string verbatim.
//
// What this modal has to get across is that the action is NOT destructive and IS
// disruptive, which is an unusual pair. The earlier signature survives on the
// audit trail — nothing is erased — but the signer's existing link dies, the
// document stops being "waiting on the last party", and anyone further along the
// route goes back to waiting. A sender who reads this as "ask them to take
// another look" will be surprised by all three.

import { useState } from "react";
import { Alert, Input, Modal, Typography, theme } from "antd";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Modal_Responsive } from "@/utils/Utils_Modal_Responsive";

type Props = {
    open: boolean;
    signerName: string;
    documentTitle: string;
    /** True when the route has already moved past this signer, so the rewind
     *  will also close a later party's turn. */
    rewindsPastOthers: boolean;
    isSubmitting: boolean;
    onCancel: () => void;
    onConfirm: (reason: string) => void;
};

const MAX_REASON_LENGTH = 1000;

export const App_EnvelopeRequestChangesModal = ({
    open,
    signerName,
    documentTitle,
    rewindsPastOthers,
    isSubmitting,
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
            title={`Ask ${signerName} to sign again`}
            okText="Send it back"
            okButtonProps={{ disabled: !trimmed }}
            cancelText="Cancel"
            confirmLoading={isSubmitting}
            maskClosable={!isSubmitting}
            // Cleared on close rather than on open, matching the decline modal: a
            // sender who cancels mid-sentence and reopens should find their words.
            afterClose={() => setReason("")}
            onCancel={onCancel}
            onOk={() => onConfirm(trimmed)}
            {...Utils_Modal_Responsive(isMobile)}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
                <Alert
                    type="warning"
                    showIcon
                    message="Their signature stops counting, and their old link stops working"
                    description={
                        <>
                            The signature {signerName} already made is kept on the audit trail but
                            no longer counts towards completing <strong>{documentTitle}</strong>.
                            They are emailed a NEW link — any earlier one stops working — and the
                            document waits on them again.
                            {rewindsPastOthers && (
                                <>
                                    {" "}
                                    Parties further along the route go back to waiting until{" "}
                                    {signerName} has signed again.
                                </>
                            )}
                        </>
                    }
                />

                <div>
                    <Typography.Text strong>What needs to change?</Typography.Text>
                    <Typography.Paragraph
                        type="secondary"
                        style={{ fontSize: token.fontSizeSM, marginBottom: token.marginXS }}
                    >
                        {signerName} is emailed this, and it is recorded in the document's audit
                        trail. Without it they have nothing to go on and will sign the same document
                        again.
                    </Typography.Paragraph>
                    <Input.TextArea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={4}
                        maxLength={MAX_REASON_LENGTH}
                        showCount
                        disabled={isSubmitting}
                        placeholder="For example: please initial the amendment on page 3 as well — we added it after you signed."
                    />
                </div>
            </div>
        </Modal>
    );
};
