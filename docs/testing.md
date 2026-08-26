# Testing

## The ladder

ContractGo's risk profile is *evidentiary correctness of pure decision logic* —
who signs when, what the audit payload says, whether a send is legal. Not
rendering. The silos are adopted in that order, and **not all of them are
adopted**.

| Silo | Status | Why |
|---|---|---|
| **Unit** (vitest + jsdom + MSW) | **Live** | The highest-risk functions in the product (`validateForSend`, `buildSignerRows`, `firstSignerOrder`, `resolveSchedule`) are already pure and already extracted into `_shared/envelopeCompose.ts`. Testable with zero refactor. |
| **Integration** (real local Supabase) | Designed, not built | The other half of the evidentiary surface — the hash chain, RLS isolation, token resolution — lives in Postgres and edge functions and is unreachable from unit tests. Expensive to make self-cleaning without `db reset`, so it must not be attempted first. |
| **E2E** (Playwright) | Deferred | See triggers below. |
| **WASM/browser** | **Skipped permanently** | ContractGo has no WASM. The browser-only surfaces (pdfjs canvas, `react-signature-canvas`) belong in E2E, not a fifth silo. |
| **Worker** (`@cloudflare/vitest-pool-workers`) | Deferred | `cloudflare/workers/files/src/index.js` has genuinely severe pure logic — a `getCacheStrategy` bug flipping a signed contract PDF from `private` to `public, max-age=604800` puts an evidentiary document in a shared CDN cache. But those functions are module-private, so testing them would mean adding `export` keywords to Worker runtime source. Behaviourally inert, but not a zero-source-change call — needs a decision, not an assumption. |

**Do not add a silo because it would be nice.** Integration starts when the unit
suite has caught at least one real regression. E2E starts on any of: a
signing-flow incident the earlier silos could not have caught; `react-signature-canvas`
leaving `1.1.0-alpha.2` or `pdfjs-dist` being unpinned from `5.4.296`; CI running
the earlier silos reliably for a month; or a second developer joining.

## Running

| Command | What it does |
|---|---|
| `pnpm test` / `pnpm test:fe` | The unit suite. No services required. |
| `pnpm test:fe:watch` | Watch mode. |
| `pnpm test:fe:coverage` | Coverage to `frontend/vite/coverage/`. Reporting only — thresholds are 0 on purpose. |
| `pnpm test:all` | The pipeline runner, with the production refusal (below). |
| `pnpm type-check` | `tsc --noEmit` over `src`. This is the production-build guarantee. |
| `pnpm type-check:tests` | `tsc --noEmit -p tsconfig.test.json` — tests plus the `_shared` modules they import. |

Coverage thresholds are all `0` deliberately. A threshold above zero on a repo
starting from zero tests turns every new untested file into a red build, which is
how teams learn to pass `--no-verify`.

## The `db reset` rule

`frontend/vite/supabase/seed.sql` states that `supabase db reset` is **banned** —
the local database carries hand-built seed data. So **no test may depend on a
clean starting state.** When the integration silo lands, the contract replacing it
is:

1. Every test **creates** everything it asserts on. No fixture references a
   seeded org, user or template by name.
2. Every test **deletes** what it created, and can **prove** which rows are its
   own — via a run ID (`test-${runId}-*@contractgo.test`) and a LIFO cleanup
   stack. The `.test` TLD makes a stray production email impossible and a
   `LIKE '%@contractgo.test'` orphan sweep safe.
3. **No SQL-fabricated envelopes.** `source_pdf_sha256`, `template_snapshot`,
   hashed signer tokens and the audit hash chain are all *derived*. A
   SQL-fabricated envelope satisfies the constraints and fails every reader.
   Drive `envelopes_draft_create` + `envelopes_send` instead —
   `scripts/seed-demo-contractgo.js` is the reference implementation and already
   does exactly this.

## Writing a unit test

Use the wrappers in `tests/setup/react/wrappers.tsx`:
`renderWithProviders`, `renderHookWithProviders`, `makeTestQueryClient`.

Two things they do that matter:

- `Provider_ANTD` **already renders antd's `<App>`** internally. Do not add
  another — two `<App>` instances produce two message/notification contexts and
  the "wrong" one wins non-deterministically.
- The test QueryClient overrides production's `staleTime: 60_000, retry: 1`
  (from `src/configs/query/config.ts`). With retry on, every error-path assertion
  waits out a retry and reads as a flaky timeout.

`Provider_SupabaseRealtimeSync` is deliberately **not** in the default wrapper —
it opens live Supabase realtime channels, which MSW rejects on every render.

### The MSW contract

