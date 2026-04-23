# Schema — invitation enum + comments + mandatory fields + nullable entity

Work Item: [AHR-1173](https://plane.jimbui.dev/aiur/browse/AHR-1173/)
Tier 1: [AHR-1165](https://plane.jimbui.dev/aiur/browse/AHR-1165/) [v0.0.1 | Employee Onboarding] Onboarding flow rework — HR-first fill, comment loop, pending_placement, mandatory fields (Todo)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: (spec doc — resolve via Specifications/)
Version Doc: [Outline](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff)

## Context (from spec)

Non-tech: Schema foundation for the onboarding flow rework — adds `pending_placement` invitation state (HR approves content, not yet placed), makes entity-on-invitation optional (entity is picked at placement now), moves HR's review-loop comments onto the invitation as JSONB, and adds template-level mandatory field keys. Signature-clearing "send back" reuses existing `sent` state (no separate `needs_changes`).

Tech: `onboarding_invitations` (enum add, entity_id nullable, new `hr_comments` JSONB), `contract_templates` (new `mandatory_field_keys` JSONB). Existing invitation realtime trigger (AHR-847) carries comment-update events. No new table, no new RLS.

Related: `contracts` (filler UX for AHR-1177 branches on "does invitation have hr_comments?" not a status flag), `contract_templates` (Field Composer gains mandatory checkbox in AHR-1176).

Siblings: 7 total, 0 Done — AHR-1174, AHR-1175, AHR-1176, AHR-1177, AHR-1178, AHR-1179 all Todo.

Execution Order: Step 1 of 6 — foundation, no prerequisites. All downstream T2s depend on this schema.

## Decisions recorded (reversals from T1 planning)

- **No `needs_changes` on `contracts_status_enum`.** "Send back" reuses `sent` state + clears signature. Filler-page "is this a revision?" signal is "does invitation have `hr_comments` rows?" HR list does not distinguish sent-back from fresh-sent — acceptable per product.
- **Mandatory field keys live on `contract_templates`, not `onboarding_invitations`.** Per-template, set at template creation (Field Composer). AHR-1176 scope shifts from pre-fill step to template builder.
- **`hr_comments` is JSONB on `onboarding_invitations`, not a new `contract_hr_comments` table.** Trade-offs: no cascade on author deletion (orphan UUIDs OK for v0.0.1), no pagination, whole-array rewrites. Acceptable for low comment volume in v0.0.1.
- **Comments are append-only.** No per-comment edit UX. No `updated_at` on comment objects. Corrections via new comment.

## Phase A: Add `pending_placement` enum value

- [x] Create migration `YYYYMMDDHHMMSS_ahr1173_add_pending_placement_enum.sql`
  - `ALTER TYPE public.onboarding_invitations_status_enum ADD VALUE 'pending_placement';`
  - Single-statement migration — ensures new value is committed before any downstream migration or code references it.

## Phase B: Column changes on invitations + templates

- [x] Create migration `YYYYMMDDHHMMSS_ahr1173_invitations_nullable_entity.sql`
  - `ALTER TABLE public.onboarding_invitations ALTER COLUMN entity_id DROP NOT NULL;`
  - No backfill — v0.0.1, no production data.

- [x] Create migration `YYYYMMDDHHMMSS_ahr1173_invitations_add_hr_comments.sql`
  - `ALTER TABLE public.onboarding_invitations ADD COLUMN hr_comments JSONB NOT NULL DEFAULT '[]'::jsonb;`
  - No RLS changes — existing invitation RLS covers read (admin_or_owner + invitee email match) and write (admin_or_owner).
  - No realtime changes — existing `trg_notify_realtime_onboarding_invitations` emits on any UPDATE, including comment-add.
  - Comment shape (enforced in TS, not DB): `{ id: string; author_id: string; body: string; created_at: string }[]` — append-only, no `updated_at`.

- [x] Create migration `YYYYMMDDHHMMSS_ahr1173_templates_add_mandatory_fields.sql`
  - `ALTER TABLE public.contract_templates ADD COLUMN mandatory_field_keys JSONB NOT NULL DEFAULT '[]'::jsonb;`
  - Stores array of field key strings from template layout.
  - No RLS or realtime changes — existing contract_templates wiring carries it.

## Phase C: Typed JSONB overrides

- [x] `frontend/vite/src/types/invitation.types.ts` (new)
  - `export type OnboardingInvitation_HrComment = { id: string; author_id: string; body: string; created_at: string }`
  - `export type OnboardingInvitation_HrComments = OnboardingInvitation_HrComment[]`

- [x] `frontend/vite/src/types/database.override.types.ts`
  - Add override: `onboarding_invitations.hr_comments: OnboardingInvitation_HrComments` (Row/Insert/Update shape via MergeDeep).
  - Add override: `contract_templates.mandatory_field_keys: string[]` (field keys from template layout, Row/Insert/Update).

## Phase D: Apply + regenerate + verify

- [x] `supabase db push --local` — apply all four migrations (order: A, then three in B).
- [x] `pnpm sb:dev:types` — regenerate `database.types.ts`. Expect `entity_id: string | null` on onboarding_invitations Row, `hr_comments: Json` + `mandatory_field_keys: Json` (both overridden via `database.override.types.ts` in Phase C).
- [x] `supabase db lint --local` — no new warnings.
- [x] `pnpm tsc --noEmit` (frontend/vite) — clean compile. Per consumer audit (2026-04-20), all existing `entity_id` / `entities` readers are already null-safe; no fixes needed.

---

## Plane IDs (populated by /pp)

Phase A: AHR-1433
- Add `pending_placement` enum value: AHR-1434

Phase B: AHR-1435
- Invitations: nullable entity_id: AHR-1436
- Invitations: add hr_comments JSONB: AHR-1437
- Templates: add mandatory_field_keys JSONB: AHR-1438

Phase C: AHR-1439
- Typed JSONB overrides (invitation.types.ts + database.override.types.ts): AHR-1440

Phase D: AHR-1441
- Apply + regenerate types + lint + tsc --noEmit: AHR-1442
