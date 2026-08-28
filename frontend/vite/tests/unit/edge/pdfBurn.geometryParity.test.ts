// THE TEST THAT MAKES THE DUPLICATION SAFE (CG-052).
//
// `src/utils/pdf/utils_PdfBurn_Client.ts` reimplements the drawing loop of
// `supabase/functions/_shared/pdfBurn.ts` rather than importing it — that file's
// header carries the three reasons why. The cost of that decision is drift: a
// coordinate fix in the evidentiary burn that never reaches the trial, or vice
// versa, showing up as a mark half an inch off in a PDF nobody diffs.
//
// So this test burns the SAME document, layout and values through BOTH
// implementations and asserts they emit identical positioning operators. Drift
// becomes a CI failure instead of a latent visual bug. If this test fails after
// you changed one of the two burns, the fix is to change the other one too —
// not to relax the assertion.
//
// WHAT IS COMPARED, AND WHY NOT MORE. Only the positional operators (`Tm` for
// text, `cm` for images) and the font SIZE. The two burns deliberately differ in
// three ways that would make a byte comparison meaningless:
//
//   * the edge burn embeds Noto Serif; here the client falls back to Helvetica
//     (its font fetch is stubbed to fail), so the text-showing operator encodes
//     glyphs differently and the font resource is named differently;
//   * the edge burn saves with `useObjectStreams: false` for PAdES, the client
//     takes pdf-lib's default;
//   * pdf-lib emits a fresh object graph each run.
//
// Coordinates are the thing that must not drift, and coordinates are what this
// compares.

import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import {
    burnPdfDocument,
    type SnapshotField,
} from "../../../supabase/functions/_shared/pdfBurn.ts";
import { utils_PdfBurn_Client, type PdfBurn_Field } from "@/utils/pdf/utils_PdfBurn_Client";

// A 2x1 PNG. Non-square on purpose: a square image cannot catch an aspect-ratio
// bug, which is the most likely way a signature burn goes wrong without anyone
// noticing.
const PNG_2x1 = Uint8Array.from(
    atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEklEQVR4nGP8z8DwnwEJMCEzAB8LAwFyGrl4AAAAAElFTkSuQmCC"
    ),
    (c) => c.charCodeAt(0)
);

// Boxes chosen so no two share a coordinate — a swapped x/y or a reused rect
// cannot accidentally still match.
const BOXES = {
    text: { page: 1, x_pct: 0.1, y_pct: 0.2, w_pct: 0.3, h_pct: 0.04 },
    date: { page: 2, x_pct: 0.55, y_pct: 0.72, w_pct: 0.22, h_pct: 0.03 },
    choice: { page: 1, x_pct: 0.42, y_pct: 0.61, w_pct: 0.25, h_pct: 0.09 },
    checkbox: { page: 1, x_pct: 0.05, y_pct: 0.88, w_pct: 0.03, h_pct: 0.02 },
    signature: { page: 2, x_pct: 0.12, y_pct: 0.33, w_pct: 0.3, h_pct: 0.08 },
    attachment: { page: 1, x_pct: 0.7, y_pct: 0.15, w_pct: 0.2, h_pct: 0.025 },
    offPage: { page: 99, x_pct: 0.5, y_pct: 0.5, w_pct: 0.1, h_pct: 0.02 },
};

const CHOICE_OPTIONS = [
    { label: "Annual", value: "annual" },
    { label: "Monthly", value: "monthly" },
];

// Values are short and Latin-1 so neither font wraps them: `maxWidth` makes
// pdf-lib break lines using the font's own metrics, and the two burns use
// different fonts here. Long text would differ for a reason that is not drift.
const FIELD_VALUES: Record<string, unknown> = {
    f_text: "Acme Ltd",
    f_date: "2026-08-28",
    f_choice: "monthly",
    f_checkbox: true,
    f_attachment: "ignored.pdf",
    f_offPage: "nowhere",
};

const FIELD_NAMES = [
    "text",
    "date",
    "choice",
    "checkbox",
    "signature",
    "attachment",
    "offPage",
] as const;

const edgeLayout: SnapshotField[] = FIELD_NAMES.map((name) => ({
    id: "f_" + name,
    key: name,
    label: name,
    // `offPage` exercises the out-of-range guard; it is an ordinary text field
    // pointed at a page that does not exist.
    type: name === "offPage" ? "text" : name,
    role_id: "rol_signer",
    required: false,
    options: name === "choice" ? CHOICE_OPTIONS : undefined,
    ...BOXES[name],
}));

const clientLayout: PdfBurn_Field[] = edgeLayout.map((f) => ({
    id: f.id,
    type: f.type,
    page: f.page,
    x_pct: f.x_pct,
    y_pct: f.y_pct,
    w_pct: f.w_pct,
    h_pct: f.h_pct,
    options: f.options,
}));

/** A two-page source document at two DIFFERENT sizes — Letter, then A4. */
const makeSourcePdf = async (): Promise<Uint8Array> => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([595.28, 841.89]);
    return doc.save();
};

/**
 * Pulls every content stream out of a saved PDF as text.
 *
 * pdf-lib Flate-compresses the streams it writes, so INFLATE FIRST and fall back
 * to the raw bytes only when that throws. The other order looks equivalent and
 * is not: compressed bytes are arbitrary, so a "does this already look like
 * operators?" sniff matches `cm` or `Td` in the binary often enough to push
 * garbage into the comparison, where it reads as a passing test on zero data.
 * Font and image streams inflate to binary that simply matches no operator.
 */