`tests/setup/msw/handlers.ts` exports an **intentionally empty** handler array,
and the server runs with `onUnhandledRequest: "error"`.

> If your test errors on an unhandled request, **that is the design.** Add a
> `server.use(...)` declaring the request you expect.

A global handler list would let a component quietly fire an unexpected Supabase
call and still pass — precisely the bug class this silo exists to catch.
`tests/unit/msw-strictness.test.ts` asserts the strictness is actually wired; if
it ever passes trivially, every other test is silently hitting the network.

Helpers in `handlers.ts`: `supabaseUrl(path)`, `edgeFn(name)`, `workerFile(path)`,
`ok(body)`, `supabaseError(message, status)`.

## Testing edge-function logic from vitest

`tests/setup/deno-shim.ts` installs a minimal `Deno` global so `_shared` modules
can be imported from Node. It **must** be the first entry in `setupFiles` and
**must** be its own module: ESM imports hoist, and
`supabase/functions/_shared/storage.ts:86` reads `Deno.env` at *module scope*.

`vitest.config.ts` also aliases:

- `supabase` → `@supabase/supabase-js` (edge functions use that bare specifier,
  mapped by each function's `deno.json` to esm.sh)
- `@aws-sdk/*` → `tests/setup/stubs/aws-sdk.ts` (the R2 driver is unreachable
  under `STORAGE_DRIVER=local`; the stub throws loudly if it is ever constructed)

**The rule, and it is not negotiable:**

> Only import **pure** functions from `_shared`. Anything that needs a real
> `SupabaseClient` belongs in the integration silo.

The shim makes `_shared` *importable*, and capabilities get abused. Do not
unit-test `resolveSignerToken` with a mocked client — it has hundreds of lines of
DB-coupled behaviour and a mock of it tests the mock. The `supabase` alias is also
a **version** substitution (edge pins 2.49.4, the app is on ^2.101.1), so any
`_shared` code that actually calls the client would be tested against a different
client than production runs.

`tests/unit/edge/seam.test.ts` guards both assumptions. If it fails, nothing else
under `tests/unit/edge/` can run — fix the shim, don't delete the test.

## Type-checking across two runtimes

`tsc` cannot judge Deno code: the Deno lib and the DOM lib disagree (e.g. TS 5.7
narrowed `BufferSource` so a plain `Uint8Array` no longer satisfies
`crypto.subtle.digest`). `tests/setup/globals.d.ts` carries the minimal
cross-runtime declarations so `pnpm type-check:tests` doesn't report false
positives on code it isn't qualified to judge.

**`deno check` — `pnpm check:ef` — remains the authority on edge-function types.**
It uses the real Deno lib and each function's real import map. It skips
gracefully when Deno isn't on PATH, so install Deno if you want that gate locally.

## What is deliberately untested

- **The mock signing drivers.** `SIGNING_DRIVER`/`IDENTITY_DRIVER`/
  `TIMESTAMP_DRIVER` default to `mock` and produce evidentially worthless PAdES.
  Testing the mock proves nothing; the real drivers get tests when they exist.

  `OTP_DRIVER` is no longer one of them. It defaults to `email` (CG-031) and the
  driver is real — but it is still not unit-tested here, for the standing reason
  in the section above: it needs a live `shared--send-email`, which puts it
  outside the unit silo. What IS covered is the part that can be: the SQL
  behind it is asserted by `cg031`'s own probe block (attempt cap, resend
  cooldown, lockout, one-statement verification), and the two pure helpers have
  tests — `envelopeCompose.signerAuth.test.ts` and
  `signerAuth.mailboxProof.test.ts`. The end-to-end passcode flow is exercised by
  hand against the local stack; see the CG-031 walkthrough in the plan.
- **The Gemini driver** (`_shared/ai.gemini.ts`). It is a `fetch` call and a
  response-shape mapping; a unit test of it would assert that our mock of
  Google's API matches our reading of Google's API. What IS covered is
  everything that decides whether an answer reaches a signer:
  `aiPrompt.verify`, `aiPrompt.build` and `aiPrompt.sufficiency` — all pure,
  all on the right side of the rule above, and factored that way on purpose.
  The failure branches the driver reports are reachable by hand through the mock
  driver's sentinel questions (`__mock_429` and friends); see
  `docs/ai-assistant.md`.
- **The assistant's rendering** — rail-versus-drawer host selection, drawer
  focus return, the cooldown interval. Rendering, which belongs to E2E per the
  ladder.
- **Generated files** — `src/routeTree.gen.ts`, `src/types/database.types.ts`.
- **Migrations.** They are the schema's source of truth and are verified by
  applying them, not by unit tests.

See `docs/development.md` for local-setup footguns.
