// Generates `frontend/vite/public/og.png` — the 1200x630 link-preview card
// referenced by the Open Graph and Twitter tags in `index.html` (CG-052).
//
//     node scripts/make-og-image.mjs frontend/vite/public/og.png
//
// Committed so the asset is reproducible rather than an unexplained binary: a
// future colour or logo change is a diff here, not a hunt for whoever made the
// PNG. The output is committed too, because the Pages build must not depend on
// running this.
//
// Hand-rolled pixel composition and a raw PNG encoder, because this repo has no
// image library and adding one for a single static asset would cost more than
// it saves. It draws the product's own `BG_GRADIENT` and the document-and-pen
// mark from the favicon.
//
// NO TEXT, and that is a real limitation rather than a choice: rasterising a
// font without a font engine is not something to hand-roll. A designed card
// carrying the ContractGo wordmark and the tagline would convert better and
// should replace this. Until then a clean branded mark beats a broken preview.

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";

const W = 1200;
const H = 630;
const px = Buffer.alloc(W * H * 3);

const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
};

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
];

// The stops from BG_GRADIENT in Provider_ANTD, at its 160deg angle.
const STOPS = [
    [0.0, [0xe2, 0xe8, 0xf3]],
    [0.3, [0xf0, 0xf5, 0xff]],
    [0.7, [0xff, 0xf1, 0xf0]],
    [1.0, [0xe6, 0xf7, 0xff]],
];

const gradientAt = (t) => {
    for (let i = 0; i < STOPS.length - 1; i += 1) {
        const [p0, c0] = STOPS[i];
        const [p1, c1] = STOPS[i + 1];
        if (t >= p0 && t <= p1) return mix(c0, c1, (t - p0) / (p1 - p0));
    }
    return STOPS[STOPS.length - 1][1];
};

// 160deg in CSS runs top-ish to bottom-ish; project each pixel onto that axis.
const ang = ((160 - 90) * Math.PI) / 180;
const dx = Math.cos(ang);
const dy = Math.sin(ang);
const projMin = Math.min(0, W * dx) + Math.min(0, H * dy);
const projMax = Math.max(0, W * dx) + Math.max(0, H * dy);

for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
        const t = (x * dx + y * dy - projMin) / (projMax - projMin);
        set(x, y, gradientAt(t));
    }
}

const INDIGO = [0x63, 0x66, 0xf1];
const WHITE = [0xff, 0xff, 0xff];

const rect = (x0, y0, w, h, color, radius = 0) => {
    for (let y = y0; y < y0 + h; y += 1) {
        for (let x = x0; x < x0 + w; x += 1) {
            if (radius > 0) {
                const cx = Math.min(Math.max(x, x0 + radius), x0 + w - radius);
                const cy = Math.min(Math.max(y, y0 + radius), y0 + h - radius);
                if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
            }
            set(x, y, color);
        }
    }
};

// A thick line from (x0,y0) to (x1,y1), for the pen stroke.
const line = (x0, y0, x1, y1, thickness, color) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2;
    for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        const cx = lerp(x0, x1, t);
        const cy = lerp(y0, y1, t);
        const r = thickness / 2;
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
            for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
                if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, color);
            }
        }
    }
};

// The mark: an indigo rounded square holding a white document and a pen stroke,
// scaled up from the 32x32 favicon.
const S = 300;
const OX = (W - S) / 2;
const OY = (H - S) / 2 - 20;
const u = S / 32;

rect(OX, OY, S, S, INDIGO, 7 * u);
// Document rules. Kept SHORT — at favicon size they can run under the pen
// stroke and still read, but at 300px the two merge into a single arrow shape.
line(OX + 8 * u, OY + 9 * u, OX + 17 * u, OY + 9 * u, 2.2 * u, WHITE);
line(OX + 8 * u, OY + 13.5 * u, OX + 15 * u, OY + 13.5 * u, 2.2 * u, WHITE);
line(OX + 8 * u, OY + 18 * u, OX + 13 * u, OY + 18 * u, 2.2 * u, WHITE);
// Pen: a stroke running up to the right, clear of every rule above.
line(OX + 15 * u, OY + 24 * u, OX + 24 * u, OY + 15 * u, 3.4 * u, WHITE);
// Its nib — a small wedge at the lower-left end of the stroke.
line(OX + 13.4 * u, OY + 25.6 * u, OX + 15.4 * u, OY + 23.6 * u, 1.6 * u, WHITE);

// A grounding bar under the mark, so the card does not read as a bare icon.
rect(OX - 60, OY + S + 46, S + 120, 10, INDIGO, 5);

// ── PNG encode (colour type 2, 8-bit RGB, filter 0 per scanline) ──
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y += 1) {
    raw[y * (W * 3 + 1)] = 0;
    px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(process.argv[2], png);
console.log(`wrote ${process.argv[2]} — ${png.length} bytes, ${W}x${H}`);
