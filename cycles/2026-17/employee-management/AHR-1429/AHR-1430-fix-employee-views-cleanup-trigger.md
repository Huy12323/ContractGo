# Migration to realign cleanup trigger with split schema

Work Item: [AHR-1430](https://plane.jimbui.dev/aiur/browse/AHR-1430/)
Tier 1: [AHR-1429](https://plane.jimbui.dev/aiur/browse/AHR-1429/) [v0.0.1 | Employee Management] Fix delete field — employee_views cleanup trigger after config split (In Progress)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: The "Delete field" action in the employees table column-header dropdown silently failed — users confirmed the delete in the modal, but the field never disappeared and a generic "Failed to delete field" toast showed. Column-header menu wiring, the `useM_EmployeeColumn_Delete` mutation, and RLS were all intact; the bug was a database-side regression from a schema split that sealed with AHR-940.

Tech: The AFTER DELETE trigger `clean_employee_views_on_column_delete` on `employee_columns` (AHR-405, `frontend/vite/supabase/migrations/20260415083722_ahr405_employee_views_column_cleanup_trigger.sql`) strips references to the deleted column id from every saved view in the same org. It was written against the old single-JSONB `employee_views.config` column. AHR-941's migration (`20260417100000_ahr941_employee_views_split_config.sql`) dropped `config` and promoted its sub-keys to dedicated JSONB columns: `filter`, `sort`, `group_by`, `hidden_keys`, `field_order`, `field_widths`. The trigger was never updated — every `DELETE FROM employee_columns` now raises `column "config" does not exist` and rolls back, which is what reached the frontend as the failed-mutation toast. Additionally, `filter` flattened from a recursive `kind/children` tree to `EmployeeTable_FilterCondition[]` (AHR-941 again, mirrored in `frontend/vite/src/types/employeeTable.types.ts:38` and the `patchActiveView({ filter: [...] })` calls in `PageEmployees_ListView.tsx`), so the trigger's recursive `clean_employee_view_filter_node` helper is also obsolete.

Related: AHR-405 (introduced the original trigger), AHR-941 (split the schema; the regression originates here and was only surfaced when a user clicked "Delete field"), AHR-940 (parent T1 of AHR-941, now sealed in Done state — cannot accept a lateral T2 per version sealing rule, so this landed as its own T1).

Siblings: None — this is a solo-T2 hotfix T1.

Execution Order: Single step — database-only change, independent of all other work.

## Phase A: Rewrite trigger function against split schema

- [x] Create migration `frontend/vite/supabase/migrations/20260421110000_ahr_fix_employee_views_cleanup_trigger_split_config.sql`
- [x] `DROP FUNCTION IF EXISTS public.clean_employee_view_filter_node(JSONB, TEXT)` — obsolete recursive helper; filter is now a flat array, not a tree node
- [x] `CREATE OR REPLACE FUNCTION public.clean_employee_views_on_column_delete()` — single `UPDATE public.employee_views v ... WHERE v.organization_id = OLD.organization_id` that rewrites all five per-key columns in one statement:
    - `field_order`: `COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements_text(v.field_order) AS elem WHERE elem <> OLD.id), '[]'::jsonb)`
    - `hidden_keys`: same shape as `field_order` (both are `string[]`)
    - `sort`, `group_by`, `filter`: `COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements(v.<col>) AS elem WHERE elem->>'field' <> OLD.id), '[]'::jsonb)` (all three are `{field, ...}[]`)
    - `updated_at = now()` bumped for realtime consumers
- [x] Trigger `trigger_clean_employee_views_on_column_delete` itself is unchanged — `CREATE OR REPLACE FUNCTION` on the target function is sufficient, no DROP/CREATE TRIGGER needed
- [x] Apply locally via `pnpm sb:dev:push` (not reset — preserves dev data per bible-supabase-migrations rule)
- [x] Regenerate types via `pnpm sb:dev:types`
- [x] End-to-end verification against local DB: inside a transaction, insert `col_testdel` into `employee_columns`, reference it in `field_order`, `hidden_keys`, `sort`, `group_by`, `filter` across the org's views; issue `DELETE FROM employee_columns WHERE id = 'col_testdel'`; observe the DELETE succeeds (previously errored), all five keys cleaned (`field_order` array loses the entry, the other four collapse to `[]`), and the physical `col_testdel` column is also dropped from `public.employees` by the sibling `drop_employee_physical_column` trigger (AHR-679 / `20260416071129_*`). Rollback the transaction.

---

## Plane IDs (populated by /pp)

Phase A: AHR-1431

- Task 1: AHR-1432