const readContentStreams = async (bytes: Uint8Array): Promise<string> => {
    const doc = await PDFDocument.load(bytes);
    const chunks: string[] = [];

    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        const raw = (obj as { contents?: Uint8Array }).contents;
        if (!raw) continue;
        try {
            chunks.push(inflateSync(Buffer.from(raw)).toString("latin1"));
        } catch {
            chunks.push(Buffer.from(raw).toString("latin1"));
        }
    }

    return chunks.join("\n");
};

// Takes `string | undefined` because that is what a regex capture group is
// typed as under `noUncheckedIndexedAccess`, and throws rather than coercing:
// an absent operand would otherwise become NaN and quietly compare equal to
// nothing, which is the failure mode this whole file exists to prevent.
const round = (n: string | undefined) => {
    if (n === undefined) throw new Error("matched a PDF operator with a missing operand");
    return Number(Number(n).toFixed(4));
};

/**
 * Every text position in the stream.
 *
 * pdf-lib positions text with the full text MATRIX (`1 0 0 1 x y Tm`), not the
 * `Td` offset operator — so the coordinates are the last two operands.
 */
const textPositions = (stream: string): number[][] =>
    [...stream.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g)].map((m) => [
        round(m[1]),
        round(m[2]),
    ]);

/** Image draws, counted by the `Do` that paints the XObject — one per image. */
const imageDraws = (stream: string): number => [...stream.matchAll(/\/Image-\d+\s+Do/g)].length;

/**
 * Every `a b c d e f cm`. NOT one per image: pdf-lib emits FOUR for a single
 * `drawImage` — translate, an identity, the width/height scale, another
 * identity. That is why `imageDraws` exists for counting and this exists for
 * comparing; the four together carry the position and size, which is what must
 * not drift.
 */
const imageMatrices = (stream: string): number[][] =>
    [
        ...stream.matchAll(
            /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+cm/g
        ),
    ].map((m) => m.slice(1, 7).map(round));

/** Every `/Font size Tf` — the size only; the resource name differs by design. */
const fontSizes = (stream: string): number[] =>
    [...stream.matchAll(/\/[A-Za-z0-9_-]+\s+([\d.]+)\s+Tf/g)].map((m) => round(m[1]));

/** Compared as sets: the claim is "same marks in the same places", not same order. */
const sortRows = (rows: number[][]) =>
    [...rows].sort((a, b) => a.join(",").localeCompare(b.join(",")));

/**
 * Forces the Helvetica fallback instead of letting the font fetch reach MSW,
 * which is configured to fail on unhandled requests. Exercises that path too.
 */
const stubOfflineFont = () =>
    vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new Error("offline")))
    );

describe("client burn matches the edge burn's geometry", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("places every field at identical coordinates", async () => {
        const source = await makeSourcePdf();
        const fontBytes = new Uint8Array(
            await readFile(path.resolve(__dirname, "../../../public/fonts/NotoSerif-Regular.ttf"))
        );

        const edgeBytes = await burnPdfDocument({
            sourcePdfBytes: source,
            fontBytes,
            layout: edgeLayout,
            fieldValues: FIELD_VALUES,
            signatureImages: { f_signature: PNG_2x1 },
        });

        stubOfflineFont();
        const client = await utils_PdfBurn_Client({
            sourcePdfBytes: source,
            layout: clientLayout,
            fieldValues: FIELD_VALUES,
            signatureImages: { f_signature: PNG_2x1 },
        });
        expect(client.usedFallbackFont).toBe(true);

        const edgeStream = await readContentStreams(edgeBytes);
        const clientStream = await readContentStreams(client.bytes);

        // Guards the extraction itself: a regex that matched nothing would make
        // every comparison below trivially true.
        expect(textPositions(edgeStream).length).toBeGreaterThan(0);
        expect(imageMatrices(edgeStream).length).toBeGreaterThan(0);
        expect(imageDraws(edgeStream)).toBe(1);

        expect(sortRows(textPositions(clientStream))).toEqual(sortRows(textPositions(edgeStream)));
        expect(sortRows(imageMatrices(clientStream))).toEqual(sortRows(imageMatrices(edgeStream)));
        expect([...fontSizes(clientStream)].sort()).toEqual([...fontSizes(edgeStream)].sort());
    });

    it("skips the attachment and the off-page field", async () => {
        // Pins the two SKIP branches, which a coordinate comparison alone cannot
        // see: if BOTH burns started drawing attachments, the streams would
        // still match each other perfectly.
        const source = await makeSourcePdf();

        stubOfflineFont();
        const client = await utils_PdfBurn_Client({
            sourcePdfBytes: source,
            layout: clientLayout,
            fieldValues: FIELD_VALUES,
            signatureImages: { f_signature: PNG_2x1 },
        });

        const stream = await readContentStreams(client.bytes);
        // text + date + choice + checkbox = 4. The attachment draws nothing, and
        // the page-99 field is dropped rather than failing the whole burn.
        expect(textPositions(stream)).toHaveLength(4);
        expect(imageDraws(stream)).toBe(1);
    });
});
