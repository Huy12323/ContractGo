import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw/server";

// ============================================================
// Console noise suppression
// ============================================================
// jsdom and several dependencies emit known, unfixable warnings on almost every
// render. Left alone they bury the one message that actually matters. Rather than
// silencing console outright, match known-noisy messages, COUNT them, and print a
// summary at exit so nothing disappears silently.
//
// Set SHOW_TEST_WARNINGS=1 to see them all verbatim.

const SUPPRESS_PATTERNS: RegExp[] = [
    // supabase-js constructs a client per import; harmless in tests, will fire
    // constantly once integration tests land.
    /Multiple GoTrueClient instances detected/,
    // jsdom stubs these; we provide our own shims below but the native
    // "not implemented" path can still be hit by third-party code.
    /Not implemented: window\.getComputedStyle/,
    /Not implemented: HTMLCanvasElement\.prototype\.getContext/,
    /Not implemented: navigation/,
    // pdfjs-dist falls back to an in-thread worker when no worker is available.
    /Setting up fake worker/,
];

const suppressed = new Map<string, number>();

const install = (method: "error" | "warn") => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
        if (process.env.SHOW_TEST_WARNINGS) return original(...args);
        const text = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
        const hit = SUPPRESS_PATTERNS.find((p) => p.test(text));
        if (hit) {
            const key = hit.source;
            suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
            return;
        }
        original(...args);
    };
};

install("error");
install("warn");

process.on("exit", () => {
    if (suppressed.size === 0) return;
    const total = [...suppressed.values()].reduce((a, b) => a + b, 0);
    process.stdout.write(
        `\n[test-setup] suppressed ${total} known-noisy console message(s) ` +
            `across ${suppressed.size} pattern(s). SHOW_TEST_WARNINGS=1 to see them.\n`
    );
});

// ============================================================
// jsdom shims
// ============================================================
// Each of these is required by something ContractGo actually uses — see
// docs/testing.md. Do NOT add the `canvas` npm package to "fix" the canvas
// stubs: it is a native build and will not install cleanly on Windows.

// antd Grid.useBreakpoint (wrapped by src/hooks/useApp_Breakpoint.ts) is used
// app-wide; without matchMedia every render throws.
if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as typeof window.matchMedia;
}

// antd v6 Modal/Drawer measure scrollbars via @rc-component/util, which calls
// getComputedStyle with a second (pseudo-element) argument.
const nativeGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element, pseudoElt?: string | null) =>
    nativeGetComputedStyle(elt, pseudoElt ?? undefined)) as typeof window.getComputedStyle;

// antd v6 Table/Select/Menu/Tabs all use rc-resize-observer.
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}

// react-pdf's Page and antd virtual lists.
if (!globalThis.IntersectionObserver) {
    globalThis.IntersectionObserver = class {
        readonly root = null;
        readonly rootMargin = "";
        readonly thresholds: number[] = [];
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
            return [];
        }
    } as unknown as typeof IntersectionObserver;
}

// antd Modal + Table sticky.
window.scrollTo = window.scrollTo ?? (() => {});

// Canvas: three consumers — src/utils/Utils_Files_ImageThumbnail.ts,
// react-signature-canvas (the signature capture surface), and pdfjs-dist.
// jsdom's getContext returns null and logs "not implemented".
const canvasProto = window.HTMLCanvasElement.prototype;
canvasProto.getContext = (() => ({
    canvas: null,
    fillRect: () => {},
    clearRect: () => {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
    }),
    putImageData: () => {},
    createImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    scale: () => {},
    translate: () => {},
    rotate: () => {},
    measureText: () => ({ width: 0 }),
    fillText: () => {},
})) as unknown as typeof canvasProto.getContext;

canvasProto.toDataURL = () => "data:image/png;base64,";
canvasProto.toBlob = (cb: BlobCallback) => cb(new Blob([], { type: "image/png" }));

// Utils_Files_ImageThumbnail.ts calls URL.createObjectURL(file); jsdom has neither.
if (!URL.createObjectURL) {
    URL.createObjectURL = () => "blob:contractgo-test";
    URL.revokeObjectURL = () => {};
}

// supabase-js writes a PKCE code verifier into Web Storage at client
// construction (src/configs/supabase/config.ts sets flowType: "pkce"), so any
// test that transitively imports the client touches localStorage. jsdom's is
// adequate but not reliably isolated between files — use a spec-faithful
// in-memory implementation.
const makeStorage = (): Storage => {
    let store = new Map<string, string>();
    return {
        get length() {
            return store.size;
        },
        key: (i: number) => [...store.keys()][i] ?? null,
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(String(k), String(v)),
        removeItem: (k: string) => void store.delete(String(k)),
        clear: () => void (store = new Map()),
    } as Storage;
};

Object.defineProperty(window, "localStorage", { value: makeStorage(), configurable: true });
Object.defineProperty(window, "sessionStorage", { value: makeStorage(), configurable: true });

// ============================================================
// MSW
// ============================================================
// Only for the unit silo. Integration tests talk to a real local Supabase, so
// intercepting their traffic would defeat the point.
if (!process.env.RUN_INTEGRATION) {
    // onUnhandledRequest: "error" is deliberate and load-bearing — a component
    // that quietly fires an unexpected request FAILS instead of hanging. If your
    // test errors on an unhandled request, that is the design: add server.use(...).
    beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());
}

afterEach(() => cleanup());
