# Mutations split universal vs dynamic

> Version: [Outline](https://outline.jimbui.dev/doc/56e6639f-1482-46f3-b52a-72cd850bdf4a) | Tier 1: [AHR-1944](https://plane.jimbui.dev/aiur/browse/AHR-1944/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- `useM_Employee_Update` splits the patch payload by key prefix:
  - Keys starting with `col_` → upsert into `<orgid>__employees` keyed by `employee_id`.
  - All other keys → update on `public.employees` keyed by `id`.
  - Mixed patches issue both writes via `Promise.all`. Single failure throws.
- `employee-onboarding_approve-contract` edge function writes the new employee atomically across both tables:
  - INSERT employees → on success obtain `id`.
  - UPSERT `<orgid>__employees` with `employee_id = id` and the col_* values from the contract.
  - On per-org upsert failure, DELETE the global employees row to avoid orphans (preserves existing rollback pattern).
- Employee delete: unchanged. FK `ON DELETE CASCADE` on `<orgid>__employees.employee_id` handles cleanup.
- Audit: writes to global trigger `audit_employees_global`; writes to per-org trigger `audit_employees_perorg` (attached by AHR-1947). Both produce `employee_audit_log` rows.

## Pass criteria

- Edit a universal field + a `col_*` field on one employee in a single grid commit → both rows updated, optimistic UI fires once, audit log shows two rows (`first_name` and `col_<id>`).
- Approve a new onboarding contract with both universal and col_* values → a global employees row and a per-org employees row both exist with correct values; audit log shows `__inserted` rows on both tables.
- Inject a per-org upsert failure (e.g., temporarily revoke the per-org policy) → global employees row is rolled back (deleted); no orphan.
- Delete an employee → both rows gone via CASCADE; no manual cleanup needed.
- All existing employee flows continue to work (department assignment, contract sign, view config, etc.).

## Scope boundaries

- **No new admin-create-employee UI mutation.** Today there's no "manually add employee" UI; if/when one ships, it'll get its own dual-write hook.
- **No SQL transaction across `employees` + per-org tables.** Atomicity via compensating-rollback (delete employees on per-org failure).
- **No invitee-write RLS policy on per-org tables.** Onboarding approve runs as service-role which bypasses RLS, same as the existing employees insert.
- **No batch-update API.** One-at-a-time mutations. Bulk grid edits already use one mutation per row.

## Decisions

- **Decision:** Split payload by key prefix (`col_` → per-org, else → employees).
  **Rationale:** Caller doesn't have to know which fields are universal vs dynamic. Field-id convention (`col_<id>`) is the natural discriminator.
- **Decision:** UPSERT (not INSERT) on per-org.
  **Rationale:** AHR-1949 ensures every existing employee has a per-org row, but UPSERT is defensive against missed-backfill cases or future code paths bypassing per-org insert.
- **Decision:** Compensating-rollback in onboarding edge function (delete global on per-org failure).
  **Rationale:** Reuses the existing rollback pattern already in `employee-onboarding_approve-contract` for downstream failures (the function already deletes the new employee when contract update or department insert fails). Adding per-org failure to that same compensating path is consistent.
- **Decision:** Mutation hook keeps `queryClient.invalidateQueries({ queryKey: QueryKeys.employees.all() })`.
  **Rationale:** Hybrid policy from `ext-tanstack-query-mutation`. Single-tab feedback is instant. Cross-tab/cross-user sync waits on the realtime follow-up (deferred from AHR-1950).

## Implementation

### Phase A — Update useM_Employee_Update

The mutation hook becomes payload-splitting. Hook params take `organizationId` so it can resolve the per-org table name.

- [x] Updated signature: `useM_Employee_Update({ organizationId })`.
- [x] `mutationFn` splits the patch by `^col_[A-Za-z0-9]+$` regex. Universal write goes to `employees`, dynamic write upserts on per-org keyed by `employee_id`. `Promise.all` runs them in parallel; throws on first error.
- [x] Updated single call site (`App_EmployeeDetailModal.tsx:70`) to pass `organizationId`. No other call sites exist.
- [x] `onSuccess` invalidation unchanged — `QueryKeys.employees.all()` covers both read paths via the merged hook from AHR-1950.

### Phase B — Onboarding edge function dual-write

Extend the approve-contract path to write to per-org after creating the employees row.

- [x] Removed `...colValues` from the global `employees` insert payload — the global insert is now universal-only.
- [x] After global insert succeeds, upsert per-org `<orgid>__employees` with `{ employee_id, ...colValues }` and `onConflict: 'employee_id'`. Always runs (even when `colValues` is empty) so the per-org row exists for future updates.
- [x] On per-org upsert failure, `supabaseAdmin.from("employees").delete().eq("id", newEmployee.id)` rolls back the global row.
- [x] Existing downstream rollback paths (contract update failure, department insert failure) work unchanged — deleting the global employees row CASCADEs the per-org row away via the FK from AHR-1947.

### Phase C — Smoke verify

- [x] `npx tsc --noEmit` clean across the whole project.
- [ ] Browser smoke (manual): edit a universal field + a `col_*` field on the same employee in the detail modal — confirm both write paths fire; audit log gets one row per changed field on the appropriate table.
- [ ] Browser smoke (manual): approve an onboarding contract that includes col_* values — confirm employees + per-org both populated; audit log captures both `__inserted` rows.
- [ ] Failure injection (manual): test the compensating rollback by revoking a per-org RLS policy, attempting onboarding approve, confirming no orphan global row.
- [ ] Delete employee (manual): one row in `employee_audit_log` for global `__deleted`. Per-org cascade deletion may or may not fire AFTER DELETE triggers depending on PG behaviour — verify in browser smoke.
- [ ] Existing flows: contract signing, department assignment, view configs — verify no regression.

## Context

_Stripped at /pp push time._

Non-tech: When HR edits an employee, the change is now written to both the global table (universal fields like name/email) and the org-private table (custom fields). New employees created via onboarding land in both tables atomically. End-user experience is identical.

Tech: `useM_Employee_Update` becomes payload-splitting. `employee-onboarding_approve-contract` adds a per-org upsert with compensating rollback. Dual-write atomicity via SDK-level pattern, not SQL transaction. Audit triggers on both tables capture the writes.

Related: [Per-org employees factory (AHR-1947)](https://plane.jimbui.dev/aiur/browse/AHR-1947/) — per-org tables + audit triggers. [Grid reads per-org dynamic table (AHR-1950)](https://plane.jimbui.dev/aiur/browse/AHR-1950/) — read path that this mutation feeds.

Siblings: 8 total, 0 Plane-Done, 3 effective Done — AHR-1945, AHR-1946, AHR-1947 (all local pending /pp).

Execution Order: Step 3 of 4 — bundled with AHR-1948, AHR-1949, AHR-1950 for single cutover deploy. Prerequisites: AHR-1947 done ✓.

Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
