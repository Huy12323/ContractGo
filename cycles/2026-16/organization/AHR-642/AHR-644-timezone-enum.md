# [v0.0.1 | Organization] Entity + department schema enhancements > Timezone enum + searchable dropdown

Work Item: [AHR-644](https://plane.jimbui.dev/aiur/browse/AHR-644/)
Tier 1: [AHR-642] [v0.0.1 | Organization] Entity + department schema enhancements (Backlog)
Module: [Organization](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/5c3d6f90-53ab-42b6-9f63-9c309cbbab71/)
Outline Spec: https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9
Version Doc: https://outline.jimbui.dev/doc/91312a3a-9fbf-43d7-9f32-eadab41aab8a

## Context (from spec)

Non-tech: Entities currently store timezone as free-text. Replace with a PG enum covering all ~590 IANA timezone names for database-level validation — no country gets left without their timezone. The frontend shows a searchable dropdown with country flag emojis + GMT offsets (e.g., "🇻🇳 Asia/Ho_Chi_Minh (GMT+7)").
Tech: `entities.timezone` column (currently TEXT). Migration: CREATE TYPE `iana_timezone` with all IANA values, ALTER COLUMN to use the new type. Frontend: `const_TimezoneOptions.ts` maps each timezone to `{ value: 'Asia/Ho_Chi_Minh', label: '🇻🇳 Asia/Ho_Chi_Minh (GMT+7)' }`. `App_EntitySettingsModal.tsx` replaces the plain Input with ANTD Select (showSearch + filterOption). Follows `bible-supabase-options` pattern.
Related: [Employee Management](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) — the org chart entity cards will display the locale/timezone from this data.
Siblings: 2 total, 0 Done — [AHR-643 is_manager (Todo), AHR-644 Timezone enum (Todo) ←]
Execution Order: Step 1 of 1 — parallel with AHR-643, no prerequisites

## Phase A: Migration — create enum + convert column

- [x] Create `frontend/vite/supabase/migrations/20260413110003_ahr644_iana_timezone_enum.sql` — 419 IANA timezones + UTC as PG enum. ALTER TABLE entities converts timezone from TEXT to iana_timezone (empty strings default to UTC). Applied locally.
- [x] Types regenerated — `entities.timezone` now typed as `Database["public"]["Enums"]["iana_timezone"] | null`.

## Phase B: Frontend — options constant + searchable select

- [x] Create `frontend/vite/src/hooks/const_TimezoneOptions.ts` — 419 entries with flag emojis + GMT offsets (e.g., `🇻🇳 Asia/Ho Chi Minh (GMT+7)`). Country flags derived from IANA timezone-to-country mapping.
- [x] In `App_EntitySettingsModal.tsx` — replaced the timezone `<Input>` with `<Select showSearch optionFilterProp="label" options={[...const_TimezoneOptions]} allowClear />`. Added import. Fixed entity create/update mutation types to use `Database["public"]["Enums"]["iana_timezone"]` instead of `string`.
- [x] Type-check: `npx tsc --noEmit` clean.

---

## Plane IDs (populated by /pp)

Phase A: AHR-648

- Task 1: AHR-650
- Task 2: AHR-651

Phase B: AHR-649

- Task 1: AHR-652
- Task 2: AHR-653
- Task 3: AHR-654
