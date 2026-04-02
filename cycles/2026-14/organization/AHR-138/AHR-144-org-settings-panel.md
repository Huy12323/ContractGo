# Org settings panel with admin invite

Work Item: [AHR-144](https://plane.jimbui.dev/aiur/browse/AHR-144/)
Tier 1: [AHR-138](https://plane.jimbui.dev/aiur/browse/AHR-138/) [v0.0.1 | Organization] Admin invitation & org settings (In Progress)
Module: Organization (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/5c3d6f90-53ab-42b6-9f63-9c309cbbab71/)
Outline Spec: https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9
Version Doc: https://outline.jimbui.dev/doc/0b7d604a-cbb2-4ed5-ba3d-29f2dab23c2a
Roadmap Feature: [Admin Invitation Flow](https://outline.jimbui.dev/doc/998a09f8-0eb6-44f5-8146-87832cfd5b95)

## Context (from spec)

Non-tech: Organization owners can open settings on their org card to manage admins — see current admins, see pending invitations, invite new admins by email, and cancel pending invitations.
Tech: `org_admins` table (user_id, organization_id), `org_admin_invitations` table (email, token, status, expires_at), `send-admin-invitation` Edge Function (AHR-143), `profiles` table for admin display names. Frontend: Ant Design Modal + Tabs + Table. Edge Function invoked via `supabase.functions.invoke()`.
Related: App Shell (https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) — homepage org cards (AHR-142) will render the settings button that opens this modal
Siblings: 2 total, 1 Done (local) — AHR-143 Invitation schema & email (Done, local), AHR-144 Org settings panel (Todo)
Execution Order: Step 2 of 2 — AHR-143 done (local) ✓

## Phase A: Settings modal component

- [x] Create `components/organization/OrgSettingsModal.tsx` — Ant Design Modal with vertical Tabs
- [x] First tab: "Admins"
- [x] Top of Admins tab: email input + "Send Invite" button (inline row)
- [x] Below: Ant Design Table with columns for current admins (avatar, name, email) and pending invitations (email, status badge, cancel action)
- [x] Cancel invitation button deletes the row from `org_admin_invitations`
- [x] Submit calls `send-admin-invitation` Edge Function via `supabase.functions.invoke()`
- [x] Only accessible by org owner

## Phase B: Query hooks

- [x] Add `organizationQueries.orgAdmins(orgId)` — fetches org_admins joined with profiles
- [x] Add `organizationQueries.orgInvitations(orgId)` — fetches pending org_admin_invitations
- [x] Add mutation for sending invitation (calls Edge Function, invalidates queries)

---

## Plane IDs (populated by /pp)

Phase A: AHR-167

- Task 1: AHR-168
- Task 2: AHR-169
- Task 3: AHR-170
- Task 4: AHR-171
- Task 5: AHR-172
- Task 6: AHR-173
- Task 7: AHR-174

Phase B: AHR-175

- Task 1: AHR-176
- Task 2: AHR-177
- Task 3: AHR-178
