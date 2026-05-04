# Field config metadata

> Version: [Outline](https://outline.jimbui.dev/doc/56e6639f-1482-46f3-b52a-72cd850bdf4a) | Tier 1: [AHR-1944](https://plane.jimbui.dev/aiur/browse/AHR-1944/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- `employee_columns.config jsonb NOT NULL DEFAULT '{}'::jsonb` exists.
- `employee-management_create-column` edge function accepts an optional `config` field in the request body, validates it is a plain object, and persists it on the inserted `employee_columns` row.
- `useQ_Tables_EmployeeColumns` SELECT exposes `config` so the field metadata reaches the frontend.
- Round-trip: create a field with `config = {"precision": 2}` → the row stores `{"precision": 2}` → the query returns `{"precision": 2}` to the frontend. Missing `config` in the request → row stores `{}` and the query returns `{}`.

## Scope boundaries

- No consumer of `config` ships in this T2 — field types still ignore it. Future T2s (currency, datetime, formula, linked-record) will be the first readers.
- No JSON-schema validation per field type. Schemaless until a consumer needs constraints.
- No UI changes to `App_EmployeeFieldComposerModal.tsx`. Future T2s that add new field types will introduce per-type config UI then.
- `EmployeeDataTable_TableField` (runtime grid-field shape in `employeeTable.types.ts`) stays `{key, label, type}` — that's a UI projection, separate from the DB row shape. Cell renderers don't need `config` yet.

## Decisions

- **Decision:** `config` is `jsonb NOT NULL DEFAULT '{}'`, not nullable.
  **Rationale:** Avoids null-handling in every consumer. Empty object means "no config", which is semantically the same as null but doesn't require null guards.
- **Decision:** Edge function validates `config` is a plain object (rejects arrays, strings, numbers, null) but does NOT enforce a per-type schema yet.
  **Rationale:** Object-shape guard prevents API misuse; schema validation belongs with the consumer that ships first.
- **Decision:** No migration backfill needed beyond the column default.
  **Rationale:** `DEFAULT '{}'` populates existing rows automatically. No data integrity work required.

## Implementation

### Phase A — DB migration

Add the `config` column with safe defaults and regenerate types. Smallest reversible change; no consumers yet so it cannot break anything downstream.

- [x] `pnpm sb:dev:new ahr1945_employee_columns_add_config` to scaffold migration
- [x] Write migration: `ALTER TABLE public.employee_columns ADD COLUMN config jsonb NOT NULL DEFAULT '{}'::jsonb;`
- [x] `pnpm sb:dev:push` to apply locally (preserves existing data)
- [x] `pnpm sb:dev:types` to regenerate `frontend/vite/src/types/database.types.ts`
- [x] `cd frontend/vite && supabase db lint --local` — resolve any warnings

### Phase B — Edge function passes `config`

Accept and persist `config` from API callers without breaking existing call sites.

- [x] In `frontend/vite/supabase/functions/employee-management_create-column/index.ts`, extend the request body parse to read `config`
- [x] Validate: when present, `typeof config === "object" && !Array.isArray(config) && config !== null`; reject with 400 otherwise
- [x] Default to `{}` when omitted; pass to the `employee_columns` insert payload
- [x] Verify backward compat: a request with no `config` field still succeeds and the row has `{}` _(verified at DB layer via direct insert smoke test; full edge-function path requires deploying the function locally — see Phase D notes)_

### Phase C — Frontend query exposes `config`

Make field metadata reach the UI carrying its config payload, even though no UI uses it yet.

- [x] Update `frontend/vite/src/hooks/useQ_Tables_EmployeeColumns.ts` SELECT clause to add `config`: `"id, label, type, config, created_at, updated_at"`
- [x] TypeScript should compile cleanly — `Tables_EmployeeColumns_QueryData` derives from the regenerated `Database` type, which now includes `config: Json` _(this hook + its consumers compile clean; project-wide `tsc` shows two unrelated pre-existing errors not caused by AHR-1945: `Utils_OrgTree_BuildTree.ts` and the queryKeys factory missing `employee_audit_log` — the latter belongs to AHR-1946 (parallel sibling) and will be added when its hooks land)_
- [ ] Verify in dev tools network panel that the field-metadata query returns `config` on every row _(deferred to Phase D — requires running frontend in browser)_

### Phase D — Round-trip verification

Single end-to-end test that proves the field is reachable from API → DB → query → UI memory.

**DB-layer smoke (done by /s):**

- [x] Direct `INSERT INTO employee_columns ... config = '{"precision": 2}'::jsonb` → row stored exactly that.
- [x] Direct `INSERT INTO employee_columns ...` without `config` → default `{}` applied, NOT NULL respected.
- [x] Drop trigger fires correctly when smoke rows are deleted.

**Full UI round-trip (manual — requires browser session):**

- [ ] Start local stack (`pnpm sb:dev:start`, frontend dev server)
- [ ] Sign in as an admin/owner of an org
- [ ] Hit the edge function with body `{ label: "Test config", type: "text", organization_id: "<orgid>", config: { "precision": 2 } }`
- [ ] Inspect `employee_columns` row in Studio: `config` = `{"precision": 2}`
- [ ] Refresh the employees page; in browser devtools, find the `useQ_Tables_EmployeeColumns` query data → confirm `config: {"precision": 2}` is present on the new field
- [ ] Repeat without `config` in the request body → confirm row has `{}` and frontend sees `{}`

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during /s and for sibling awareness during concurrent /p sessions._

Non-tech: Field metadata gets a free-form config slot so future field types (currency, datetime, formula, linked-record) can carry their per-field options without a schema migration each time.

Tech: One column add on `employee_columns` (jsonb default `'{}'`), one edge-function parameter pass-through (`employee-management_create-column/index.ts`), one SELECT clause expansion (`useQ_Tables_EmployeeColumns.ts`). No UI changes. `pnpm sb:dev:types` regen is the only cross-cutting touch.

Related: [Audit log foundation (AHR-1946)](https://plane.jimbui.dev/aiur/browse/AHR-1946/) — sibling step-1 foundation T2, fully independent.

Siblings: 8 total, 0 Done — all in Todo. Step 1: AHR-1945 + AHR-1946 (parallel). Steps 2/3/4 blocked until step 1 complete.

Execution Order: Step 1 of 4 — no prerequisites ✓

Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
