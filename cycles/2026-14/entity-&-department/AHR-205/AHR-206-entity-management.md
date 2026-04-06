# Entity management in org settings

Work Item: [AHR-206](https://plane.jimbui.dev/aiur/browse/AHR-206/)
Tier 1: [AHR-205](https://plane.jimbui.dev/aiur/browse/AHR-205/) [v0.0.1 | Entity & Department] Entity & department management in org settings (Todo)
Module: Entity & Department (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/627baa9a-bdeb-475a-83f5-70ef95fb830b/)
Outline Spec: https://outline.jimbui.dev/doc/93f24648-a9da-4b57-b51b-31db58d94a0f
Version Doc: https://outline.jimbui.dev/doc/0eb755a4-0002-428d-b119-09b772612683
Roadmap Feature: Entity Management (https://outline.jimbui.dev/doc/e7f99a59-2d14-4a9c-a66f-453cdc465524)

## Context (from spec)

Non-tech: Entities are top-level operational/legal units within an organization (e.g., US branch, VN branch) with localized settings (timezone, locale). Managed from a new "Entities" tab in the Org Settings Modal, with a settings icon per entity opening a dedicated Entity Settings Modal.
Tech: `components/organization/App_OrgSettingsModal.tsx` (add Entities tab with entity list), new `components/organization/App_EntitySettingsModal.tsx` (General + Danger Zone tabs), new `entities` table (FK to organizations, name/timezone/locale), RLS via `is_admin_or_owner()`, new query/mutation hooks. Existing patterns: `useQ_Tables_OrgAdmins`, `useM_OrgSettings_*`, `QueryKeys` factory.
Related: Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — parent module, entities belong to orgs. Employee Onboarding — departments (AHR-207) will be onboarding target.
Siblings: 2 total, 0 Done — AHR-206 Entity management (Todo), AHR-207 Department management (Todo)
Execution Order: Step 1 of 2 — no prerequisites

## Phase A: Database schema — entities table + RLS

- [ ] Create migration: `entities` table with `id TEXT PRIMARY KEY DEFAULT generate_id('ent')`, `organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `timezone TEXT`, `locale TEXT`, `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`, index on organization_id
- [ ] RLS policies using `is_admin_or_owner(organization_id)` for SELECT/INSERT/UPDATE/DELETE (admin/owner only)
- [ ] Apply migration locally (`supabase db push --local`) + regenerate types (`pnpm db:types`)

## Phase B: Query & mutation hooks

- [ ] Add `entities` key to `QueryKeys` factory (all, list, mine, record)
- [ ] Create `useQ_Tables_OrgEntities` — list entities by organizationId
- [ ] Create `useM_OrgSettings_EntityCreate` — insert entity with name + timezone + locale
- [ ] Create `useM_OrgSettings_EntityUpdate` — update entity fields (name, timezone, locale)
- [ ] Create `useM_OrgSettings_EntityDelete` — delete entity by id

## Phase C: Entities tab in OrgSettingsModal

- [ ] Add "Entities" tab to `App_OrgSettingsModal` (between General and Danger Zone)
- [ ] Entity list using ANTD Table or List — columns: name, timezone, locale, settings icon button
- [ ] "Add Entity" button at top → inline form or small modal (name + timezone + locale fields)
- [ ] Settings icon per entity row → opens `App_EntitySettingsModal`
- [ ] Empty state when no entities

## Phase D: Entity Settings Modal

- [ ] Create `App_EntitySettingsModal` component — left-side tabs mirroring OrgSettingsModal pattern
- [ ] "General" tab: edit form for name, timezone, locale with save button
- [ ] "Danger Zone" tab: delete entity with name-confirmation input (same pattern as org delete)

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)

Phase B: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)

Phase C: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)

Phase D: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
