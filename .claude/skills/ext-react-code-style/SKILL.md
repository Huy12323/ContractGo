---
name: ext-react-code-style
description: Project-specific formatting and lint tooling — Prettier settings, the ESLint 9 flat config and what each ignore entry is for, and the exhaustive-deps ratchet
base: bible-react-code-style
---

# React Code Style — Project Extensions

> Base skill: **bible-react-code-style** — read it first, especially its rule that
> `eslint-disable` is never the answer for `react-hooks/exhaustive-deps`.

## Formatting is not a per-file choice

`.prettierrc` at the repo root is the single authority: 4-space indent, double
quotes, 100 columns, semicolons, `trailingComma: es5`, LF.

Do not hand-format against it and do not add per-directory overrides. Staged files
are formatted automatically on commit by lint-staged; `pnpm format` does the whole
repo; `pnpm format:check` is what CI enforces.

**Never reformat:**

- `frontend/vite/src/routeTree.gen.ts` and `frontend/vite/src/types/database.types.ts`
  — generated, rewritten by tooling.
- `frontend/vite/supabase/migrations/**` — immutable once applied.
- `frontend/vite/supabase/templates/**` — whitespace-sensitive email HTML.
- `cycles/**` and `docs/**` — PM content authored through the Bible workflow;
  reformatting fights the `/pm` tooling.

All of these are already in `.prettierignore`. If you find yourself wanting to
remove an entry, read the comment above it first.

## The ESLint config, and why each ignore exists

`frontend/vite/eslint.config.js` — ESLint 9 flat config. `eslint-config-prettier`
is last, and must stay last: it turns off the stylistic rules Prettier owns.

| Ignored                                      | Why                                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/functions/**`                      | Deno runtime — Deno globals, URL imports, per-function `deno.json` import maps. Linting with browser globals is pure noise. Type-checked by `pnpm check:ef` instead. |
| `supabase/.temp/**`, `supabase/.branches/**` | Supabase CLI scratch state — bundled third-party runtime code.                                                                                                       |
| `src/routeTree.gen.ts`                       | Regenerated on every `pnpm dev`, so relying on its own `/* eslint-disable */` header is fragile.                                                                     |
| `src/types/database.types.ts`                | Generated from the schema.                                                                                                                                           |

Three rules are off, each for a reason worth knowing:

- **`no-unused-vars`, `no-undef`** — `frontend/vite/tsconfig.json` is _stricter_
  than the ESLint equivalents (`noUnusedLocals`, `noUnusedParameters`,
  `noUncheckedIndexedAccess`) and reports better messages. Leaving them on would
  double-report.
- **`react-refresh/only-export-components`** — TanStack Router route modules
  legitimately export `Route`, `loader` and `validateSearch` beside the component.
  This rule fires on every route file and is always wrong here.

## The exhaustive-deps ratchet

`react-hooks/exhaustive-deps` is `"warn"`, and `pnpm lint` does **not** pass
`--max-warnings=0`. That is a temporary state, not a relaxation of the base skill.

The base skill forbids `eslint-disable` for this rule and prescribes a refactor.
A refactor is a behaviour change, so the three pre-existing warnings could not be
closed as part of introducing the linter:

- `src/components/pdf/App_PdfDocument.tsx`
- `src/hooks/useSupabaseRealtimeSync.ts`
- `src/pages/Page_EnvelopeComposer/Page_EnvelopeComposer.tsx`

**Do not suppress them.** Fix the dependency the way the base skill describes
(compare-before-update, functional updates). When the count reaches zero, flip the
rule to `"error"` and switch both the `lint` script and the CI step to
`lint:strict`, which already exists for that purpose.

## Running the gates

`pnpm check` runs type-check, lint and the edge-function `deno check` in parallel
and fails fast. Run it before pushing.

`pnpm build` is deliberately **not** gated on `pnpm check` — Cloudflare Pages
auto-deploys on push, so a lint rule must never be able to block a deploy. CI
blocks the merge instead. Do not "fix" this by adding the gate.
