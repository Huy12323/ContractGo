import path from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfigRaw from "./vite.config";

// ContractGo's vite.config.ts is a plain object today, so this resolve step is a
// no-op. It is kept because vite's `mergeConfig` CANNOT merge a callback config —
// if this project ever adopts a mode-aware `loadEnv` config (as Lightcraft has),
// the merge would silently produce a broken config instead of failing loudly.
const viteConfig =
    typeof viteConfigRaw === "function"
        ? (viteConfigRaw as (env: { mode: string; command: string }) => unknown)({
              mode: "test",
              command: "serve",
          })
        : viteConfigRaw;

export default mergeConfig(
    viteConfig as never,
    defineConfig({
        resolve: {
            alias: {
                // Edge functions import supabase-js under the bare specifier
                // "supabase", mapped by each function's deno.json to esm.sh.
                // Node/vitest cannot resolve that. @supabase/supabase-js is the
                // same library and already a dependency here, so this is a
                // faithful substitution, not a stub. Required to import
                // _shared/envelopeCompose.ts, which pulls in senderAuth.ts.
                //
                // NOTE: it is a *version* substitution too (edge pins 2.49.4,
                // the app is on ^2.101.1). Only import PURE functions from
                // _shared — anything that actually calls the client belongs in
                // the integration silo, running under real Deno.
                supabase: "@supabase/supabase-js",

                // _shared/storage.ts dynamically imports these inside
                // createR2Driver(). That path is unreachable under
                // STORAGE_DRIVER=local (set by deno-shim.ts), but Vite still
                // resolves the specifier statically, and the AWS SDK is a ROOT
                // devDependency that pnpm does not expose to @contractgo/web.
                // The stub throws loudly if the R2 driver is ever constructed.
                "@aws-sdk/client-s3": path.resolve(__dirname, "tests/setup/stubs/aws-sdk.ts"),
                "@aws-sdk/s3-request-presigner": path.resolve(
                    __dirname,
                    "tests/setup/stubs/aws-sdk.ts"
                ),
            },
        },
        test: {
            environment: "jsdom",
            globals: true,
            // Two entries, in this order. ESM imports hoist above statements, so
            // the Deno global must be installed by a separate, earlier module —
            // _shared/storage.ts reads Deno.env at MODULE SCOPE.
            setupFiles: ["./tests/setup/deno-shim.ts", "./tests/setup/vitest.setup.ts"],
            include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
            exclude: ["node_modules", "dist", "tests/integration/**", "tests/e2e/**"],
            testTimeout: 15_000,
            hookTimeout: 15_000,
            css: false,
            coverage: {
                provider: "v8",
                reporter: ["text", "html", "lcov"],
                reportsDirectory: "./coverage",
                // _shared is included deliberately: the evidentiary logic
                // (signer routing, send validation, audit payloads) lives there.
                include: ["src/**/*.{ts,tsx}", "supabase/functions/_shared/**/*.ts"],
                exclude: [
                    "src/**/*.test.{ts,tsx}",
                    "src/**/*.d.ts",
                    "src/routeTree.gen.ts",
                    "src/vite-env.d.ts",
                    "src/types/database.types.ts",
                    "src/types/database.override.types.ts",
                    "src/styles/**",
                ],
                // Reporting, not gating. A threshold above 0 on a repo starting
                // from zero tests turns every new untested file into a red build,
                // which is how teams learn to pass --no-verify.
                thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 },
            },
        },
    })
);
