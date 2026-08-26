import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default [
    {
        ignores: [
            "dist",
            "coverage",
            ".tanstack",
            // Deno runtime — different globals, URL imports, and a per-function
            // deno.json import map. Linting these with browser globals is pure
            // noise. They are type-checked separately by
            // scripts/check-edge-functions.cjs.
            "supabase/functions/**",
            // Supabase CLI local scratch state — bundled runtime code, not ours.
            "supabase/.temp/**",
            "supabase/.branches/**",
            // Generated. routeTree.gen.ts is rewritten on every `pnpm dev` by
            // the TanStack Router plugin, so relying on its own
            // /* eslint-disable */ header is fragile — ignore it outright.
            "src/routeTree.gen.ts",
            "src/types/database.types.ts",
        ],
    },
    {
        files: ["**/*.{js,jsx,ts,tsx}"],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
            parser: tseslint.parser,
            parserOptions: {
                ecmaVersion: "latest",
                ecmaFeatures: { jsx: true },
                sourceType: "module",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint.plugin,
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...reactHooks.configs.recommended.rules,

            // TypeScript already reports these, and tsconfig.json here is
            // stricter than the ESLint equivalents (noUnusedLocals,
            // noUnusedParameters, noUncheckedIndexedAccess). Leaving the core
            // rules on would double-report with worse messages.
            "no-unused-vars": "off",
            "no-undef": "off",

            // TanStack Router route modules legitimately export non-components
            // (Route, loader, validateSearch) alongside the component.
            "react-refresh/only-export-components": "off",

            // Kept at "warn" deliberately. bible-react-code-style FORBIDS
            // eslint-disable for this rule and prescribes a refactor instead —
            // which is a behaviour change. Ratchet to "error" (and switch the
            // lint script to lint:strict) only once the warning count is zero.
            "react-hooks/exhaustive-deps": "warn",
        },
    },
    eslintConfigPrettier, // MUST be last — turns off stylistic rules Prettier owns
];
