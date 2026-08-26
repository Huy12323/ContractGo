// Signature capture — draw, type, or upload.
//
// Generalized from `App_SignaturePad` (which stays until its v1 onboarding
// consumers retire). Two changes:
//
//   * a THIRD mode, `type`. Typing a name is the most-used option in every
//     comparable product, and it is the only one that works on a device with no
//     pointer precision. It renders to a PNG on a canvas here, so everything
//     downstream — upload, hash, burn — sees one kind of artifact.
//   * the mode is REPORTED, not just used. `signature_captures.capture_method`
//     records provenance as evidence: "typed" and "drawn" are legally different
//     acts, and a capture that cannot say which it was is weaker evidence.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Segmented, Typography, Upload, theme, App } from "antd";
import { ClearOutlined, UploadOutlined } from "@ant-design/icons";
import SignatureCanvas from "react-signature-canvas";
import type { UploadProps } from "antd";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

export type SignatureCapture_Method = "drawn" | "typed" | "uploaded";

type Props = {
    value: string | null;
    onChange: (dataUrl: string | null, method: SignatureCapture_Method) => void;
    /** Pre-fills the typed mode — the signer's name as the sender addressed them. */
    defaultTypedName?: string;
    height?: number;
};

/**
 * The width the ARTIFACT is rendered at, and never the width of the pad on
 * screen. A typed signature captured on a 390px phone and one captured on a
 * 1440px desktop must produce the same PNG — the burned document's resolution
 * cannot be a function of which device the signer happened to hold. The drawn
 * pad measures itself (see `padWidth` below); only this constant is fixed.
 */
const PAD_WIDTH = 480;
const DEFAULT_HEIGHT = 180;
/** A finger needs more vertical room than a mouse to produce a legible mark. */
const MOBILE_HEIGHT = 200;

/** Cursive-ish stack. A typed signature that renders in the body font reads as
 *  a form field rather than a mark, which undermines its evidentiary feel. */
const TYPED_FONT_STACK = '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive';

