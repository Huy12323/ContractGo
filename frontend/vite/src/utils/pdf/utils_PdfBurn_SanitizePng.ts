// The PNG CRC workaround, transcribed from `_shared/pdfBurn.ts`.
//
// pdf-lib 1.17.1 reads PNG chunk CRCs with `DataView.getInt32`, so any CRC at or
// above 2^31 comes back NEGATIVE and blows up the `setUint32` that follows.
// Zeroing the offending CRCs before embed is the documented workaround; pdf-lib
// does not verify them, and the PDF that comes out is valid.
//
// MANDATORY, not defensive. Signature pads emit canvas PNGs whose CRCs land
// above the threshold often enough that skipping this fails a visible share of
// real signatures — which is why the version is pinned exactly in package.json
// rather than caret-ranged. If pdf-lib is ever upgraded, re-check whether this
// is still needed before deleting it.

/** Zeroes any PNG chunk CRC >= 2^31 so pdf-lib 1.17.1 can embed the image. */
export const utils_PdfBurn_SanitizePng = (png: Uint8Array): Uint8Array => {
    const buf = new Uint8Array(png);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    // 8 = the PNG signature, which precedes the first chunk. A chunk is
    // 4 (length) + 4 (type) + length (data) + 4 (CRC) = 12 bytes of overhead.
    let offset = 8;
    while (offset + 12 <= buf.length) {
        const len = view.getUint32(offset);
        const crcPos = offset + 8 + len;
        // A truncated final chunk means the file is damaged; stop rather than
        // read past the end. The embed will fail with its own error, which is a
        // better message than one from here.
        if (crcPos + 4 > buf.length) break;
        if (view.getUint32(crcPos) > 0x7fffffff) view.setUint32(crcPos, 0);
        offset = crcPos + 4;
    }

    return buf;
};
