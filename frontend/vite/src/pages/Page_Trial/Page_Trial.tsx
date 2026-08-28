// The no-account signing trial (CG-052).
//
// Upload a PDF → place and fill fields → sign and download. Nothing is uploaded,
// nothing is stored, nothing is emailed. Sending a document to a counterparty is
// the boundary that needs an account, and that boundary is stated on the last
// step rather than discovered at it.
//
// STATE IS A HANDFUL OF `useState`s AND THAT IS DELIBERATE. Single page, single owner,
// nothing shared across routes — precisely what the store bible says not to put
// in a TanStack Store. The one piece of module-level state anywhere in the
// feature would be a dropped-file hand-off from the landing page, which is a
// noted follow-up and not worth a store either.
//
// NOTHING SURVIVES A RELOAD, also deliberate. A `File` cannot be serialized, and
// persisting the layout without the PDF would restore coordinates with no page
// under them — a worse experience than starting over, because it looks broken
// rather than empty. A `beforeunload` guard is the honest form of persistence
// here: warn before the work is lost, do not pretend to keep it.
//
// THE PRIVACY CLAIM IS THE FEATURE. Every import on this page is local: the
// burn, the validator, the workspace, the filler, the signature pad. Nothing
// here may acquire a call to Supabase, R2 or the worker — verify that with an
// open Network tab, not by reading this comment.

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Steps, Tooltip, theme } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined } from "@ant-design/icons";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import type { TemplateLayout } from "@/types/template.types";
import { utils_PdfBurn_Client } from "@/utils/pdf/utils_PdfBurn_Client";
import { utils_Pdf_DataUrlToBytes } from "@/utils/pdf/utils_Pdf_DataUrlToBytes";
import { Store_Trial_Actions } from "@/stores/Store_Trial";
import { PageTrial_Upload } from "./PageTrial_Upload";
import { PageTrial_Place } from "./PageTrial_Place";
import { PageTrial_SignAndDownload } from "./PageTrial_SignAndDownload";
import {
    const_Trial_StepLabels,
    const_Trial_Steps,
    utils_Trial_BlockedReason,
    utils_Trial_StepIndex,
    type Trial_Step,
} from "./utils_Trial_Steps";

