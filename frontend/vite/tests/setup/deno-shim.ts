/**
 * Installs a minimal `Deno` global so edge-function `_shared` modules can be
 * imported from vitest (Node), which has no such global.
 *
 * This MUST be the first entry in `setupFiles` and MUST be its own module.
 * ESM imports hoist above statements, so a shim written inline at the top of
 * vitest.setup.ts would still run *after* any import of edge code. The specific
 * landmine: supabase/functions/_shared/storage.ts:86 evaluates
 *
 *     const LOCAL_BUCKET = Deno.env.get("STORAGE_LOCAL_BUCKET") || "files";
 *
 * at MODULE SCOPE, and envelopeCompose.ts value-imports storage.ts. Without this
 * file, `import { validateForSend } from ".../envelopeCompose.ts"` throws
 * "Deno is not defined" before a single test runs.
 *
 * Scope note: this makes _shared modules *importable*. That is a capability, and
 * capabilities get abused — do NOT use it to unit-test DB-coupled code such as
 * resolveSignerToken with a mocked Supabase client. A mock of it tests the mock.
 * See docs/testing.md.
 */

// STORAGE_DRIVER=local so the R2 driver (which requires credentials) is never
// constructed during unit tests.
process.env.STORAGE_DRIVER ??= "local";
process.env.STORAGE_LOCAL_BUCKET ??= "files";

if (!("Deno" in globalThis)) {
    Object.defineProperty(globalThis, "Deno", {
        configurable: true,
        writable: true,
        value: {
            env: {
                get: (key: string): string | undefined => process.env[key],
                set: (key: string, value: string): void => {
                    process.env[key] = value;
                },
                has: (key: string): boolean => key in process.env,
                toObject: (): Record<string, string> =>
                    ({ ...process.env }) as Record<string, string>,
            },
        },
    });
}

export {};
