# Invitation schema & email flow

Work Item: [AHR-143](https://plane.jimbui.dev/aiur/browse/AHR-143/)
Tier 1: [AHR-138](https://plane.jimbui.dev/aiur/browse/AHR-138/) [v0.0.1 | Organization] Admin invitation & org settings (Todo)
Module: Organization (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/5c3d6f90-53ab-42b6-9f63-9c309cbbab71/)
Outline Spec: https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9
Version Doc: https://outline.jimbui.dev/doc/0b7d604a-cbb2-4ed5-ba3d-29f2dab23c2a
Roadmap Feature: [Admin Invitation Flow](https://outline.jimbui.dev/doc/998a09f8-0eb6-44f5-8146-87832cfd5b95)

## Context (from spec)

Non-tech: Organization owners can invite admins by email. The invitee receives an email with a link. Clicking the link takes them to the app where they can accept (becoming an admin immediately) or the invitation shows as a card on the homepage.
Tech: `supabase/migrations/` (new table), `supabase/functions/` (only hello stub exists), `supabase/functions/.env` (RESEND_API_KEY already configured), Resend SMTP already set up for auth emails. Existing tables: `organizations` (owner_id), `org_admins` (user_id, organization_id). Deno runtime for Edge Functions.
Related: App Shell (https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) — homepage invitation cards (AHR-142) consume this table, invitation page under _auth layout
Siblings: 2 total, 0 Done — AHR-143 Invitation schema & email (Todo), AHR-144 Org settings panel (Todo)
Execution Order: Step 1 of 2 — no prerequisites ✓

## Phase A: Schema & RPCs

- [x] Create migration `supabase/migrations/20260402010000_org_admin_invitations.sql`
- [x] Create `org_admin_invitations` table (id uuid PK, organization_id FK organizations, email text, token uuid unique default gen_random_uuid(), status text CHECK pending/accepted/rejected, invited_by uuid FK profiles, expires_at timestamptz, created_at timestamptz default now())
- [x] RLS policies: owner can read/delete invitations for their org, authenticated user can read invitations matching their email
- [x] Indexes on (organization_id, email) and (token)
- [x] RPC `get_invitation_by_token(invitation_token uuid)` — security definer, returns org name + email + status + expires_at (no auth required, used by invitation page)
- [x] RPC `accept_admin_invitation(invitation_token uuid)` — security definer, validates token/email/expiry → inserts into org_admins, updates status to accepted
- [x] Add table to supabase_realtime publication
- [x] Run `pnpm db:types` to regenerate types

## Phase B: Edge Function — send invitation email

- [x] Create `supabase/functions/send-admin-invitation/index.ts` (Deno runtime)
- [x] Validate request: requires auth (Bearer token), caller must be org owner (check organizations.owner_id via service_role)
- [x] Create/upsert invitation row (new token + 7-day expiry; upsert on org_id+email for duplicate handling)
- [x] Send email via Resend API (`POST https://api.resend.com/emails`) with invitation link `{APP_URL}/invitation?token={token}`, from `RESEND_SENDER_EMAIL`/`RESEND_SENDER_NAME`
- [x] Return invitation ID + status

## Phase C: Invitation page & accept flow

- [x] Create `routes/_auth/invitation.tsx` — reads `token` from search params
- [x] Page calls `get_invitation_by_token` RPC to show org name
- [x] If token invalid/expired → show error state
- [x] If user not authenticated → show "Sign in to accept" button → redirect to `/login?redirect=/invitation?token={token}`
- [x] If authenticated + email matches → show "Accept" button → calls `accept_admin_invitation` RPC → navigates to `/home`
- [x] If authenticated but email mismatch → show "Wrong account" message

---

## Plane IDs (populated by /pp)

Phase A: AHR-145

- Task 1: AHR-146
- Task 2: AHR-147
- Task 3: AHR-148
- Task 4: AHR-149
- Task 5: AHR-150
- Task 6: AHR-151
- Task 7: AHR-152
- Task 8: AHR-153

Phase B: AHR-154

- Task 1: AHR-155
- Task 2: AHR-156
- Task 3: AHR-157
- Task 4: AHR-158
- Task 5: AHR-159

Phase C: AHR-160

- Task 1: AHR-161
- Task 2: AHR-162
- Task 3: AHR-163
- Task 4: AHR-164
- Task 5: AHR-165
- Task 6: AHR-166
