# Migrate admin invitation

Work Item: [AHR-236](https://plane.jimbui.dev/aiur/browse/AHR-236/)
Tier 1: [AHR-225] [v0.0.1 | Infrastructure] Unified email delivery via Resend REST (In Progress)
Module: Infrastructure (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/6d0efac1-a915-4c1a-b2ed-62c794ef3105/)
Outline Spec: https://outline.jimbui.dev/doc/9fcfc1d6-ab82-4c88-b9ae-ce70a8dfbd15
Version Doc: https://outline.jimbui.dev/doc/f313c50a-3c78-4a0d-a527-5fc5e5683b2e

## Context (from spec)

Non-tech: Migrate the admin invitation edge function to use the centralized email service instead of calling Resend directly with inline HTML.
Tech: `supabase/functions/send-admin-invitation/index.ts` — remove direct Resend API call (lines 105-130), inline HTML, and Resend env vars. Replace with `fetch()` to `_shared_send-email` using scenario `admin_invitation`. Frontend hook `useM_OrgSettings_InvitationCreate.ts` unchanged.
Related: Auth (https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098) — auth hook (AHR-235) also consumes the email service
Siblings: 3 total, 0 Done — [AHR-234 Email service (Done local, pending /pp), AHR-235 Auth hook wiring (Not started)]
Execution Order: Step 2 of 2 — AHR-234 Done (local) ✓

## Phase A: Replace direct Resend call with email service

- [x] Remove Resend-specific env vars (RESEND_API_KEY, SENDER_EMAIL, SENDER_NAME) and inline HTML template from index.ts
- [x] Replace direct Resend API call with fetch to shared--send-email using scenario "admin_invitation"
- [x] Fix env var patterns: remove ! assertions and ?? fallbacks, use requireEnv()

---

## Plane IDs (populated by /pp)

Phase A: AHR-267

- Task 1: AHR-268
- Task 2: AHR-269
- Task 3: AHR-270
