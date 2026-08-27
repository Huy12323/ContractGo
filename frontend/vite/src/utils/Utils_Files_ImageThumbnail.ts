/**
 * Client-side image thumbnail generator — resizes an image File to a webp Blob
 * via Canvas. Used by the upload flow (AHR-1711) before the image hits R2, so a
 * thumbnail can be uploaded alongside the original (landing on
 * `files.thumbnail_r2_key` — AHR-1705). Non-image files go through the
 * microservice path (AHR-1709) instead.
 *
 * Contract: returns a Blob on success, `null` on any failure (non-image MIME,
 * decode error, tainted canvas, toBlob unsupported). Callers should treat `null`
 * as "no thumbnail, fall back to generic file icon in the attachment strip" —
 * never as a hard error that fails the underlying upload.
 */

type Options = {
    /** Max dimension in px on the longer edge. Aspect ratio preserved, no upscale. Default 200. */
    maxDim?: number;
    /** WebP quality 0..1. Default 0.8. */
    quality?: number;
};

const loadImage = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("image decode failed"));
        img.src = url;
    });

const canvasToBlob = (
    canvas: HTMLCanvasElement,
    type: string,
    quality: number
): Promise<Blob | null> =>
    new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), type, quality);
    });

export const Utils_Files_ImageThumbnail = async (
    file: File,
    opts?: Options
): Promise<Blob | null> => {
    if (!file.type.startsWith("image/")) return null;

    const maxDim = opts?.maxDim ?? 200;
    const quality = opts?.quality ?? 0.8;

    const objectUrl = URL.createObjectURL(file);
    try {
        const img = await loadImage(objectUrl);
        // Preserve aspect ratio; cap at 1 so we never upscale a small source.
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const targetW = Math.max(1, Math.round(img.naturalWidth * scale));
        const targetH = Math.max(1, Math.round(img.naturalHeight * scale));

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, targetW, targetH);

        return await canvasToBlob(canvas, "image/webp", quality);
    } catch {
        return null;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
};
