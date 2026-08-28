// PNG data URL → bytes, for handing a captured signature to pdf-lib.
//
// The signature pad (`App_SignatureCapture`) emits a data URL and pdf-lib's
// `embedPng` wants a `Uint8Array`, so something has to bridge them. Decoded via
// `fetch` rather than `atob` + a `charCodeAt` loop, for the same reason
// `Utils_Signature_DataUrl.ts` gives: `fetch` parses data URLs natively, so the
// base64 decoding and its off-by-one hazards are the platform's problem.
//
// Not merged into `Utils_Signature_DataUrl.ts`: that module is about the
// signature LIBRARY (data URL <-> `File` <-> R2), and this conversion belongs to
// the burn. Same input shape, different concern.

/** PNG data URL → raw bytes. Throws if the URL is not decodable. */
export const utils_Pdf_DataUrlToBytes = async (dataUrl: string): Promise<Uint8Array> => {
    const response = await fetch(dataUrl);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
};