export const Page_Trial = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const { message } = App.useApp();

    // Seeded FROM THE STORE at first render, not from an effect. A visitor who
    // dropped a PDF on the landing page has already chosen their document;
    // mounting on the upload step and jumping off it one render later would show
    // them a flash of the drop zone they just used. A `useState` initialiser
    // runs before the first paint, so they land straight on placement.
    //
    // The read is PURE and the slot is cleared in an effect below. See
    // `Store_Trial` for why those are two calls: StrictMode double-invokes state
    // initialisers, so a read that also cleared would hand back `null` on the
    // second pass and lose the file in development only.
    const [file, setFile] = useState<File | null>(() => Store_Trial_Actions.peekPendingFile());
    const [step, setStep] = useState<Trial_Step>(() => (file ? "place" : "upload"));
    const [layout, setLayout] = useState<TemplateLayout>([]);
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [signature, setSignature] = useState<string | null>(null);
    const [numPages, setNumPages] = useState(0);
    const [downloading, setDownloading] = useState(false);

    // Emptied once it has been read, so returning to `/try` later starts on the
    // upload step rather than re-opening a document that was already signed.
    // Idempotent, which is what makes it safe under StrictMode's double effect.
    useEffect(() => Store_Trial_Actions.clearPendingFile(), []);

    // One object URL per file, revoked when the file changes or the page
    // unmounts. Without the cleanup every re-upload leaks the previous document
    // for the lifetime of the tab.
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!file) {
            setPdfUrl(null);
            return;
        }
        const url = URL.createObjectURL(file);
        setPdfUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    const hasWork = layout.length > 0 || signature !== null;

    // The honest form of persistence: warn, do not pretend to save. Registered
    // only while there is something to lose, so a visitor who has just landed is
    // never prompted.
    useEffect(() => {
        if (!hasWork) return;
        const handler = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [hasWork]);

    const blockedReason = utils_Trial_BlockedReason({
        step,
        hasFile: file !== null,
        layout,
        numPages,
        signature,
    });

    const stepIndex = utils_Trial_StepIndex(step);

    const handleValueChange = useCallback((fieldId: string, value: unknown) => {
        setValues((prev) => ({ ...prev, [fieldId]: value }));
    }, []);

    const handleLayoutChange = useCallback((next: TemplateLayout) => {
        setLayout(next);
        // Drop values belonging to fields that no longer exist, so a deleted and
        // re-created field cannot inherit the old one's text.
        setValues((prev) => {
            const live = new Set(next.map((f) => f.id));
            return Object.fromEntries(Object.entries(prev).filter(([id]) => live.has(id)));
        });
    }, []);

    const handleDownload = async () => {
        if (!file) return;
        setDownloading(true);
        try {
            const sourcePdfBytes = new Uint8Array(await file.arrayBuffer());

            // The captured signature goes into EVERY signature box the visitor
            // placed. There is one party here, so there is no risk of putting one
            // signer's mark in another's box — the thing the real burn is careful
            // about.
            const signatureImages: Record<string, Uint8Array> = {};
            if (signature) {
                const bytes = await utils_Pdf_DataUrlToBytes(signature);
                for (const field of layout) {
                    if (field.type === "signature" || field.type === "initials") {
                        signatureImages[field.id] = bytes;
                    }
                }
            }

            const result = await utils_PdfBurn_Client({
                sourcePdfBytes,
                layout,
                fieldValues: values,
                signatureImages,
            });

            if (result.usedFallbackFont) {
                // Non-blocking on purpose. The document is already burned and
                // downloadable; the only consequence is that accented characters
                // may be missing, and refusing to hand over the file over that
                // would be the worse outcome.
                message.warning(
                    "The document font could not be loaded, so accented characters may not appear."
                );
            }

            const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = file.name.replace(/\.pdf$/i, "") + "-signed.pdf";
            anchor.click();
            // Next frame, not immediately: revoking before the browser has begun
            // the download cancels it. Same idiom as `useM_Signing_DownloadCopy`.
            requestAnimationFrame(() => URL.revokeObjectURL(url));
        } catch (error) {
            // Every piece of state is kept and the button returns to idle. A
            // failed burn must never navigate away from the work that produced
            // it — a password-protected PDF is the common cause and the visitor
            // can still go back and swap the file.
            message.error(
                error instanceof Error && /password|encrypt/i.test(error.message)
                    ? "This PDF is password-protected, so it cannot be signed here."
                    : "We could not build the signed PDF. The file may be damaged."
            );
        } finally {
            setDownloading(false);
        }
    };

    const stepItems = useMemo(
        () => const_Trial_Steps.map((s) => ({ title: const_Trial_StepLabels[s] })),
        []
    );

    return (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div
                style={{
                    padding: `${token.paddingXS}px ${isMobile ? token.paddingMD : token.paddingLG}px`,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgContainer,
                    flexShrink: 0,
                }}
            >
                <Steps
                    size="small"
                    current={stepIndex}
                    items={stepItems}
                    responsive={false}
                    // Not clickable. Jumping to "sign" from "upload" would land on
                    // a filler with no document, and the Back button already
                    // covers the only backwards move that makes sense.
                />
            </div>

            {step === "upload" && (
                <PageTrial_Upload
                    onAccepted={(accepted) => {
                        setFile(accepted);
                        // A new document invalidates coordinates measured against
                        // the old one, so the layout and its values go with it.
                        setLayout([]);
                        setValues({});
                        setNumPages(0);
                        setStep("place");
                    }}
                />
            )}

            {step === "place" && pdfUrl && (
                <PageTrial_Place
                    pdfUrl={pdfUrl}
                    layout={layout}
                    onLayoutChange={handleLayoutChange}
                    values={values}
                    onValueChange={handleValueChange}
                    onNumPagesChange={setNumPages}
                />
            )}

            {step === "sign" && pdfUrl && (
                <PageTrial_SignAndDownload
                    pdfUrl={pdfUrl}
                    layout={layout}
                    values={values}
                    onValueChange={handleValueChange}
                    signature={signature}
                    onSignatureChange={setSignature}
                    onDownload={() => void handleDownload()}
                    downloading={downloading}
                />
            )}

            {step !== "upload" && (
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: token.marginSM,
                        padding: `${token.paddingSM}px ${
                            isMobile ? token.paddingMD : token.paddingLG
                        }px`,
                        paddingBottom: `calc(${token.paddingSM}px + var(--app-safe-bottom))`,
                        borderTop: `1px solid ${token.colorBorderSecondary}`,
                        background: token.colorBgContainer,
                        flexShrink: 0,
                    }}
                >
                    <Button
                        icon={<ArrowLeftOutlined />}
                        onClick={() => setStep(step === "sign" ? "place" : "upload")}
                    >
                        Back
                    </Button>

                    {step === "place" && (
                        // A disabled button with no explanation is the most common
                        // way a demo loses someone, so the reason is always on it.
                        <Tooltip title={blockedReason ?? ""}>
                            <Button
                                type="primary"
                                disabled={blockedReason !== null}
                                onClick={() => setStep("sign")}
                            >
                                Continue <ArrowRightOutlined />
                            </Button>
                        </Tooltip>
                    )}
                </div>
            )}
        </div>
    );
};
