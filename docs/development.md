# Development

Setup and day-to-day commands live in `README.md`. This file records the things
that are **not** discoverable from the code — the footguns that cost an afternoon
the first time.

## Quality gates

| Command | What it checks |
|---|---|
| `pnpm check` | All three below, in parallel, failing fast. |
| `pnpm type-check` | `tsc --noEmit` over `src`. This is what gates the production build. |
| `pnpm lint` | ESLint 9 flat config at `frontend/vite/eslint.config.js`. |
| `pnpm check:ef` | `deno check` over every edge function and `_shared`. Skips with a message if Deno isn't installed. |
| `pnpm format` / `pnpm format:check` | Prettier. `format:check` is what CI runs. |

`pnpm build` is deliberately **not** gated on `pnpm check`. Cloudflare Pages
auto-deploys on push and runs the build — gating it would mean a lint rule could
take production down. `build` already runs `tsc -b`, so type errors are caught;
CI (`.github/workflows/ci.yml`) blocks the *merge* instead.

### The exhaustive-deps ratchet

`react-hooks/exhaustive-deps` is set to `"warn"`, not `"error"`, and
`pnpm lint` does not use `--max-warnings=0`. This is temporary and deliberate.

`bible-react-code-style` **forbids `eslint-disable`** for this rule — the
sanctioned fix is a refactor (compare-before-update, functional updates). A
refactor is a behaviour change, so the warnings could not be closed as part of
introducing the linter. There are three, all pre-existing:

- `src/components/pdf/App_PdfDocument.tsx` — ref-value-in-cleanup
- `src/hooks/useSupabaseRealtimeSync.ts` — missing `handleTableChange`
- `src/pages/Page_EnvelopeComposer/Page_EnvelopeComposer.tsx` — missing `adHocPdfFilePath`, `message`

When they reach zero: flip the rule to `"error"`, switch the `lint` script and the
CI step to `lint:strict`. **Do not suppress them to get there.**

## Footguns

### The cron secret must be written into the DB by hand

Cron functions authenticate on an `x-cron-secret` header checked against
`public.cron_dispatch_config`. That row is **not** populated by any migration —
after every migration push to a new environment you must set it manually, or
reminders and expiry silently no-op. Nothing errors; envelopes just never remind
and never expire. Documented in `.env.example`; repeated here because that is not
where anyone looks.

### `sb:dev:reset` contradicts the seed policy

Root `package.json` ships `sb:dev:reset` (`supabase db reset --local`), but
`frontend/vite/supabase/seed.sql` states that `supabase db reset` is **BANNED** —
the local DB carries hand-built seed data that took real effort to produce.

Treat the script as a trap. Use `pnpm backup` / the `/backup` skill before any
schema work, and see `docs/testing.md` for how tests avoid needing a reset at all.

### Local storage without Cloudflare

`STORAGE_DRIVER=local` routes file storage through Supabase Storage instead of
R2, so you can develop without Cloudflare credentials at all. This is the
established local workflow — `scripts/seed-demo-contractgo.js` assumes it. There
is deliberately **no** MinIO container in this repo; it would add a service to
exercise an R2 path local dev doesn't use.

### Line endings

`.gitattributes` normalises everything to LF in the repository. If you had
checkouts before it existed, run `git add --renormalize .` once.

## Two runtimes, one file tree

`frontend/vite/src` is browser TypeScript; `frontend/vite/supabase/functions` is
Deno. They do not share a type system:

- ESLint **ignores** `supabase/functions/**` — Deno globals and URL imports
  produce pure noise under browser rules.
- `tsc` never sees them either. `deno check` (`pnpm check:ef`) is the authority.
- Tests that import `_shared` rely on shims in `tests/setup/`. See
  `docs/testing.md` for the rules and their limits.

## Seeding

`pnpm seed:demo` runs `scripts/seed-demo-contractgo.js`, which drives the **real
edge functions** to build a realistic dataset. It has to: `source_pdf_sha256`,
`template_snapshot` and the audit hash chain are derived columns that cannot be
faked in SQL. It is also the closest thing to a manual smoke test until the E2E
silo exists.
