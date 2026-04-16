# Invitee error UX for mismatched / consumed invitations

Work Item: [AHR-688](https://plane.jimbui.dev/aiur/browse/AHR-688/)
Tier 1: [AHR-686] [v0.0.1 | Employee Onboarding] Onboarding UX fixes: approval cache + invitee error (Todo)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: When an authenticated user opens an onboarding invitation URL for a different email or a consumed invitation, the page today shows a generic "Invitation not available" message. This T2 restores the "Different account needed" UX with a Switch Account button and adds dedicated messaging for already-accepted, expired, and revoked states, while still hiding truly invalid tokens behind the generic message.
Tech: `Page_OnboardingFiller.tsx` (current branches: loading → primary query → `!invitation` generic → email-match), `useQ_PageOnboardingFiller_InvitationByToken` (RLS-bound SELECT — invitee policy from AHR-496 requires `employee_email = auth.jwt() email AND status='sent'`, admin policy requires `is_admin_or_owner(organization_id)`), `onboarding_invitations_status_enum` (`sent | accepted | expired | revoked`). New: SECURITY DEFINER RPC `get_invitation_preview(p_token)` returning `(employee_email, organization_name, status)`, new fallback query hook, status-driven branching in the page.
Related: Employee Management (https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) — approved contracts create employees + department junction rows; the invitee error cards sit adjacent to but do not modify that flow.
Siblings: 2 total, 0 Done — AHR-687 Contract approval refreshes department cache (Planned local — 1-line fix applied but no plan file)
Execution Order: Step 2 of 2 — AHR-687 code fix applied ✓ (plan file + /pp push pending)

## Phase A: Backend RPC

- [x] Create migration `supabase/migrations/<ts>_ahr688_get_invitation_preview_rpc.sql` — `CREATE FUNCTION public.get_invitation_preview(p_token TEXT) RETURNS TABLE(employee_email TEXT, organization_name TEXT, status public.onboarding_invitations_status_enum) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT i.employee_email, o.name, i.status FROM public.onboarding_invitations i JOIN public.organizations o ON o.id = i.organization_id WHERE i.invitation_token = p_token LIMIT 1; $$;` followed by `GRANT EXECUTE ON FUNCTION public.get_invitation_preview(TEXT) TO authenticated;`. Apply via `supabase db push --local`, run `supabase db lint --local`, regenerate types via `pnpm sb:dev:types`, verify `Database["public"]["Functions"]["get_invitation_preview"]` appears in `src/types/database.types.ts`

## Phase B: Preview query hook

- [x] Create `src/hooks/useQ_PageOnboardingFiller_InvitationPreview.ts` — `fetchInvitationPreview(token)` runs `supabase.rpc("get_invitation_preview", { p_token: token })` with `sb_FunctionsGetInvitationPreview_Rpc` naming, returns `data?.[0] ?? null` (RPC returns a single-row array). Hook signature `useQ_PageOnboardingFiller_InvitationPreview({ invitationToken, enabled })` — exposes an `enabled` param so the page can gate it on the primary query's null result. `queryKey: [...QueryKeys.onboardingInvitations.all(), "preview", invitationToken]`. Returns `{ query, preview }` where `preview` is `{ employee_email, organization_name, status } | null`. Add `QueryKeys.onboardingInvitations.preview(token)` factory in `src/utils/query/queryKeys.ts` if it simplifies the call site

## Phase C: Page branching + new error cards

- [x] In `Page_OnboardingFiller.tsx`, instantiate the preview hook with `enabled: !qInvitation.query.isLoading && !qMe.query.isLoading && !invitation`. Combine loading gate so the page renders `<Spin>` until both the primary query and (when triggered) the preview query settle. Remove the existing `if (!invitation)` early return
- [x] Add a status-driven switch block when `!invitation`: preview is still loading → render the loading spinner; preview returns null → render the existing "Invitation not available" card; preview returns with `status='sent'` → render the existing "Different account needed" card passing `preview.employee_email` (update the card's `invitation.employee_email` reference to come from whichever source is populated — introduce a local `invitationEmail` variable resolved from `invitation ?? preview`); preview returns with `status='accepted'` → render new "Already accepted" card; preview returns with `status='expired'` or `status='revoked'` → render new "No longer available" card
- [x] Build two new `CenteredMessage`-based error cards inline (no new files — keep in `Page_OnboardingFiller.tsx`): "Already accepted" uses `CheckCircleOutlined` with `token.colorSuccess` and copy "This invitation has already been accepted. If you believe this is an error, contact your admin."; "No longer available" uses `ClockCircleOutlined` with `token.colorWarning` and copy "This invitation is no longer valid (expired or revoked). Contact your admin to request a new invitation." Both cards include a single "Go to Home" button that navigates to `/`

---

## Plane IDs (populated by /pp)

Phase A: AHR-689

- Task 1: AHR-690

Phase B: AHR-691

- Task 1: AHR-692

Phase C: AHR-693

- Task 1: AHR-694
- Task 2: AHR-695
- Task 3: AHR-696
