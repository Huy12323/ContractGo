import { describe, expect, it } from "vitest";
import { utils_PdfBurn_SanitizePng } from "./utils_PdfBurn_SanitizePng";

/**
 * Builds a minimal PNG-shaped buffer: the 8-byte signature followed by chunks of
 * `{ length, type, data, crc }`. Not a decodable image — this function only ever
 * walks the chunk framing, so framing is all the fixture needs.
 */
const buildPng = (chunks: { type: string; data: number[]; crc: number }[]): Uint8Array => {
    const size = 8 + chunks.reduce((n, c) => n + 12 + c.data.length, 0);
    const buf = new Uint8Array(size);
    const view = new DataView(buf.buffer);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);

    let offset = 8;
    for (const chunk of chunks) {
        view.setUint32(offset, chunk.data.length);
        for (let i = 0; i < 4; i += 1) buf[offset + 4 + i] = chunk.type.charCodeAt(i);
        buf.set(chunk.data, offset + 8);
        view.setUint32(offset + 8 + chunk.data.length, chunk.crc);
        offset += 12 + chunk.data.length;
    }
    return buf;
};

const crcAt = (png: Uint8Array, offset: number): number =>
    new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(offset);

describe("utils_PdfBurn_SanitizePng", () => {
    it("zeroes a CRC at or above 2^31", () => {
        // 0xFFFFFFFF read with getInt32 is -1, which is what breaks pdf-lib.
        const png = buildPng([{ type: "IHDR", data: [1, 2, 3, 4], crc: 0xffffffff }]);
        const out = utils_PdfBurn_SanitizePng(png);
        expect(crcAt(out, 8 + 8 + 4)).toBe(0);
    });

    it("leaves a CRC below 2^31 alone", () => {
        const png = buildPng([{ type: "IHDR", data: [1, 2, 3, 4], crc: 0x7fffffff }]);
        const out = utils_PdfBurn_SanitizePng(png);
        expect(crcAt(out, 8 + 8 + 4)).toBe(0x7fffffff);
    });

    it("walks every chunk, not just the first", () => {
        const png = buildPng([
            { type: "IHDR", data: [1], crc: 0x00000001 },
            { type: "IDAT", data: [2, 3], crc: 0x80000000 },
            { type: "IEND", data: [], crc: 0xdeadbeef },
        ]);
        const out = utils_PdfBurn_SanitizePng(png);
        expect(crcAt(out, 8 + 8 + 1)).toBe(0x00000001);
        expect(crcAt(out, 8 + 12 + 1 + 8 + 2)).toBe(0);
        expect(crcAt(out, 8 + 12 + 1 + 12 + 2 + 8)).toBe(0);
    });

    it("does not mutate its input", () => {
        // The caller may still need the original bytes — e.g. to show the same
        // signature in a preview after the burn.
        const png = buildPng([{ type: "IHDR", data: [1, 2, 3, 4], crc: 0xffffffff }]);
        const before = crcAt(png, 8 + 8 + 4);
        utils_PdfBurn_SanitizePng(png);
        expect(crcAt(png, 8 + 8 + 4)).toBe(before);
    });

    it("stops rather than reading past a truncated final chunk", () => {
        const png = buildPng([{ type: "IHDR", data: [1, 2, 3, 4], crc: 0xffffffff }]);
        const truncated = png.slice(0, png.length - 2);
        expect(() => utils_PdfBurn_SanitizePng(truncated)).not.toThrow();
    });

    it("handles a signature-only buffer with no chunks", () => {
        expect(() => utils_PdfBurn_SanitizePng(new Uint8Array(8))).not.toThrow();
    });
});
