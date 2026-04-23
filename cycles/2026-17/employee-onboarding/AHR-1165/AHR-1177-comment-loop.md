# HR comment thread + request-changes/approve-content loop

Work Item: [AHR-1177](https://plane.jimbui.dev/aiur/browse/AHR-1177/)
Tier 1: [AHR-1165](https://plane.jimbui.dev/aiur/browse/AHR-1165/) [v0.0.1 | Employee Onboarding] Onboarding flow rework (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Version Doc: [Outline](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff)

## Context (from spec)

Non-tech: HR can now review a submitted contract and either approve its content (which moves the invitation to `pending_placement`, awaiting AHR-1178's placement step) OR send it back to the employee with a comment asking for specific changes. Signature is cleared on send-back (legally stale). The employee sees HR's comment at the top of the filler, edits their previous submission, re-signs, re-submits — loop continues until HR approves content.

Tech: Two new edge fns (`approve-content`, `request-changes`), modified `submit-contract` to handle re-submit, two new hooks (`useM_Contract_ApproveContent`, `useM_Contract_RequestChanges`), updated invitation query to also include `hr_comments` JSONB + existing contract. Review modal grows a comment thread + inline composer, drops its stale Employee Details sidebar. Filler page shows HR comments read-only above the form.

Related: [AHR-1173](https://plane.jimbui.dev/aiur/browse/AHR-1173/) (schema: `hr_comments` JSONB, `pending_placement` enum value), [AHR-1175](https://plane.jimbui.dev/aiur/browse/AHR-1175/) (editable prefill + review modal reuses `App_ContractFiller` in review mode), [AHR-1178](https://plane.jimbui.dev/aiur/browse/AHR-1178/) (place-and-activate — consumes `pending_placement` state, owns Employee Details form).

Siblings: 7 total, 4 Done (local) — AHR-1173, 1174, 1175, 1176. AHR-1178 Todo, AHR-1179 Todo.

Execution Order: Step 4 of 6 — all prereqs Done ✓. AHR-1178 depends on this.

## Decisions (this session)

- **Comment author rendered as "HR"** — no per-user name lookup. Single-HR-team at v0.0.1; future enhancement.
- **Request-Changes composer inline** (not a nested modal). Expands in place of the action buttons; Send + Cancel replace them.
- **Re-submit pre-populates from existing `contract.field_values`** — employee sees what they submitted, edits from there. Starting fresh every round would be hostile UX.
- **Employee Details sidebar removed** from `App_OnboardingReviewModal` — Approve Content doesn't need them. AHR-1178 builds Place modal with its own form. Leaving them inert would confuse HR.
- **No `needs_changes` status** — Request Changes flips contract `filled → sent`, signature cleared. Employee re-submit flips back to `filled`. (Reaffirms AHR-1173 reversal.)
- **No `useQ_Tables_ContractHrComments` hook** — comments come via existing invitation query's `hr_comments` JSONB column.
- **Submit-contract upsert semantics**: invitation in `sent` (first submit) OR invitation in `accepted` + existing contract at `sent` (re-submit). Otherwise rejected.

## Phase A: Edge functions

- [x] `supabase/functions/employee-onboarding_approve-content/index.ts` (new)
  - Admin/owner gate (same pattern as send-invitation)
  - Input: `{ invitation_id: string }`
  - Load invitation → assert invitation.status === 'accepted'
  - Load contract via invitation_id → assert contract.status === 'filled'
  - Update `onboarding_invitations.status = 'pending_placement'`
  - Return `{ invitation_id, status: 'pending_placement' }`

- [x] `supabase/functions/employee-onboarding_request-changes/index.ts` (new)
  - Admin/owner gate
  - Input: `{ invitation_id: string, comment_body: string }` (trim non-empty)
  - Load invitation → assert invitation.status === 'accepted'
  - Load contract → assert contract.status === 'filled'
  - Append to `invitation.hr_comments`: `{ id: generate_id('chc'), author_id: user.id, body: trimmed, created_at: new Date().toISOString() }`. Read current array, push, UPDATE with new array.
  - Delete signature from R2: `supabase.storage.from('org-files').remove([contract.signature_path])` (best-effort — log error, don't fail the flow)
  - Update contract: `{ signed_at: null, signed_by: null, signer_ip: null, signature_path: null, status: 'sent' }`
  - Return `{ contract_id, status: 'sent' }`

- [x] `supabase/functions/employee-onboarding_submit-contract/index.ts` (modify)
  - Replace the hard `invitation.status !== 'sent'` rejection with branching:
    - First submit: invitation.status === 'sent' AND no existing contract → current INSERT path + flip invitation to `'accepted'`
    - Re-submit: invitation.status === 'accepted' AND existing contract.status === 'sent' → UPDATE existing contract (`field_values`, signature_path, signed_at, signed_by, signer_ip, status='filled'). Invitation stays `accepted`.
    - Else: reject with specific message
  - Fetch existing contract by `invitation_id` before the path decision (single query)
  - Signature upload path reuses existing logic (path includes contract.id)
  - On re-submit UPDATE failure: roll back uploaded signature (same cleanup pattern as insert path)

## Phase B: Data layer (hooks)

- [x] `useQ_PageOnboardingFiller_InvitationByToken.ts` — extend select:
  - Add `hr_comments` on `onboarding_invitations`
  - Add `contracts(id, status, field_values, prefilled_fields, signature_path)` — relation select; latest (or only) contract for this invitation

- [x] `useM_Contract_ApproveContent.ts` (new)
  - Params: `{ invitation_id: string }`
  - Invokes `employee-onboarding_approve-content` edge fn
  - onSuccess: invalidate `QueryKeys.onboarding_invitations.all()` + `QueryKeys.contracts.all()`
  - onError: surface server message via `message.error`

- [x] `useM_Contract_RequestChanges.ts` (new)
  - Params: `{ invitation_id: string, comment_body: string }`
  - Invokes `employee-onboarding_request-changes` edge fn
  - Same invalidations as above
  - onError: surface server message

## Phase C: Review modal UI (`App_OnboardingReviewModal.tsx`)

- [x] Read `invitation.hr_comments` (typed via existing `OnboardingInvitation_HrComments` from `invitation.types.ts`).
- [x] Add a comment thread block at the top of the modal body (above the `App_ContractFiller` in review mode). For each comment row:
  - Author label: static text `HR` (ANTD `Typography.Text strong`)
  - Timestamp: formatted via existing `formatRelativeTime` helper if reusable, or simple `new Date(c.created_at).toLocaleString()`
  - Body: `Typography.Paragraph` with `whiteSpace: 'pre-wrap'`
  - Card bg: subtle (`token.colorFillQuaternary`), small border-radius
  - Empty state: hide the block entirely if `hr_comments.length === 0`
- [x] Replace the right sidebar's "Employee Details + Approve" block with a new "Actions" section:
  - `Approve Content` (primary button) — calls `useM_Contract_ApproveContent.mutation.mutate({ invitation_id })`
  - `Request Changes` (secondary, default style) — when clicked, swap the two buttons for an inline composer:
    - `Input.TextArea` (autoSize, placeholder "Tell the employee what to change…")
    - `Send` (primary, disabled if empty) → calls `useM_Contract_RequestChanges.mutation.mutate({ invitation_id, comment_body })`
    - `Cancel` (text) → reverts to the two buttons, discards input
  - Both mutations: `loading` / `disabled` on the button while pending. Close modal on success.
- [x] Delete imports + state for `useM_OnboardingInvitation_Approve`, `firstName`, `lastName`, `birthday`, `DatePicker`, plus the employee-details JSX.
- [x] Keep: signature preview, signed URL fetching, modal chrome, invitation header summary.

## Phase D: Filler UI (`Page_OnboardingFiller.tsx` + `App_ContractFiller.tsx`)

- [x] `Page_OnboardingFiller.tsx`:
  - Compute `existingContract = invitation.contracts?.[0] ?? null`
  - If `existingContract && existingContract.status === 'sent'` (sent-back case): seed `fieldValues` useState initializer from `existingContract.field_values`. Still merge prefill as default via existing `mergedValues` memo.
  - If `existingContract && existingContract.status === 'filled'` or `'active'`: filler should be read-only / already submitted. Show the existing "thank you / awaiting approval" state. (Confirm existing behavior handles this or add branch.)
  - Render HR comments block above the form: when `invitation.hr_comments.length > 0`, render a card with each comment (same visual language as the review modal's thread for consistency).
- [x] `App_ContractFiller.tsx` — no new props needed for comments (comment thread lives in `Page_OnboardingFiller`, not inside the filler component). Scoping comments to the page keeps the component reusable.

## Phase E: Verify

- [x] `pnpm type-check` — clean on touched files (3 pre-existing unrelated errors remain)
- [x] Manual end-to-end:
  1. Create a template with some mandatory fields (AHR-1176 path). Save.
  2. Send invitation with prefill on some fields.
  3. Open filler as employee → fill required fields → sign → submit. Contract = `filled`, invitation = `accepted`.
  4. HR opens Review modal: sees contract + signature + the new action buttons. Comment thread is empty (no comments yet).
  5. HR clicks Request Changes → composer opens → types "Please correct the phone number" → Send. Modal closes; toast.
  6. Verify in Studio: `invitation.hr_comments` has 1 entry with author_id, body, created_at. `contract.status = 'sent'`, signature fields cleared, R2 file removed.
  7. Employee reloads filler → sees HR's comment at top. Form pre-populated with their previous values. Signature pad empty.
  8. Employee edits the phone field, re-signs, submits.
  9. Verify: `contract.status = 'filled'`, new signature present. Invitation still `accepted`. `hr_comments` still has the 1 entry.
  10. HR reopens Review: sees the comment history + can Request Changes again or Approve Content.
  11. HR clicks Approve Content → toast → modal closes.
  12. Verify: `invitation.status = 'pending_placement'`. `contract.status = 'filled'` (unchanged — placement sets `active`).
- [x] Rapid loop: HR requests changes 2-3 times, each time with a different comment. All appended; previous ones still visible; employee's signature clears each round.
- [x] Realtime check: have Studio open → HR requests changes → filler page (in another tab) should refresh and show the new comment (via existing invitation realtime trigger + query invalidation).

---

## Plane IDs (populated by /pp)

Phase A: AHR-1470
- approve-content edge fn: AHR-1471
- request-changes edge fn: AHR-1472
- submit-contract re-submit branch: AHR-1473

Phase B: AHR-1474
- InvitationByToken query hr_comments + contracts relation: AHR-1475
- useM_Contract_ApproveContent: AHR-1476
- useM_Contract_RequestChanges: AHR-1477

Phase C: AHR-1478
- Review modal comment thread + actions refactor: AHR-1480

Phase D: AHR-1479
- Filler: comment block + re-submit pre-populate: AHR-1481

Phase E: AHR-1482
- Type-check + e2e: AHR-1483
- RLS: invitee read accepted invitations (late fix): AHR-1484
- RLS: invitee receives realtime events (late fix): AHR-1485
- RLS: invitee reads contract via invitation email (late fix): AHR-1486
