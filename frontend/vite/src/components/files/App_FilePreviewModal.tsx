import { useState } from "react";
import { App, Button, Modal, Spin, Typography, theme } from "antd";
import { DownloadOutlined, PaperClipOutlined } from "@ant-design/icons";

type Props = {
    open: boolean;
    onClose: () => void;
    /** Pre-resolved URL — either a signed R2 URL or a local blob URL. */
    url: string | null;
    /** Filename for modal title + download anchor. */
    name: string | null;
    /** MIME type — drives image/PDF/generic branches. */
    contentType: string | null;
    /** File size in bytes, optional — shown as subtext. */
    size: number | null;
};

const formatBytes = (n: number | null) => {
    if (!n || n <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let idx = 0;
    let v = n;
    while (v >= 1024 && idx < units.length - 1) {
        v /= 1024;
        idx++;
    }
    return `${v.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
};

/**
 * Universal file preview — used by the attachment strip AND the employee table's
 * file cells. Caller provides a resolved URL (signed for server files, blob for
 * local defer-mode files). Images render at natural size in a shrink-wrapped
 * modal; PDFs render in an iframe; other types fall back to a download-only card.
 */
export const App_FilePreviewModal = ({ open, onClose, url, name, contentType, size }: Props) => {
    const { token } = theme.useToken();
    const { message } = App.useApp();
    const [downloading, setDownloading] = useState(false);

    const handleDownload = async () => {
        if (!url || !name) return;
        // Cross-origin URLs (the R2 worker) silently ignore the anchor's `download`
        // attribute — the browser navigates to the file instead. Fetch the bytes
        // into a blob first, then use a blob URL so the attribute is honored.
        setDownloading(true);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = name;
            a.rel = "noopener";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Give the browser a beat to start the download before reclaiming the URL.
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } catch (err) {
            console.error("Download failed:", err);
            message.error("Download failed");
        } finally {
            setDownloading(false);
        }
    };

    const isImage = !!contentType?.startsWith("image/");

    const body = (() => {
        if (!url || !name) {
            return (
                <div style={{ padding: token.paddingLG, textAlign: "center" }}>
                    <Spin />
                </div>
            );
        }
        if (isImage) {
            // Render the image at its natural size (capped to viewport) — the Modal width
            // is `auto` so the card shrinks to fit. No grey container around it.
            return (
                <img
                    src={url}
                    alt={name}
                    style={{
                        display: "block",
                        maxWidth: "90vw",
                        maxHeight: "85vh",
                        width: "auto",
                        height: "auto",
                        objectFit: "contain",
                    }}
                />
            );
        }
        if (contentType === "application/pdf") {
            return (
                <iframe
                    src={url}
                    title={name}
                    style={{ width: "100%", height: "85vh", border: 0 }}
                />
            );
        }
        return (
            <div
                style={{
                    padding: token.paddingLG,
                    textAlign: "center",
                    background: token.colorFillTertiary,
                    borderRadius: token.borderRadius,
                }}
            >
                <PaperClipOutlined style={{ fontSize: 48, color: token.colorTextTertiary }} />
                <div style={{ marginTop: token.marginSM }}>
                    <Typography.Text strong>{name}</Typography.Text>
                </div>
                <div>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        {contentType ?? "unknown"} {formatBytes(size)}
                    </Typography.Text>
                </div>
                <div style={{ marginTop: token.marginSM }}>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        Preview not available for this file type — use Download below.
                    </Typography.Text>
                </div>
            </div>
        );
    })();

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={name ?? "Preview"}
            // Images: shrink the modal to the image's natural size (capped via maxWidth/Height
            // on the <img>). Everything else keeps the wide layout so PDFs / fallback cards
            // have room to render.
            width={isImage ? "auto" : "90vw"}
            centered
            styles={{ body: { padding: 0 } }}
            destroyOnHidden
            footer={[
                <Button key="close" onClick={onClose}>
                    Close
                </Button>,
                <Button
                    key="download"
                    type="primary"
                    icon={<DownloadOutlined />}
                    disabled={!url || !name}
                    loading={downloading}
                    onClick={handleDownload}
                >
                    Download
                </Button>,
            ]}
        >
            {body}
        </Modal>
    );
};
