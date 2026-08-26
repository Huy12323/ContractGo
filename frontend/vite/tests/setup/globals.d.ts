/**
 * Cross-runtime declarations so `tsc -p tsconfig.test.json` can follow test
 * imports into supabase/functions/_shared without reporting false positives on
 * code it is not qualified to judge.
 *
 * `deno check` (pnpm check:ef) remains the AUTHORITY on edge-function types — it
 * uses the real Deno lib and each function's deno.json import map. Nothing here
 * affects the production build: tsconfig.json (what `pnpm build` runs) does not
 * include this file.
 */

declare const Deno: {
    env: {
        get(key: string): string | undefined;
        set(key: string, value: string): void;
        has(key: string): boolean;
        toObject(): Record<string, string>;
    };
    serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

interface SubtleCrypto {
    /**
     * TS 5.7's DOM lib narrowed `BufferSource` to `ArrayBufferView<ArrayBuffer>`,
     * so a plain `Uint8Array` (i.e. `Uint8Array<ArrayBufferLike>`) no longer
     * satisfies it. Deno's lib has no such narrowing, so _shared/http.ts's
     * `sha256Bytes` is correct where it runs. This overload restores the wider
     * signature for the test type-check only.
     */
    digest(
        algorithm: AlgorithmIdentifier,
        data: ArrayBufferView<ArrayBufferLike> | ArrayBufferLike
    ): Promise<ArrayBuffer>;
}