export const App_SignatureCapture = ({ value, onChange, defaultTypedName = "", height }: Props) => {
    const { token } = theme.useToken();
    const { message } = App.useApp();
    const { isMobile } = useApp_Breakpoint();
    // Typing is the default on a touch device, and the header comment above says
    // why: it "is the only one that works on a device with no pointer precision".
    // Drawing stays one tap away for anyone who wants it — this is the default,
    // not a restriction. `useState`'s initializer runs once, so a later resize
    // never yanks the signer out of the mode they chose.
    const [mode, setMode] = useState<SignatureCapture_Method>(() => (isMobile ? "typed" : "drawn"));
    const [typedName, setTypedName] = useState(defaultTypedName);
    const sigCanvasRef = useRef<SignatureCanvas | null>(null);
    const padFrameRef = useRef<HTMLDivElement>(null);

    const padHeight = height ?? (isMobile ? MOBILE_HEIGHT : DEFAULT_HEIGHT);

    // The CSS width of the drawing pad, measured rather than assumed.
    //
    // THE BUG THIS FIXES: the canvas used to be created at a fixed 480px backing
    // store and then stretched to the container with `style: { width: '100%' }`.
    // The backing store is the coordinate space `signature_pad` maps pointer
    // events into — it converts a pointer to `clientX - rect.left` and does NOT
    // rescale by `canvas.width / rect.width` — so on a 350px-wide pad every stroke
    // landed ~1.37× to the right of the finger and came out squashed. Matching the
    // backing store to the measured CSS box is what puts the ink under the finger.
    const [padWidth, setPadWidth] = useState(0);
    useEffect(() => {
        const el = padFrameRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) setPadWidth(entry.contentRect.width);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [mode]);

    // The last committed stroke, kept so a resize can repaint it. It cannot be
    // recovered from the canvas at resize time: assigning `canvas.width` is what
    // clears the backing store, and by the time an effect observing the new width
    // runs, the pixels are already gone.
    const lastDrawnRef = useRef<string | null>(null);

    // SIZING IS OWNED HERE, not by `canvasProps`. Two things have to happen
    // together and in order — allocate the backing store at device resolution,
    // then `scale(dpr)` so the drawing transform is back in CSS pixels, which is
    // the space `signature_pad`'s pointer math works in. Passing `width`/`height`
    // through `canvasProps` would let React do the first without the second.
    // Assigning `width` also resets the context transform to identity, so the
    // `scale` must follow every assignment rather than run once.
    useEffect(() => {
        const sig = sigCanvasRef.current;
        if (mode !== "drawn" || !sig || padWidth === 0) return;
        const canvas = sig.getCanvas();
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(padWidth * dpr);
        canvas.height = Math.round(padHeight * dpr);
        ctx.scale(dpr, dpr);

        const snapshot = lastDrawnRef.current;
        if (snapshot) {
            // `ratio: 1` because the transform above already accounts for the
            // device ratio; letting `signature_pad` apply it a second time would
            // paint the mark at 1/dpr of its size in the corner.
            sig.fromDataURL(snapshot, { ratio: 1, width: padWidth, height: padHeight });
        } else {
            sig.clear();
        }
    }, [mode, padWidth, padHeight]);

    // `onChange` is a fresh closure on every parent render. Holding it in a ref
    // keeps the typed-signature effect's dependency list complete without
    // re-rendering the signature on every keystroke elsewhere on the page.
    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    });

    const handleDrawEnd = () => {
        const sig = sigCanvasRef.current;
        if (!sig || sig.isEmpty()) {
            lastDrawnRef.current = null;
            onChange(null, "drawn");
            return;
        }
        const dataUrl = sig.toDataURL("image/png");
        lastDrawnRef.current = dataUrl;
        onChange(dataUrl, "drawn");
    };

    // Rendered off-screen at 2× so the burned PDF isn't visibly soft — the box a
    // signature lands in is often wider than the pad it was captured on.
    //
    // Deliberately sized from the CONSTANTS and never from `padWidth` or the
    // responsive `padHeight`: two signers typing the same name must produce the
    // same artifact whether they were on a phone or a desktop. The pad on screen
    // is fluid; what gets hashed, uploaded and burned is not.
    const renderTypedSignature = useCallback((text: string): string | null => {
        if (!text.trim()) return null;
        const canvas = document.createElement("canvas");
        canvas.width = PAD_WIDTH * 2;
        canvas.height = DEFAULT_HEIGHT * 2;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.scale(2, 2);
        ctx.font = `48px ${TYPED_FONT_STACK}`;
        // Hex literal, not a theme token, for the same reason as
        // `const_TemplateSignerRoleColors`: this pixel data is persisted and
        // burned into the PDF. Ink must be black in the archived document
        // regardless of which theme the signer happened to be using.
        ctx.fillStyle = "#000000";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text.trim(), PAD_WIDTH / 2, DEFAULT_HEIGHT / 2, PAD_WIDTH - 24);
        return canvas.toDataURL("image/png");
    }, []);

    useEffect(() => {
        if (mode !== "typed") return;
        onChangeRef.current(renderTypedSignature(typedName), "typed");
    }, [mode, typedName, renderTypedSignature]);

    const uploadProps: UploadProps = {
        accept: "image/png,image/jpeg",
        showUploadList: false,
        beforeUpload: (file) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result;
                if (typeof result === "string") onChange(result, "uploaded");
                else message.error("Failed to read signature image");
            };
            reader.onerror = () => message.error("Failed to read signature image");
            reader.readAsDataURL(file);
            return false;
        },
    };

    const handleClear = () => {
        sigCanvasRef.current?.clear();
        lastDrawnRef.current = null;
        setTypedName("");
        onChange(null, mode);
    };

    const frameStyle: React.CSSProperties = {
        // Full-bleed on a phone. The pad is the one control on this page that gets
        // better the wider it is, and 480px of it off the right edge of a 390px
        // screen is 480px the signer cannot draw in.
        width: isMobile ? "100%" : PAD_WIDTH,
        maxWidth: "100%",
        minHeight: padHeight,
        border: `1px dashed ${token.colorBorder}`,
        borderRadius: token.borderRadiusSM,
        background: token.colorBgContainer,
    };

    // Draw first on a pointer, Type first on a finger. The order matters as much
    // as the default — the leftmost segment reads as the recommended one.
    const optDraw = { label: "Draw", value: "drawn" as const };
    const optType = { label: "Type", value: "typed" as const };
    const optUpload = { label: "Upload", value: "uploaded" as const };
    const orderedModeOptions = isMobile
        ? [optType, optDraw, optUpload]
        : [optDraw, optType, optUpload];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
            <div
                style={{
                    display: "flex",
                    alignItems: isMobile ? "stretch" : "center",
                    justifyContent: "space-between",
                    flexDirection: isMobile ? "column" : "row",
                    gap: token.marginXS,
                }}
            >
                <Typography.Text strong>Your signature</Typography.Text>
                <Segmented<SignatureCapture_Method>
                    size={isMobile ? "middle" : "small"}
                    block={isMobile}
                    value={mode}
                    onChange={(next) => {
                        setMode(next);
                        sigCanvasRef.current?.clear();
                        lastDrawnRef.current = null;
                        // Switching mode discards the mark — carrying a drawn
                        // signature into "typed" would misreport how it was made.
                        onChange(next === "typed" ? renderTypedSignature(typedName) : null, next);
                    }}
                    options={orderedModeOptions}
                />
            </div>

            {mode === "drawn" && (
                <div
                    ref={padFrameRef}
                    style={{ ...frameStyle, height: padHeight, position: "relative" }}
                >
                    <SignatureCanvas
                        ref={(ref) => {
                            sigCanvasRef.current = ref;
                        }}
                        penColor={token.colorText}
                        canvasProps={{
                            // No `width`/`height` here on purpose — the sizing
                            // effect above owns the backing store so the
                            // `scale(dpr)` that has to follow it cannot be skipped.
                            //
                            // `no-touch-scroll` sets `touch-action: none`. Without
                            // it iOS claims a drag on the canvas as a page scroll
                            // and the pad receives a `pointerdown` and nothing more.
                            className: "no-touch-scroll",
                            style: { width: "100%", height: "100%", display: "block" },
                        }}
                        onEnd={handleDrawEnd}
                    />
                </div>
            )}

            {mode === "typed" && (
                <div style={{ display: "flex", flexDirection: "column", gap: token.marginXS }}>
                    <Input
                        placeholder="Type your full name"
                        value={typedName}
                        onChange={(e) => setTypedName(e.target.value)}
                        size="large"
                    />
                    <div
                        style={{
                            ...frameStyle,
                            height: padHeight,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: `0 ${token.paddingSM}px`,
                            overflow: "hidden",
                            fontFamily: TYPED_FONT_STACK,
                            // PREVIEW ONLY. The artifact is always rendered at 48px
                            // on a 480px canvas by `renderTypedSignature`; this is
                            // just what fits on the screen in front of the signer.
                            fontSize: isMobile ? 36 : 48,
                            whiteSpace: "nowrap",
                            color: typedName.trim() ? token.colorText : token.colorTextTertiary,
                        }}
                    >
                        {typedName.trim() || "Preview"}
                    </div>
                </div>
            )}

            {mode === "uploaded" && (
                <div
                    style={{
                        ...frameStyle,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: token.paddingSM,
                    }}
                >
                    {value ? (
                        <img
                            src={value}
                            alt="Uploaded signature"
                            style={{ maxWidth: "100%", maxHeight: padHeight, objectFit: "contain" }}
                        />
                    ) : (
                        <Upload {...uploadProps}>
                            <Button icon={<UploadOutlined />}>Upload signature image</Button>
                        </Upload>
                    )}
                </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button
                    size={isMobile ? "middle" : "small"}
                    icon={<ClearOutlined />}
                    onClick={handleClear}
                    disabled={!value}
                >
                    Clear
                </Button>
            </div>
        </div>
    );
};
