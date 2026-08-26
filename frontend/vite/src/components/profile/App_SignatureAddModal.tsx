import { useState } from "react";
import { Button, Form, Input, Modal, theme } from "antd";
import {
    App_SignatureCapture,
    type SignatureCapture_Method,
} from "@/components/signing/App_SignatureCapture";
import { useM_Signatures_Create } from "@/hooks/useM_Signatures_Create";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Modal_Responsive } from "@/utils/Utils_Modal_Responsive";

type Props = {
    open: boolean;
    onClose: () => void;
    /** Pre-fills the typed mode, so the common case is one tap. */
    defaultTypedName?: string;
};

/**
 * "Add a signature" — a thin wrapper around the UNMODIFIED `App_SignatureCapture`.
 *
 * The draw / type / upload requirement is entirely satisfied by that component,
 * which already renders a DPR-correct pad, a cursive typed preview and an image
 * dropzone, and already reports WHICH of the three produced the mark. CG-029 adds
 * no capture code — it only gives the result somewhere to live.
 *
 * The optional name is worth the field: a library of one needs no labels, but the
 * moment someone keeps a full signature and a set of initials, two identical
 * cards are indistinguishable at a glance.
 */
export const App_SignatureAddModal = ({ open, onClose, defaultTypedName }: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const mCreate = useM_Signatures_Create();

    const [dataUrl, setDataUrl] = useState<string | null>(null);
    const [method, setMethod] = useState<SignatureCapture_Method>("drawn");
    const [name, setName] = useState("");

    const handleClose = () => {
        setDataUrl(null);
        setName("");
        onClose();
    };

    const handleSave = () => {
        if (!dataUrl) return;
        mCreate.mutation.mutate(
            { dataUrl, capture_method: method, name },
            { onSuccess: handleClose }
        );
    };

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            title="Add a signature"
            footer={null}
            centered
            destroyOnHidden
            {...Utils_Modal_Responsive(isMobile, 560)}
        >
            <div
                style={{
                    marginTop: token.marginMD,
                    display: "flex",
                    flexDirection: "column",
                    gap: token.marginMD,
                }}
            >
                <App_SignatureCapture
                    value={dataUrl}
                    onChange={(next, nextMethod) => {
                        setDataUrl(next);
                        setMethod(nextMethod);
                    }}
                    defaultTypedName={defaultTypedName}
                />

                <Form layout="vertical" requiredMark={false}>
                    <Form.Item label="Label (optional)" style={{ marginBottom: 0 }}>
                        <Input
                            placeholder="e.g. Full signature, Initials"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            maxLength={40}
                        />
                    </Form.Item>
                </Form>

                <Button
                    type="primary"
                    block
                    size="large"
                    disabled={!dataUrl}
                    loading={mCreate.mutation.isPending}
                    onClick={handleSave}
                >
                    Save signature
                </Button>
            </div>
        </Modal>
    );
};
