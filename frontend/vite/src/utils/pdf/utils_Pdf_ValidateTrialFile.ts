// Front-door validation for a file dropped into the trial.
//
// TWO CHECKS, NOT ONE. `file.type` comes from the operating system's extension
// mapping, so a `.docx` renamed to `.pdf` reports `application/pdf` and sails
// through a type check — then fails deep inside pdf.js with an error no visitor
// can act on. The magic bytes are the actual evidence, so both are checked and
// the byte check is the one that decides.
//
// Reading the header means this is async, which is why it returns a result
// object rather than throwing: the caller renders the reason in the drop zone,
// and every message here is written to be shown to a stranger verbatim.

import { const_Trial_MaxFileSizeBytes, const_Trial_MaxFileSizeMB } from "./const_TrialLimits";
import { MAX_UPLOAD_SIZE_MB } from "@/utils/const_FileUpload";

export type Pdf_TrialFileValidation = { ok: true } | { ok: false; reason: string };

/** `%PDF-` — the five bytes every PDF starts with. */
export const const_Pdf_MagicBytes = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** Reads the first bytes of a file and reports whether they are a PDF header. */
export const utils_Pdf_HasPdfMagicBytes = async (file: Blob): Promise<boolean> => {
    const header = new Uint8Array(await file.slice(0, const_Pdf_MagicBytes.length).arrayBuffer());
    if (header.length < const_Pdf_MagicBytes.length) return false;
    return const_Pdf_MagicBytes.every((byte, i) => header[i] === byte);
};

export const utils_Pdf_ValidateTrialFile = async (file: File): Promise<Pdf_TrialFileValidation> => {
    // Size first: it is free, and refusing a 200MB file before reading any of it
    // is the difference between an instant message and a stalled tab.
    if (file.size > const_Trial_MaxFileSizeBytes) {
        return {
            ok: false,
            reason: `Trial documents are limited to ${const_Trial_MaxFileSizeMB}MB. Sign up to work with files up to ${MAX_UPLOAD_SIZE_MB}MB.`,
        };
    }

    // An empty file has valid-looking metadata and no header at all.
    if (file.size === 0) {
        return { ok: false, reason: "That file is empty." };
    }

    if (!(await utils_Pdf_HasPdfMagicBytes(file))) {
        // Same string `App_TemplateBuilder` uses, so the trial and the product
        // reject the same file with the same words.
        return { ok: false, reason: "Only PDF files are accepted" };
    }

    return { ok: true };
};
