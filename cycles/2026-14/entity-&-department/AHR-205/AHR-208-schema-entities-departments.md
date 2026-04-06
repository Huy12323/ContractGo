# Schema — entities, entity_employees, departments + RLS

Work Item: [AHR-208](https://plane.jimbui.dev/aiur/browse/AHR-208/)
Tier 1: [AHR-205](https://plane.jimbui.dev/aiur/browse/AHR-205/) [v0.0.1 | Entity & Department] Entity & department management via org chart (In Progress)
Module: Entity & Department (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/627baa9a-bdeb-475a-83f5-70ef95fb830b/)
Outline Spec: https://outline.jimbui.dev/doc/93f24648-a9da-4b57-b51b-31db58d94a0f
Version Doc: https://outline.jimbui.dev/doc/0eb755a4-0002-428d-b119-09b772612683
Roadmap Feature: Entity Management (https://outline.jimbui.dev/doc/e7f99a59-2d14-4a9c-a66f-453cdc465524), Department Management (https://outline.jimbui.dev/doc/9e890394-bae6-4704-98d9-e291c9903726)

## Context (from spec)

Non-tech: Entities are operational/legal branches within an organization with localized settings. Entity employees are the leadership layer (board of directors, assistants). Departments exist under entities with recursive sub-department support.
Tech: New migration creating 3 tables: `entities` (top-level, FK to organizations), `entity_employees` (child of entities, trigger-populated org_id), `departments` (child of entities, self-referencing parent_id, trigger-populated org_id). RLS via existing `is_admin_or_owner()` helper. Existing patterns: `supabase/migrations/`, `generate_id()` function, org_admins/org_employees RLS patterns.
Related: Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — entities belong to orgs, RLS helpers defined there
Siblings: 4 active, 0 Done — AHR-208 Schema (Todo), AHR-209 Modals (Todo), AHR-210 Chart view (Todo), AHR-211 List view (Todo)
Execution Order: Step 1 of 3 — no prerequisites ✓

## Phase A: Migration — tables, triggers, RLS

- [x] Create migration file `YYYYMMDDHHMMSS_entities_departments.sql`
- [x] `entities` table: `id TEXT PRIMARY KEY DEFAULT generate_id('ent')`, `organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `timezone TEXT`, `locale TEXT`, `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`, index on organization_id
- [x] `entity_employees` table: `id TEXT PRIMARY KEY DEFAULT generate_id('ent_emp')`, `entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE`, `user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`, `organization_id TEXT DEFAULT '' NOT NULL` (trigger-populated), `created_at TIMESTAMPTZ DEFAULT now()`, unique constraint on (entity_id, user_id), indexes on entity_id, user_id, organization_id
- [x] `departments` table: `id TEXT PRIMARY KEY DEFAULT generate_id('dept')`, `entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE`, `parent_id TEXT REFERENCES departments(id) ON DELETE CASCADE` (nullable, self-referencing for sub-departments), `organization_id TEXT DEFAULT '' NOT NULL` (trigger-populated), `name TEXT NOT NULL`, `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`, indexes on entity_id, parent_id, organization_id
- [x] BEFORE INSERT trigger `set_org_id_from_entity()` for entity_employees — reads organization_id from parent entity
- [x] BEFORE INSERT trigger `set_org_id_from_entity()` reused for departments (same parent table: entities)
- [x] RLS on `entities`: SELECT/INSERT/UPDATE/DELETE using `is_admin_or_owner(organization_id)` with `TO authenticated`
- [x] RLS on `entity_employees`: SELECT/INSERT/UPDATE/DELETE using `is_admin_or_owner(organization_id)` with `TO authenticated`
- [x] RLS on `departments`: SELECT/INSERT/UPDATE/DELETE using `is_admin_or_owner(organization_id)` with `TO authenticated`

## Phase B: Apply + verify

- [x] Apply migration locally: `supabase db push --local`
- [x] Regenerate types: `pnpm db:types`
- [x] Lint: `supabase db lint --local`

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)
- Task 6: (pending)
- Task 7: (pending)
- Task 8: (pending)
- Task 9: (pending)

Phase B: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
