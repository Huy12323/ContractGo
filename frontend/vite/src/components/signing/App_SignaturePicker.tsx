import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Checkbox, Spin, Tag, Typography, theme } from "antd";
import { CheckCircleFilled, EditOutlined } from "@ant-design/icons";
import {
    App_SignatureCapture,
    type SignatureCapture_Method,
} from "@/components/signing/App_SignatureCapture";
import { App_SignatureImage } from "@/components/signing/App_SignatureImage";
import { useQ_Tables_MySignatures } from "@/hooks/useQ_Tables_MySignatures";
import { Signature_ReadUrl_QueryOptions } from "@/hooks/useQ_Signature_ReadUrl";
import { Utils_Signature_UrlToDataUrl } from "@/utils/Utils_Signature_DataUrl";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

type Props = {
    value: string | null;
    onChange: (dataUrl: string | null, method: SignatureCapture_Method) => void;
    defaultTypedName?: string;
    /**
     * Whether a freshly made mark should be added to the library. Owned by
     * `Page_Sign` because the save happens AFTER a successful commit — saving a
     * signature for a document that failed to submit would leave the library
     * holding a mark from a ceremony that never happened.
     */
    saveForLater: boolean;
    onSaveForLaterChange: (save: boolean) => void;
};

/**
 * Choose a saved signature, or make a new one (CG-029).
 *
 * WHY THIS IS SAFE ON A PUBLIC ROUTE. The signing surface lives at
 * `_public/sign.$accessToken` and is readable by anyone holding the link, but
 * `App_SigningAccountGate` requires a session on the address the document names
 * before the irreversible act — and `PageSign_SignStep` returns the gate instead
 * of this component whenever `accountStatus !== 'ok'`. So by the time the picker
 * renders, `auth.uid()` exists and RLS returns that person's library and nobody
 * else's.
 *
 * WHAT IT DOES NOT CHANGE. A selected signature is converted to the same PNG data
 * URL the pad produces and handed to the same `onChange`. `Page_Sign` keeps one
 * `signature` string, `signing_submit` keeps receiving `signature_base64`, and a
 * fresh `signature_captures` row with its own SHA-256 is still written per
 * signing event. The library is a shortcut to the bytes, never a substitute for
 * the capture.
 *
 * WHEN THE LIBRARY IS EMPTY it renders nothing of its own and defers entirely to
 * `App_SignatureCapture` — a first-time signer sees exactly the screen they saw
 * before this feature existed.
 */
