# [v0.0.1 | Database] Schema audit remediation > Drop currencies table, replace with local constants

Work Item: [AHR-320](https://plane.jimbui.dev/aiur/browse/AHR-320/)
Tier 1: [AHR-314] [v0.0.1 | Database] Schema audit remediation (Todo)
Module: [Database](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/627baa9a-bdeb-475a-83f5-70ef95fb830b/)
Outline Spec: (none — T1 created from schema audit, no /pm flow)
Version Doc: (none)

## Context (from spec)

Non-tech: Drop the currencies reference table. Currency data becomes local TypeScript constants — no DB round-trip, no RLS overhead.
Tech: `public.currencies` table (code PK + display_name), RLS policy `authenticated_can_view_currencies`, hook `useQ_Tables_Currencies`, component `App_CurrencySelect`, query keys entry. New: `src/consts/const_CurrenciesOptions.ts`.
Related: None — currencies is self-contained, no FK dependencies from other tables.
Siblings: 6 total, 0 Done — [AHR-321 Drop RBAC (Todo), AHR-322 Drop identifier col (Todo), AHR-323 Rename org_ tables (Todo), AHR-324 Drop entity_employees (Todo), AHR-325 Add FK org_id (Todo)]
Execution Order: Step 1 of 3 — no prerequisites ✓

## Phase A: Database migration

- [x] Create migration `20260406152420_drop_currencies_table.sql` — DROP POLICY + DROP TABLE
- [x] Apply migration locally (`pnpm sb:dev:push`)
- [x] Regenerate types (`pnpm sb:dev:types`)

## Phase B: Frontend cleanup

- [x] Create `src/consts/const_CurrenciesOptions.ts` — 20 currencies with local union type + `Utils_Options_EnumsToOptions`
- [x] Delete `src/components/App_CurrencySelect/` directory (component has zero imports)
- [x] Delete `src/hooks/useQ_Tables_Currencies.ts`
- [x] Remove `currencies` entry from `src/utils/query/queryKeys.ts`
- [x] Verify app compiles — no broken imports (3 pre-existing router errors, zero currency-related)

---

## Plane IDs (populated by /pp)

Phase A: AHR-326

- Task 1: AHR-328
- Task 2: AHR-330
- Task 3: AHR-332

Phase B: AHR-333

- Task 1: AHR-334
- Task 2: AHR-335
- Task 3: AHR-336
- Task 4: AHR-337
- Task 5: AHR-338
