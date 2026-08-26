/**
 * PAdES plumbing — placeholder insertion, digest preparation, and CMS splicing.
 *
 * This is the vendor-agnostic half of digital signing. Every signing driver
 * (mock, CeCA remote, local HSM) uses the *same* three steps:
 *
 *   1. addSignaturePlaceholder()  — reserve a /Sig dict + zero-filled /Contents
 *   2. prepareForSigning()        — compute the ByteRange and the exact bytes
 *                                   a signer must digest
 *   3. spliceCms()                — write the returned DER into /Contents
 *
 * Drivers differ *only* in who computes the CMS SignedData in between. The mock
 * driver does it locally with node-forge; a CeCA vendor does it remotely and
 * hands back DER. Keeping the splice here means adding a vendor never touches
 * PDF byte manipulation.
 *
 * Consumers must map these in their own `deno.json`:
 *
 *     "@signpdf/placeholder-plain": "npm:@signpdf/placeholder-plain@3",
 *     "@signpdf/utils":             "npm:@signpdf/utils@3",
 *     "node-forge":                 "npm:node-forge@1"
 *
 * Note the input PDF must be saved WITHOUT object streams
 * (`pdfDoc.save({ useObjectStreams: false })`) — a classic xref table is
 * required for the incremental update a reader will accept.
 */

import { Buffer } from "node:buffer";
import { plainAddPlaceholder } from "@signpdf/placeholder-plain";
import { findByteRange, SUBFILTER_ETSI_CADES_DETACHED } from "@signpdf/utils";

/** Bytes reserved for the CMS blob. RSA-2048 + cert chain fits comfortably in 8k. */
export const DEFAULT_SIGNATURE_LENGTH = 8192;

export type PadesLevel = "B-B" | "B-T" | "B-LT" | "B-LTA";

export type SignatureAppearance = {
    reason?: string;
    location?: string;
    contactInfo?: string;
    /** Name shown in the reader's signature panel. */
    name?: string;
};

/**
 * Step 1 — insert a signature dictionary with a zero-filled /Contents window.
 *
 * Uses the PAdES subfilter (`ETSI.CAdES.detached`) rather than the legacy
 * `adbe.pkcs7.detached`, which is what makes the result a PAdES signature
 * rather than a plain Acrobat one.
 */
export function addSignaturePlaceholder(args: {
    pdfBytes: Uint8Array;
    appearance?: SignatureAppearance;
    signatureLength?: number;
}): Uint8Array {
    const { pdfBytes, appearance = {}, signatureLength = DEFAULT_SIGNATURE_LENGTH } = args;

    const out = plainAddPlaceholder({
        pdfBuffer: Buffer.from(pdfBytes),
        reason: appearance.reason ?? "Signed via ContractGo",
        location: appearance.location ?? "",
        contactInfo: appearance.contactInfo ?? "",
        name: appearance.name ?? "",
        signatureLength,
        subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    });

    return new Uint8Array(out);
}

export type SigningPreparation = {
    /** The four-element /ByteRange the verifier will recompute. */
    byteRange: [number, number, number, number];
    /** Exactly the bytes that must be digested — the file minus the /Contents window. */
    signablePayload: Uint8Array;
    /** Byte offset of the `<` opening the /Contents hex string. */
    contentsStart: number;
    /** Number of hex characters reserved inside /Contents. */
    placeholderHexLength: number;
};

/**
 * Step 2 — resolve the ByteRange and concatenate the two signed spans.
 *
 * The payload is the whole file with the `<...>` /Contents window excised. Any
 * signer — local or remote — must digest precisely this and nothing else.
 */
export function prepareForSigning(pdfWithPlaceholder: Uint8Array): SigningPreparation {
    const buf = Buffer.from(pdfWithPlaceholder);
    const { byteRangePlaceholder } = findByteRange(buf);

    if (!byteRangePlaceholder) {
        throw new Error(
            "pades: no ByteRange placeholder found — was addSignaturePlaceholder() run?"
        );
    }

    // Replace the placeholder with the real offsets before digesting: the
    // ByteRange itself is inside the signed region, so it must hold its final
    // values at digest time or verification fails.
    const raw = buf.toString("latin1");
    const placeholderPos = raw.indexOf(byteRangePlaceholder);
    const contentsStart = raw.indexOf("<", placeholderPos + byteRangePlaceholder.length);
    const contentsEnd = raw.indexOf(">", contentsStart);

    if (contentsStart === -1 || contentsEnd === -1) {
        throw new Error("pades: could not locate the /Contents window");
    }

    const placeholderHexLength = contentsEnd - contentsStart - 1;

    const byteRange: [number, number, number, number] = [
        0,
        contentsStart,
        contentsEnd + 1,
        buf.length - (contentsEnd + 1),
    ];

    const actualByteRange = `/ByteRange [${byteRange.join(" ")}]`.padEnd(
        byteRangePlaceholder.length,
        " "
    );
    const withRealRange = Buffer.from(raw.replace(byteRangePlaceholder, actualByteRange), "latin1");

    const signablePayload = Buffer.concat([
        withRealRange.subarray(byteRange[0], byteRange[0] + byteRange[1]),
        withRealRange.subarray(byteRange[2], byteRange[2] + byteRange[3]),
    ]);

    return {
        byteRange,
        signablePayload: new Uint8Array(signablePayload),
        contentsStart,
        placeholderHexLength,
    };
}

/**
 * Step 3 — write the CMS DER into the reserved /Contents window.
 *
 * Throws rather than truncating if the DER does not fit: a silently clipped
 * signature produces a PDF that looks signed and fails every verifier.
 */
export function spliceCms(args: {
    pdfWithPlaceholder: Uint8Array;
    cmsDer: Uint8Array;
    preparation: SigningPreparation;
}): Uint8Array {
    const { pdfWithPlaceholder, cmsDer, preparation } = args;
    const { byteRange, contentsStart, placeholderHexLength } = preparation;

    const hex = Buffer.from(cmsDer).toString("hex");
    if (hex.length > placeholderHexLength) {
        throw new Error(
            `pades: CMS is ${hex.length} hex chars but only ${placeholderHexLength} were reserved — ` +
                `raise signatureLength`
        );
    }

    const buf = Buffer.from(pdfWithPlaceholder);
    const raw = buf.toString("latin1");

    // Stamp the real ByteRange (same values prepareForSigning digested).
    const { byteRangePlaceholder } = findByteRange(buf);

    // Same guard as `prepareForSigning`. It cannot fire in practice — this runs on
    // the buffer that function already validated — but `findByteRange` types the
    // placeholder as optional and a silent `undefined` here would corrupt the
    // signed byte range rather than fail.
    if (!byteRangePlaceholder) {
        throw new Error("pades: no ByteRange placeholder found in the prepared PDF");
    }

    const actualByteRange = `/ByteRange [${byteRange.join(" ")}]`.padEnd(
        byteRangePlaceholder.length,
        " "
    );

    const signed = Buffer.from(raw.replace(byteRangePlaceholder, actualByteRange), "latin1");

    // Zero-pad the DER out to the full reserved window.
    const paddedHex = hex.padEnd(placeholderHexLength, "0");
    signed.write(paddedHex, contentsStart + 1, "latin1");

    return new Uint8Array(signed);
}
