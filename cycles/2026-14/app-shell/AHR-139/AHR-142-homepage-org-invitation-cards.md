# Homepage with org & invitation cards

Work Item: [AHR-142](https://plane.jimbui.dev/aiur/browse/AHR-142/)
Tier 1: [AHR-139](https://plane.jimbui.dev/aiur/browse/AHR-139/) [v0.0.1 | App Shell] Homepage & navbar restructure (In Progress)
Module: App Shell (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9a60fe58-e1b1-49d9-bb12-2d2f65ca73f1/)
Outline Spec: https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22
Version Doc: https://outline.jimbui.dev/doc/4b622bb5-c198-4e36-bbc2-0406c74680fb

## Context (from spec)

Non-tech: The homepage is the first thing users see after login. Shows org cards (with create-new card) and pending invitation cards with accept/reject actions.
Tech: `routes/_protected/home/index.tsx` (stub exists), `api/queries/organizations.ts` (myOrganizations, orgInvitations queries), `components/organization/OrgSettingsModal.tsx` (AHR-144), `org_admin_invitations` table (AHR-143), `accept_admin_invitation` RPC. Ant Design Card + Row/Col grid.
Related: Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — settings modal + invitation schema consumed here
Siblings: 3 total, 1 Done (local) — AHR-140 Navbar restructure (Done, local), AHR-141 Org/view switcher (Todo), AHR-142 Homepage cards (Todo)
Execution Order: Step 2 of 2 — AHR-140 done (local) ✓, AHR-143 (cross-T1) done (local) ✓

## Phase A: Homepage route & card layout

- [x] Rewrite `/home` route stub with full implementation
- [x] Query `organizationQueries.myOrganizations()` for user's orgs
- [x] Query pending invitations for current user (by email, status=pending) — added `myInvitations()` query
- [x] "My Organizations" section: responsive card grid
- [x] First card: dashed-outline "Create Organization" card with + icon → navigates to `/setup-organization`
- [x] Org cards: org name + settings icon button (owner only), settings opens `OrgSettingsModal`
- [x] "Invitations" section: card grid, each shows org name + Accept/Reject buttons (bottom right)
- [x] Accept calls `accept_admin_invitation` RPC → invalidates queries
- [x] Reject deletes invitation row → invalidates queries
- [x] Empty states: invitations section hidden when empty

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
- Task 10: (pending)
