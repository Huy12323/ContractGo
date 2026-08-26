/**
 * Conversions between the two forms a signature takes (CG-029).
 *
 * The capture pad produces a PNG DATA URL, and `signing_submit` consumes one as
 * `signature_base64`. The library stores BYTES in R2. So a signature crosses this
 * boundary twice: once on the way into the library, and once on the way back out
 * to pre-fill a signing session. Both directions live here so neither is
 * re-implemented inline at a call site.
 */

/** The one content type the signature namespace accepts — see `files_r2_upload-start`. */
export const SIGNATURE_CONTENT_TYPE = "image/png";

/**
 * PNG data URL → `File`, for handing to `useM_Files_Upload`.
 *
 * Decoded via `fetch` rather than by hand-rolling `atob` + a `Uint8Array` loop:
 * `fetch` parses data URLs natively, which means the base64 decoding, the
 * `charCodeAt` loop and their off-by-one hazards are the platform's problem
 * rather than ours.
 */
export const Utils_Signature_DataUrlToFile = async (
    dataUrl: string,
    fileName = "signature.png"
): Promise<File> => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], fileName, { type: SIGNATURE_CONTENT_TYPE });
};

/**
 * Signed URL → PNG data URL, for pre-filling a signing session from a saved
 * signature.
 *
 * The result is handed to the same `onChange` the capture pad calls, so from
 * `Page_Sign`'s point of view a saved signature and a freshly drawn one are the
 * same kind of value and `signing_submit` needs no new branch.
 *
 * `FileReader` rather than a manual base64 encode for the same reason as above.
 */
export const Utils_Signature_UrlToDataUrl = async (url: string): Promise<string> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not load signature image: HTTP ${response.status}`);
    }
    const blob = await response.blob();

    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result === "string") resolve(result);
            else reject(new Error("Could not read signature image"));
        };
        reader.onerror = () => reject(new Error("Could not read signature image"));
        reader.readAsDataURL(blob);
    });
};
