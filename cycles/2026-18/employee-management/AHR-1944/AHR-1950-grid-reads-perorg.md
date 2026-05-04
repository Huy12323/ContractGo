# Grid reads per-org dynamic table

> Version: [Outline](https://outline.jimbui.dev/doc/56e6639f-1482-46f3-b52a-72cd850bdf4a) | Tier 1: [AHR-1944](https://plane.jimbui.dev/aiur/browse/AHR-1944/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- Helper `orgEmployeesTable(orgId): string` returns `${orgId}__employees`. Lives in `frontend/vite/src/utils/` or alongside `employeeTable.types.ts`.
- New TS type `EmployeeDynamicRow = { employee_id: string; [key: string]: unknown }` exposed in `employeeTable.types.ts`.
- `useQ_Tables_OrgEmployees` extended to fetch BOTH `public.employees` AND `<orgid>__employees` in parallel (`Promise.all`), then flat-merge each pair by `employees.id === <perorg>.employee_id`. Returned row shape: `EmployeeRow & Record<string, unknown>` with col_* keys merged onto the row directly.
- Glide grid cell renderer in `App_EmployeeDataGrid.tsx` continues to look up `row[key]` directly — no renderer code change required since the merge is flat.
- Existing realtime invalidation continues to fire on `employees` table changes. Per-org table realtime is OUT of scope for this T2.

## Pass criteria

- Side-by-side comparison: the employee list grid renders identically before and after this T2 (same columns, widths, values, ordering).
- Filter/sort/group on a `col_*` field works in the grid.
- RLS isolation: org A admin reading the grid sees only org A's employees and only org A's col_* values.
- Realtime smoke: edit a universal field in another tab → grid in this tab updates (universal-field path unchanged).
- Type-check passes: `npx tsc --noEmit` shows no NEW errors caused by AHR-1950 (pre-existing unrelated errors are accepted).

## Scope boundaries

- **No realtime trigger on per-org tables.** Cross-tab/cross-user updates of dynamic fields will NOT sync until a follow-up T2 attaches `realtime_table_events` posting to per-org tables. Mutations (AHR-1951) keep `queryClient.invalidateQueries` for instant single-tab feedback.
- **No types-gen filtering.** Per-org tables remain in `database.types.ts` post-regen; frontend accesses them via `supabase.from(<dynamic name>)` with explicit cast to `EmployeeDynamicRow`. Supabase CLI lacks a first-class exclude-pattern.
- **No nested-select / RPC join.** Two parallel queries + client merge, not a single round-trip.
- **No changes to `useQ_Tables_OrgEmployeesWithDepartments`** — that hook joins through a different relation; if its consumers also need col_* access, that's a follow-up.

## Decisions

- **Decision:** Flat-merge (`{...employee, ...dynamicRow}`) instead of nested (`{...employee, dynamic: dynamicRow}`).
  **Rationale:** Cell renderer + filter/sort/group engines already index by flat key. Nesting forces every consumer to switch on key-prefix.
- **Decision:** Two parallel Supabase queries with `Promise.all`, merged in `queryFn`.
  **Rationale:** Supabase nested-select doesn't support dynamically-named related tables. Two queries are simpler with identical RLS semantics. RTT impact: ~one extra round-trip, negligible at HR scale.
- **Decision:** Defer per-org realtime to a follow-up T2.
  **Rationale:** The realtime infra has the FK bug we hit during AHR-1947 smoke. Solving it touches realtime infrastructure outside Employee Management's scope.
- **Decision:** No new `useQ_Tables_PerOrgEmployees` hook. Extension lives inline in `useQ_Tables_OrgEmployees`.
  **Rationale:** Avoids hook proliferation. The fact that data comes from two tables is an implementation detail of the existing hook.

## Implementation

### Phase A — Helper + types

- [x] Add `orgEmployeesTable(orgId: string): string` to `frontend/vite/src/types/employeeTable.types.ts`
- [x] Add `export type EmployeeDynamicRow = { employee_id: string; [key: string]: unknown };` to `employeeTable.types.ts`
- [x] Regenerated `database.types.ts` — per-org tables present; cast `as 'employees'` used at the SDK call site to type-check the dynamic name

### Phase B — Query hook extension

- [x] In `useQ_Tables_OrgEmployees.ts`, change `fetchOrgEmployees(organizationId)` to:
  1. `const tableName = orgEmployeesTable(organizationId);`
  2. `const [empResult, dynResult] = await Promise.all([supabase.from('employees').select('*').eq('organization_id', organizationId), supabase.from(tableName as 'employees').select('*') as unknown as Promise<{ data: EmployeeDynamicRow[] | null; error: PostgrestError | null }>]);`
  3. Throw on either error
  4. Build a Map: `dynamicByEmployeeId = new Map(dynResult.data.map(r => [r.employee_id, r]));`
  5. Return `empResult.data.map(emp => ({ ...emp, ...(dynamicByEmployeeId.get(emp.id) ?? {}) }))`
- [x] Update `Tables_OrgEmployees_QueryData` type if needed — `Awaited<ReturnType<...>>` picks up the merged shape automatically.
- [x] Sort behavior preserved — `.order("first_name", { ascending: true })` stays on the employees query.

### Phase C — Type-check + smoke

- [x] `npx tsc --noEmit` — fully clean (zero errors). The previously-reported `Utils_OrgTree_BuildTree.ts` errors were cascading from the missing `employee_audit_log` queryKeys entry, which AHR-1950 fixed.
- [x] **Sibling cleanup folded in:** added `employee_audit_log` entry to `QueryKeys` (missed by AHR-1946) and excluded per-org table names from the `satisfies` exhaustiveness check via `type StaticTableName = Exclude<TableName, \`org_${string}__employees\`>`. This unblocks tsc for the whole project.
- [ ] Browser smoke (manual, requires running frontend): side-by-side render check. Filter/sort/group on `col_*`. Cross-org isolation by switching org context.

## Context

_Stripped at /pp push time._

Non-tech: The employee list grid now reads dynamic field values from each organization's private table instead of the shared global one. Visually nothing changes — the merge is invisible to the user.

Tech: `useQ_Tables_OrgEmployees` extended with `Promise.all` two-query pattern + Map-based merge. New helper `orgEmployeesTable(orgId)` and type `EmployeeDynamicRow` in `employeeTable.types.ts`. Glide grid + filter/sort/group engines untouched (flat merge preserves their key-access pattern).

Related: [Per-org employees factory (AHR-1947)](https://plane.jimbui.dev/aiur/browse/AHR-1947/) — provides the per-org tables. [Backfill existing data (AHR-1949)](https://plane.jimbui.dev/aiur/browse/AHR-1949/) — populates them.

Siblings: 8 total, 0 Plane-Done, 3 effective Done — AHR-1945, AHR-1946, AHR-1947 (all local pending /pp).

Execution Order: Step 3 of 4 — bundled with AHR-1948, AHR-1949, AHR-1951 for single cutover deploy. Prerequisites: AHR-1947 done ✓.

Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
