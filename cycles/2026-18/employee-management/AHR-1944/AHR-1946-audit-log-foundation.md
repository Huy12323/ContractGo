# Audit log foundation

> Version: [Outline](https://outline.jimbui.dev/doc/56e6639f-1482-46f3-b52a-72cd850bdf4a) | Tier 1: [AHR-1944](https://plane.jimbui.dev/aiur/browse/AHR-1944/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- `employee_audit_log` table exists with columns: `id` (text PK), `employee_id` (TEXT, **no FK** — historical reference only), `organization_id` (FK to `organizations` with ON DELETE CASCADE), `actor_user_id` (uuid FK to `auth.users` nullable, ON DELETE SET NULL), `field_key` (text), `old_value` (jsonb), `new_value` (jsonb), `changed_at` (timestamptz default now).
- Indexes on `(employee_id, changed_at DESC)` and `organization_id`.
- RLS enabled. Only SELECT policy attached: `admin_or_owner_can_view_employee_audit_log`. No client INSERT/UPDATE/DELETE policies — all writes are trigger-only.
- Reusable helper `public.audit_employee_diff(p_employee_id, p_organization_id, p_old jsonb, p_new jsonb, p_skip_keys text[])` iterates JSONB keys and inserts one row per differing column.
- `public.audit_employees_global()` trigger function handles `INSERT | UPDATE | DELETE` on the global `employees` table:
    - INSERT: one row, `field_key='__inserted'`, `new_value = to_jsonb(NEW) - skip_keys`.
    - UPDATE: per-changed-column rows via the helper.
    - DELETE: one row, `field_key='__deleted'`, `old_value = to_jsonb(OLD) - skip_keys`.
- `public.audit_employees_perorg()` trigger function ships in this T2 but is not attached to anything yet — AHR-1947 (provisioning factory) attaches it to each per-org dynamic table at provisioning time. Same INSERT/UPDATE/DELETE handling, reads `employee_id` from the row directly, takes `organization_id` from `TG_ARGV[0]` (baked-in literal).
- `trigger_audit_employees AFTER INSERT OR UPDATE OR DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION audit_employees_global()` attached.
- `pnpm sb:dev:types` regenerated; new types include `employee_audit_log`.

## Pass criteria

- Updating an employee's `first_name` produces exactly one audit row with `field_key="first_name"`, correct `old_value`, `new_value`, and `actor_user_id`.
- Updating two universal fields in one statement produces exactly two audit rows.
- Updating only `first_name` does NOT produce a separate `__full_name` row (skip-list excludes it).
- Inserting a new employee produces exactly one `__inserted` audit row with the full row JSON in `new_value`.
- Deleting an employee produces exactly one `__deleted` audit row that **persists** after the employee row is gone.
- Org A admin SELECT sees only org A's audit rows.
- A service-role mutation logs `actor_user_id = NULL` without error.
- `supabase db lint --local` is clean.

## Scope boundaries

- **No audit display UI** — capture only. P4 owns the read/render UI.
- **No INSERT/UPDATE/DELETE auditing on per-org dynamic tables in this T2.** The `audit_employees_perorg` function ships but is not attached to anything. AHR-1947 owns the attachment.
- **No retention policy / pruning logic.** Audit rows accumulate indefinitely until org deletion (which cascades them away).
- **No bulk-update guards.** A bulk UPDATE of N rows changing K fields each emits N×K audit rows; acceptable for HR-scale workloads.
- **No INSERT/DELETE attribution to source** (e.g., onboarding-invitation auto-create vs admin-create). All non-trigger-fired changes show whatever `auth.uid()` returns.

## Decisions

- **Decision:** `employee_id` is TEXT with no FK to `employees(id)`. Only `organization_id` carries an FK (ON DELETE CASCADE).
  **Rationale:** Audit-log standard pattern. An FK on `employee_id` would cascade-wipe audit rows when an employee is deleted, defeating the purpose. The `__deleted` audit row needs to outlive the employee. Org-level cascade is intentional (deleting an org removes all derived data — GDPR-aligned).

- **Decision:** Generic JSONB diff via `to_jsonb(OLD)` / `to_jsonb(NEW)` with a hardcoded skip-list, not per-column `IF OLD.x IS DISTINCT FROM NEW.x` blocks.
  **Rationale:** Future-proof — adding a universal column to `employees` (or a `col_*` to per-org) auto-audits without editing the trigger. The same generic logic reuses cleanly for per-org tables.

- **Decision:** Helper function `audit_employee_diff` + two trigger functions (`audit_employees_global`, `audit_employees_perorg`). Ship both trigger functions in this T2 even though only the global one is attached here.
  **Rationale:** Foundation owns the trigger function definitions; provisioning T2 (AHR-1947) owns the attachments to per-org tables. Keeps a clean ownership line: when audit logic changes, it changes in one place; AHR-1947 just attaches.

- **Decision:** Lifecycle coverage = INSERT + UPDATE + DELETE (full).
  **Rationale:** User-confirmed scope expansion at planning time. Cheap to add now; impossible to backfill later.

- **Decision:** `__full_name` (GENERATED column) is in the skip-list.
  **Rationale:** It auto-recomputes when `first_name` or `last_name` changes. Auditing it would emit a duplicate row alongside the actual source-column edit, polluting the log.

- **Decision:** Trigger-only writes (no client INSERT/UPDATE/DELETE policies on `employee_audit_log`).
  **Rationale:** Tamper resistance. HR cannot fake or alter audit entries through the SDK. `SECURITY DEFINER` triggers bypass RLS for the trigger-driven inserts.

## Implementation

### Phase A — Schema migration

Single SQL migration file containing the table, RLS, helper function, both trigger functions, and the trigger attachment on global `employees`. The `audit_employees_perorg` function ships unattached for AHR-1947 to consume.

- [x] Create migration file `frontend/vite/supabase/migrations/<YYYYMMDDHHMMSS>_create_employee_audit_log.sql`
- [x] Define `public.employee_audit_log` table with the columns and FK constraints from Requirements
- [x] Create indexes `idx_employee_audit_log_employee_changed_at` and `idx_employee_audit_log_organization_id`
- [x] `ALTER TABLE public.employee_audit_log ENABLE ROW LEVEL SECURITY`
- [x] Attach SELECT policy `admin_or_owner_can_view_employee_audit_log` using `public.is_admin_or_owner(organization_id)`. No INSERT/UPDATE/DELETE policies.
- [x] Define helper function `public.audit_employee_diff(p_employee_id text, p_organization_id text, p_old jsonb, p_new jsonb, p_skip_keys text[])` returning void: walk `jsonb_object_keys(p_new)`, skip keys in `p_skip_keys`, INSERT one audit row per key where `p_old->k IS DISTINCT FROM p_new->k`. `SECURITY DEFINER`, `SET search_path = public`.
- [x] Define `public.audit_employees_global()` trigger function with INSERT/UPDATE/DELETE branches per the design above. Skip-list: `ARRAY['id','organization_id','user_id','created_at','updated_at','__full_name']`. `SECURITY DEFINER`, `SET search_path = public`.
- [x] Define `public.audit_employees_perorg()` trigger function with the same INSERT/UPDATE/DELETE shape, reading `employee_id` from row, `organization_id` from `TG_ARGV[0]`. Skip-list: `ARRAY['employee_id']`. (Not attached in this migration.)
- [x] Attach `CREATE TRIGGER trigger_audit_employees AFTER INSERT OR UPDATE OR DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.audit_employees_global()`
- [x] Run `pnpm supabase db push --local`
- [x] Run `pnpm supabase db lint --local`; resolve any warnings (especially `auth_rls_initplan` if present)

### Phase B — Type regen + smoke verification

- [x] Regenerate types: `pnpm sb:dev:types`. Verify `database.types.ts` includes `employee_audit_log` with the expected columns.
- [x] Smoke 1 — UPDATE single field: pick a test employee, `UPDATE employees SET first_name = 'X' WHERE id = '<emp>'` via Studio (signed in as HR). Expect exactly one row in `employee_audit_log` with `field_key='first_name'`, correct old/new, `actor_user_id` populated.
- [x] Smoke 2 — UPDATE two fields: change `first_name` and `birthday` in one statement. Expect exactly two audit rows. Confirm no `__full_name` row.
- [x] Smoke 3 — INSERT: `INSERT INTO employees (...) VALUES (...)`. Expect one audit row with `field_key='__inserted'`, `new_value` = JSONB of the inserted row minus skip-keys.
- [x] Smoke 4 — DELETE: `DELETE FROM employees WHERE id = '<emp>'`. Expect one audit row with `field_key='__deleted'`, `old_value` populated, persisting after the employees row is gone (verify by querying `SELECT * FROM employee_audit_log WHERE employee_id = '<emp>'` post-delete).
- [x] Smoke 5 — RLS isolation: as org A admin, `SELECT * FROM employee_audit_log` returns only org A's rows. Direct `WHERE organization_id = '<org_B>'` returns empty.
- [x] Smoke 6 — service-role: run an UPDATE via service role (no `auth.uid()`), confirm audit row inserted with `actor_user_id = NULL`.
- [x] Rerun `pnpm supabase db lint --local`, ensure clean.

## Context

_Stripped at /pp push time. Lives in the plan file only._

Non-tech: HR compliance audit trail. Every change to employee data (universal fields now; dynamic `col_*` fields once AHR-1947 attaches the per-org trigger) is captured with who, what, when, and the before/after values. HR can answer "who edited X" questions; deleted employees retain their history.

Tech: New table `public.employee_audit_log`. Helper fn `public.audit_employee_diff`. Two trigger fns (`audit_employees_global`, `audit_employees_perorg`). One trigger attached: `trigger_audit_employees` on `public.employees`. RLS gated by `public.is_admin_or_owner` helper. Migration file: `frontend/vite/supabase/migrations/<new>_create_employee_audit_log.sql`.

Related: [Employee Management spec](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) — owning module. [ext-supabase-rls-policies](.claude/skills/ext-supabase-rls-policies/SKILL.md) — `is_admin_or_owner` helper convention.

Siblings: 8 total, 0 Done, 1 effective In Progress (AHR-1945 — Field config metadata, planned locally per parallel /p session).

Execution Order: Step 1 of 4 — parallel with AHR-1945. No prerequisites (foundation step). All clear ✓.

Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
