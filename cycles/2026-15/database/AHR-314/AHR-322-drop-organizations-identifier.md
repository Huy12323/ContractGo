# [v0.0.1 | Database] Schema audit remediation > Drop organizations.identifier column

Work Item: [AHR-322](https://plane.jimbui.dev/aiur/browse/AHR-322/)
Tier 1: [AHR-314] [v0.0.1 | Database] Schema audit remediation (Todo)
Module: [Database](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/627baa9a-bdeb-475a-83f5-70ef95fb830b/)
Outline Spec: [Database](https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b)
Version Doc: N/A

## Context (from spec)

Non-tech: Remove the unused `organizations.identifier` column and its generator function — the `id` column already serves as URL identifier.
Tech: Migration in `frontend/vite/supabase/migrations/`, `get_my_member_organizations()` RPC defined in `20260402020000_convert_pks_to_generate_id.sql` (returns `identifier` in all 3 UNION branches), types auto-generated in `frontend/vite/src/types/database.types.ts`
Related: [Organization](https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — org creation auto-generated identifier on INSERT
Siblings: 6 total, 0 Done — [AHR-320 Drop currencies (Not started), AHR-321 Drop RBAC (Not started), AHR-322 Drop identifier (this), AHR-323 Rename org_ tables (Not started), AHR-324 Drop entity_employees + junction (Not started), AHR-325 Add FK on child org_id (Not started)]
Execution Order: Step 1 of 3 — no prerequisites (parallel with AHR-320, AHR-321)

## Phase A: Drop identifier infrastructure

- [x] Create migration: DROP + recreate `get_my_member_organizations()` without `identifier` in return type, DROP `generate_identifier()` function, DROP `identifier` column from `organizations`
- [x] Apply migration locally, regenerate types, verify `identifier` absent from types and no TS errors

---

## Plane IDs (populated by /pp)

Phase A: AHR-327

- Task 1: AHR-329
- Task 2: AHR-331