export const App_SignaturePicker = ({
    value,
    onChange,
    defaultTypedName,
    saveForLater,
    onSaveForLaterChange,
}: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const qSignatures = useQ_Tables_MySignatures();

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [resolvingId, setResolvingId] = useState<string | null>(null);
    // `true` once the signer asks to make a new mark. Never flipped back
    // automatically: having chosen to draw, they should not be yanked back to the
    // card list by a refetch.
    const [creatingNew, setCreatingNew] = useState(false);

    // Held in a ref so the auto-select effect below can call the latest `onChange`
    // without re-running every time `Page_Sign` re-renders and hands us a new one.
    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    });

    const applySignature = useCallback(
        async (signatureId: string, method: SignatureCapture_Method) => {
            setResolvingId(signatureId);
            try {
                const { url } = await queryClient.fetchQuery(
                    Signature_ReadUrl_QueryOptions(signatureId)
                );
                const dataUrl = await Utils_Signature_UrlToDataUrl(url);
                setSelectedId(signatureId);
                onChangeRef.current(dataUrl, method);
            } catch (err) {
                console.error(err);
                message.error("Could not load that signature. Draw a new one to continue.");
                setSelectedId(null);
                onChangeRef.current(null, method);
            } finally {
                setResolvingId(null);
            }
        },
        [queryClient, message]
    );

    // Preselect the default, so the common path is zero clicks.
    //
    // Guarded on `!value` as well as on `hasAutoSelected`: arriving with a mark
    // already in hand (stepping Back from the commit screen and returning) must
    // not silently replace what the signer chose last time.
    const hasAutoSelected = useRef(false);
    useEffect(() => {
        if (hasAutoSelected.current || creatingNew || value) return;
        const preferred = qSignatures.defaultSignature;
        if (!preferred) return;
        hasAutoSelected.current = true;
        void applySignature(preferred.id, preferred.capture_method);
    }, [qSignatures.defaultSignature, creatingNew, value, applySignature]);

    // The pad, plus the one offer that populates the library. Shared by the two
    // routes to it: a signer with nothing saved (which is everyone, once), and a
    // signer who has chosen to make a new mark anyway.
    //
    // The checkbox is disabled until a mark exists, because "save this signature"
    // with nothing on the pad is an instruction with no object.
    const padWithSaveOffer = (backToSaved: boolean) => (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
            <App_SignatureCapture
                value={value}
                onChange={onChange}
                defaultTypedName={defaultTypedName}
            />
            <Checkbox
                checked={saveForLater}
                disabled={!value}
                onChange={(e) => onSaveForLaterChange(e.target.checked)}
            >
                Save this signature to my profile for next time
            </Checkbox>
            {backToSaved && (
                <Button
                    type="link"
                    style={{ alignSelf: "flex-start", paddingInline: 0 }}
                    onClick={() => {
                        setCreatingNew(false);
                        // Drop the in-progress mark. Returning to the card list
                        // with a drawn signature still held would show no card
                        // selected while a signature nonetheless existed.
                        setSelectedId(null);
                        onChange(null, "drawn");
                    }}
                >
                    Use a saved signature instead
                </Button>
            )}
        </div>
    );

    if (!qSignatures.query.isLoading && qSignatures.signatures.length === 0) {
        return padWithSaveOffer(false);
    }

    if (creatingNew) {
        return padWithSaveOffer(true);
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
            <Typography.Text strong>Your signature</Typography.Text>

            {qSignatures.query.isLoading ? (
                <div
                    style={{ display: "flex", justifyContent: "center", padding: token.paddingLG }}
                >
                    <Spin />
                </div>
            ) : (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                            ? "1fr"
                            : "repeat(auto-fill, minmax(200px, 1fr))",
                        gap: token.marginSM,
                    }}
                >
                    {qSignatures.signatures.map((signature) => {
                        const isSelected = selectedId === signature.id;
                        const isResolving = resolvingId === signature.id;

                        return (
                            <Card
                                key={signature.id}
                                size="small"
                                hoverable
                                onClick={() =>
                                    applySignature(signature.id, signature.capture_method)
                                }
                                style={{
                                    cursor: "pointer",
                                    borderColor: isSelected ? token.colorPrimary : undefined,
                                    // Two signals, not one. Colour alone is not an
                                    // accessible way to say "this is the one that
                                    // will be used" — the tick below carries it too.
                                    boxShadow: isSelected
                                        ? `0 0 0 1px ${token.colorPrimary}`
                                        : undefined,
                                }}
                                styles={{
                                    body: { padding: token.paddingSM, position: "relative" },
                                }}
                            >
                                {isResolving && (
                                    <div
                                        style={{
                                            position: "absolute",
                                            inset: 0,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            background: token.colorBgMask,
                                            borderRadius: token.borderRadiusSM,
                                        }}
                                    >
                                        <Spin size="small" />
                                    </div>
                                )}

                                <App_SignatureImage
                                    signatureId={signature.id}
                                    alt={signature.name ?? "Saved signature"}
                                    height={56}
                                />

                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: token.marginXXS,
                                        marginTop: token.marginXS,
                                    }}
                                >
                                    <Typography.Text
                                        ellipsis
                                        style={{ fontSize: token.fontSizeSM }}
                                    >
                                        {signature.name ?? "Saved signature"}
                                    </Typography.Text>
                                    {isSelected ? (
                                        <CheckCircleFilled style={{ color: token.colorPrimary }} />
                                    ) : (
                                        signature.is_default && (
                                            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                                                Default
                                            </Tag>
                                        )
                                    )}
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            <Button
                icon={<EditOutlined />}
                style={{ alignSelf: isMobile ? "stretch" : "flex-start" }}
                onClick={() => {
                    setCreatingNew(true);
                    setSelectedId(null);
                    // The saved mark is withdrawn as the pad opens, so the commit
                    // button cannot stay enabled on a signature the signer has
                    // just navigated away from.
                    onChange(null, "drawn");
                }}
            >
                Sign a new signature
            </Button>
        </div>
    );
};
