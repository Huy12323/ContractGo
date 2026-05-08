# Dynamic columns org-to-entity migration

> Version: [Outline](https://outline.jimbui.dev/doc/e4768e32-72fc-4539-9d38-9d5547160291) | Tier 1: [AHR-1966](https://plane.jimbui.dev/aiur/browse/AHR-1966/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- Dynamic column tables migrate from org-scoped (`org_<orgid>__employees`) to entity-scoped (`ent_<entityid>__employees`)
- `employee_columns` table: scope changes from `organization_id` to `entity_id`
- `employee_column_choices` table: scope changes from `organization_id` to `entity_id`
- `employee_views` table: scope changes from `organization_id` to `entity_id`
- Provisioning lifecycle moves from organizations to entities
- All FE hooks and components updated to use entity-scoped tables
- Employees page gets entity selector for viewing entity-specific dynamic columns

## Scope boundaries

- Only the dynamic columns system changes scope — `employees` table already has `entity_id` from AHR-1967
- No new column types or field features — pure scope migration
- Universal fields (__full_name, first_name, last_name, email, birthday) remain on `employees` table, unaffected

## Decisions

- **Decision:** `employee_columns`, `employee_column_choices`, `employee_views` keep `organization_id` for RLS (trigger-populated), add `entity_id` as the logical scope
  **Rationale:** Child table pattern — RLS uses `organization_id` for single-hop checks. Entity_id is the scoping FK, org_id is the RLS column.
- **Decision:** Per-org dynamic table data migrates to the org's first entity (same entity employees were backfilled to in AHR-1967). Additional entities start with empty column sets.
  **Rationale:** Consistent with employee backfill strategy. Admins define new columns per entity as needed.
- **Decision:** Employees page gets an entity selector — view one entity's employees at a time
  **Rationale:** Entity-scoped dynamic columns mean different entities have different `col_*` fields. Can't mix entities in one grid (column mismatch). Entity selector is the natural fit.
- **Decision:** Hook files kept original names (`useQ_Tables_OrgEmployees`, `useQ_Tables_OrgEmployeeViews`) despite accepting `entityId` params
  **Rationale:** Avoids breaking import paths across many consumers; internal params are entity-scoped, filename is cosmetic

## Implementation

### Phase A — Migration: metadata tables (employee_columns, employee_column_choices, employee_views)

Add `entity_id` to the three metadata tables. Keep `organization_id` for RLS via trigger-populated child table pattern.

- [x] Add `entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE` (nullable) to `employee_columns`
- [x] Backfill `employee_columns.entity_id` from org's first entity: `UPDATE employee_columns SET entity_id = (SELECT id FROM entities WHERE organization_id = employee_columns.organization_id ORDER BY created_at LIMIT 1)`
- [x] `ALTER COLUMN entity_id SET NOT NULL` on `employee_columns`
- [x] Add index `idx_employee_columns_entity_id`
- [x] Change `employee_columns.organization_id` to `DEFAULT ''` (child table pattern)
- [x] Create BEFORE INSERT trigger on `employee_columns` calling `set_org_id_from_entity()`
- [x] Add `entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE` (nullable) to `employee_column_choices`
- [x] Backfill `employee_column_choices.entity_id` from parent: `UPDATE employee_column_choices SET entity_id = (SELECT entity_id FROM employee_columns WHERE id = employee_column_choices.employee_column_id)`
- [x] `ALTER COLUMN entity_id SET NOT NULL` on `employee_column_choices`
- [x] Update the existing `set_org_id_from_employee_column` trigger to also populate `entity_id` from parent `employee_columns.entity_id`
- [x] Add `entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE` (nullable) to `employee_views`
- [x] Backfill `employee_views.entity_id` from org's first entity (same pattern as employee_columns)
- [x] `ALTER COLUMN entity_id SET NOT NULL` on `employee_views`
- [x] Add index `idx_employee_views_entity_id`
- [x] Change `employee_views.organization_id` to `DEFAULT ''`, add BEFORE INSERT trigger calling `set_org_id_from_entity()`

### Phase B — Migration: dynamic tables (per-org → per-entity)

Replace the provisioning system. Create new entity-scoped tables, migrate data, drop old org-scoped tables.

- [x] Create `provision_entity_employees_table(p_entity_id TEXT)` — validates `'^ent_[A-Za-z0-9]+$'`, creates `<entity_id>__employees` table with PK FK to employees, RLS (is_org_member/is_admin_or_owner with org_id looked up from entity), audit trigger
- [x] Create entity lifecycle triggers: AFTER INSERT on `entities` → provision; AFTER DELETE on `entities` → drop
- [x] Provision new per-entity tables for all existing entities (DO block)
- [x] Migrate data: for each org, copy all rows + `col_*` columns from `org_<orgid>__employees` into the first entity's `ent_<entityid>__employees`. Use dynamic SQL to handle varying col_* column sets
- [x] Migrate `col_*` column definitions: for each `employee_columns` row, call `add_employee_column` equivalent on the entity table to create the physical column before copying data
- [x] Drop all `org_<orgid>__employees` tables (DO block iterating organizations)
- [x] Drop old org lifecycle triggers: `trigger_provision_org_employees` + `trigger_drop_org_employees`
- [x] Drop old functions: `provision_org_employees_table()`, `tg_provision_org_employees_on_org_insert()`, `tg_drop_org_employees_on_org_delete()`
- [x] Update `add_employee_column(p_organization_id, p_col_name, p_col_type)` → `add_employee_column(p_entity_id, p_col_name, p_col_type)` — validate `'^ent_'`, target `ent_<id>__employees`, auth check via entity's org
- [x] Update `drop_employee_physical_column()` trigger — use `OLD.entity_id` instead of `OLD.organization_id` for table name resolution
- [x] Update `audit_employees_perorg()` — accept entity_id, resolve org_id from entity for audit log insertion

### Phase C — FE updates: types, hooks, components

Update all frontend references from org-scoped to entity-scoped dynamic tables.

- [x] `employeeTable.types.ts`: rename `orgEmployeesTable(organizationId)` → `entityEmployeesTable(entityId)`, update comment
- [x] `queryKeys.ts`: update `StaticTableName` exclusion from `org_${string}__employees` to `ent_${string}__employees`
- [x] Rename `useQ_Tables_OrgEmployees` → `useQ_Tables_EntityEmployees` — accept `entityId` param, query `ent_<entityId>__employees` table, join universal employee data + entity data
- [x] `useM_Employee_Update`: change `organizationId` param to `entityId`, use `entityEmployeesTable(entityId)` for dynamic table lookup
- [x] Update `useQ_Tables_EmployeeColumns` — scope by `entity_id` instead of `organization_id`
- [x] Update `useQ_Tables_EmployeeViews` or equivalent — scope by `entity_id`
- [x] Update Employees page (`Page_Employees`) — add entity selector dropdown at top, pass selected `entityId` to all hooks
- [x] Update all components consuming employee column/view hooks to pass `entityId`
- [x] Update `useM_Employee_Update` consumers to pass `entityId` instead of `organizationId`
- [x] Regenerate types: `pnpm sb:dev:types`
- [x] `tsc --noEmit` passes

## Context

_Stripped at /pp push time._

Non-tech: Different entities (offices/branches) need different custom fields — a US entity needs SSN fields, a Vietnam entity needs CCCD. Dynamic column tables move from one-per-org to one-per-entity so each entity defines its own field set independently.
Tech: Core provisioning in `20260428102105_ahr1947_org_employees_factory.sql`. RPC in `20260428104401_ahr1948_perorg_field_add_remove.sql`. Audit in `20260428093216_ahr1946_create_employee_audit_log.sql`. FE: `employeeTable.types.ts`, `useQ_Tables_OrgEmployees`, `useM_Employee_Update`, `useQ_Tables_EmployeeColumns`, `Page_Employees`. Pattern validation: `'^org_[A-Za-z0-9]+$'` → `'^ent_[A-Za-z0-9]+$'`.
Related: [Employee Management](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) - dynamic columns are core to the employee data model
Siblings: 3 total, 1 Done — [AHR-1967 Employees entity_id (Done, local), AHR-1969 Onboarding entity selection (Todo)]
Execution Order: Step 2 of 2 (parallel with AHR-1969) — AHR-1967 done ✓
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
