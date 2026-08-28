import { describe, expect, it } from "vitest";
import {
    utils_Pdf_HasPdfMagicBytes,
    utils_Pdf_ValidateTrialFile,
} from "./utils_Pdf_ValidateTrialFile";
import { const_Trial_MaxFileSizeBytes } from "./const_TrialLimits";

const makeFile = (bytes: number[] | Uint8Array, name = "doc.pdf", type = "application/pdf") =>
    new File([new Uint8Array(bytes)], name, { type });

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

describe("utils_Pdf_HasPdfMagicBytes", () => {
    it("accepts a %PDF- header", async () => {
        expect(await utils_Pdf_HasPdfMagicBytes(makeFile(PDF_HEADER))).toBe(true);
    });

    it("rejects a file shorter than the header", async () => {
        expect(await utils_Pdf_HasPdfMagicBytes(makeFile([0x25, 0x50]))).toBe(false);
    });

    it("rejects a ZIP header, which is what a .docx actually is", async () => {
        expect(await utils_Pdf_HasPdfMagicBytes(makeFile([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(
            false
        );
    });
});

describe("utils_Pdf_ValidateTrialFile", () => {
    it("accepts a real PDF", async () => {
        expect(await utils_Pdf_ValidateTrialFile(makeFile(PDF_HEADER))).toEqual({ ok: true });
    });

    it("rejects a .docx renamed to .pdf despite a PDF mime type", async () => {
        // The whole reason the magic-byte check exists: `file.type` comes from
        // the OS extension mapping and reports application/pdf here.
        const result = await utils_Pdf_ValidateTrialFile(
            makeFile([0x50, 0x4b, 0x03, 0x04, 0x00], "contract.pdf", "application/pdf")
        );
        expect(result).toEqual({ ok: false, reason: "Only PDF files are accepted" });
    });

    it("rejects an oversized file and names the paid limit", async () => {
        const oversized = makeFile(PDF_HEADER);
        Object.defineProperty(oversized, "size", { value: const_Trial_MaxFileSizeBytes + 1 });
        const result = await utils_Pdf_ValidateTrialFile(oversized);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("10MB");
            // The limit is a conversion surface, not a dead end.
            expect(result.reason).toContain("50MB");
        }
    });

    it("accepts a file exactly at the limit", async () => {
        const atLimit = makeFile(PDF_HEADER);
        Object.defineProperty(atLimit, "size", { value: const_Trial_MaxFileSizeBytes });
        expect(await utils_Pdf_ValidateTrialFile(atLimit)).toEqual({ ok: true });
    });

    it("rejects an empty file with its own message", async () => {
        const result = await utils_Pdf_ValidateTrialFile(makeFile([]));
        expect(result).toEqual({ ok: false, reason: "That file is empty." });
    });
});
