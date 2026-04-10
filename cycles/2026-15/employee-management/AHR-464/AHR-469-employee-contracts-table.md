# [v0.0.1 | Employee Management] Contract composer template builder > employee_contracts table

Work Item: [AHR-469](https://plane.jimbui.dev/aiur/browse/AHR-469/)
Tier 1: [AHR-464] [v0.0.1 | Employee Management] Contract composer template builder (Todo)
Module: [Employee Management](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: [Employee Management](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd)
Version Doc: [Employee Management](https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802)

## Context (from spec)

Non-tech: Create the employee_contracts table to store filled and signed contract instances. Each contract references a template (onboarding_form) and an employee, with a frozen form_snapshot for audit integrity. Deleting a template cleans up drafts and preserves signed records.
Tech: `supabase/migrations/` — new migration for ENUM + table + indexes + RLS + trigger. `onboarding_forms` table (FK target, ON DELETE SET NULL). `employees` table (FK target, ON DELETE CASCADE). `src/types/database.types.ts` — regenerate.
Related: [Database](https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b) — base schema, RLS helpers, generate_id(). [Organization](https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — org context, organization_members for RLS.
Siblings: 4 total, 0 Done — [AHR-467 Contract composer editor (Not started), AHR-468 Contract template preview (Not started), AHR-469 employee_contracts table (Not started), AHR-470 Organization soft delete (Cancelled)]
Execution Order: Step 1 of 3 — no prerequisites ✓ (AHR-470 cancelled, AHR-469 is sole step 1)

## Phase A: Schema migration + type regeneration

- [x] Create migration file — ENUM `employee_contracts_status_enum` (draft, signed, voided), `employee_contracts` table (id generate_id('ect'), organization_id FK CASCADE, employee_id FK CASCADE, onboarding_form_id FK SET NULL, form_snapshot JSONB, field_values JSONB, status ENUM DEFAULT 'draft', signed_at, signed_by TEXT, signer_ip TEXT, document_hash TEXT, signature_path TEXT, pdf_path TEXT, created_at, updated_at), indexes (organization_id, employee_id, onboarding_form_id, status), RLS (SELECT: is_admin_or_owner OR employee_id matches auth.uid() via employees lookup; INSERT/UPDATE/DELETE: is_admin_or_owner), BEFORE DELETE trigger on onboarding_forms (delete draft contracts, signed/voided preserved via FK SET NULL)
- [x] Apply migration locally (supabase db push --local)
- [x] Run database lint
- [x] Regenerate TypeScript types
- [x] Verify TypeScript compilation

---

## Plane IDs (populated by /pp)

Phase A: AHR-471

- Task 1: AHR-472
- Task 2: AHR-473
- Task 3: AHR-474
- Task 4: AHR-475
- Task 5: AHR-476
