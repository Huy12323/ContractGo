---
name: testing
description: Use when writing, running or debugging tests — the vitest setup, the MSW strictness contract, the rule for importing edge-function code, and what must never run against a non-local Supabase
---

# Testing

> Standalone skill — there is no `bible-testing` to extend.
> Full detail lives in **`docs/testing.md`**; this is the trigger and the rules
> that must not be discovered the hard way.

## Which silo

Only the **unit** silo exists (vitest + jsdom + MSW). Integration is designed but
not built; E2E and WASM/browser are deferred or permanently skipped.

**Do not add a silo because it would be nice.** `docs/testing.md` lists the
specific trigger for each. ContractGo's risk is evidentiary correctness of pure
decision logic — who signs when, what the audit payload says — not rendering.

## The rules

**1. Only import PURE functions from `supabase/functions/_shared`.**
The `Deno` shim in `tests/setup/deno-shim.ts` makes those modules _importable_,
which is a capability that invites abuse. Anything needing a real
`SupabaseClient` belongs in the integration silo. The `supabase` alias is also a
version substitution (edge pins 2.49.4, the app is on ^2.101.1), so client-calling
code would be tested against a different client than production runs.

**2. An unhandled request failing your test is the design.**
`tests/setup/msw/handlers.ts` is intentionally empty and MSW runs with
`onUnhandledRequest: "error"`. Add a `server.use(...)` declaring what you expect.
Do not add a global handler — that would let a component quietly fire an
unexpected Supabase call and still pass.

**3. No test may depend on `supabase db reset`.** It is banned
(`frontend/vite/supabase/seed.sql`) — the local DB carries hand-built seed data.
Tests create what they assert on and delete what they created.

**4. Never point tests at a non-local Supabase.** `pnpm test:all` refuses on three
independent layers (target keyword, host+port allowlist, production tripwire)
because the integration silo creates and DELETES `auth.users`. If you add a
destructive script, give it the same guard.

**5. Do not raise the coverage thresholds off zero** without a reason. They are
reporting-only on purpose; a threshold on a repo starting from zero tests makes
every new untested file a red build.

## Gotchas that cost an afternoon

- `Provider_ANTD` **already renders antd's `<App>`**. Do not double-wrap — two
  message contexts, and the wrong one wins non-deterministically.
- Use `makeTestQueryClient()`, not the production client: prod sets
  `staleTime: 60_000, retry: 1`, and retries make every error-path assertion look
  like a flaky timeout.
- `Provider_SupabaseRealtimeSync` is not in the default wrapper — it opens live
  channels that MSW rejects.
- Do **not** install the `canvas` npm package to fix canvas errors. It is a native
  build and will not install on Windows; `tests/setup/vitest.setup.ts` stubs what
  pdfjs, react-pdf and react-signature-canvas need.
- `tsc` cannot judge Deno code. `pnpm check:ef` (`deno check`) is the authority;
  `tests/setup/globals.d.ts` only silences cross-runtime false positives.
- If `tests/unit/edge/seam.test.ts` fails, nothing else under `tests/unit/edge/`
  can run. Fix the shim — do not delete the test.

## Commands

`pnpm test` · `pnpm test:fe:watch` · `pnpm test:fe:coverage` · `pnpm test:all` ·
`pnpm type-check:tests`
