# Email service with typed template system

Work Item: [AHR-234](https://plane.jimbui.dev/aiur/browse/AHR-234/)
Tier 1: [AHR-225] [v0.0.1 | Infrastructure] Unified email delivery via Resend REST (Todo)
Module: Infrastructure (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/6d0efac1-a915-4c1a-b2ed-62c794ef3105/)
Outline Spec: https://outline.jimbui.dev/doc/9fcfc1d6-ab82-4c88-b9ae-ce70a8dfbd15
Version Doc: https://outline.jimbui.dev/doc/f313c50a-3c78-4a0d-a527-5fc5e5683b2e

## Context (from spec)

Non-tech: A centralized email sending service that accepts a scenario + typed payload, renders the correct branded template, and delivers via Resend REST API.
Tech: New edge function `_shared_send-email/` with `index.ts`, `deno.json`, and `templates/` folder. Existing templates at `supabase/templates/confirmation.html` and `recovery.html` (GoTrue format). Existing inline HTML in `send-admin-invitation/index.ts`. Resend REST API (`https://api.resend.com/emails`). Env: `RESEND_API_KEY`, `RESEND_SENDER_EMAIL`, `RESEND_SENDER_NAME`.
Related: Auth (https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098) — auth hook (AHR-235) will call this service for confirmation/recovery emails
Siblings: 3 total, 0 Done — [AHR-235 Auth hook wiring (Not started), AHR-236 Migrate admin invitation (Not started)]
Execution Order: Step 1 of 2 — no prerequisites ✓

## Phase A: Scenario registry and template files

- [x] Create `supabase/functions/_shared_send-email/` directory with `deno.json` (imports: supabase)
- [x] Define scenario registry in `index.ts`: type `EmailScenario` = `auth_confirmation` | `auth_recovery` | `admin_invitation`. Each scenario maps to `{ subject: string, templateFile: string, requiredFields: string[] }`
- [x] Create `templates/auth_confirmation.html` — port from existing `supabase/templates/confirmation.html`, replace `{{ .ConfirmationURL }}` → `{{confirmationUrl}}`, `{{ .Token }}` → `{{token}}`, add `{{name}}` greeting
- [x] Create `templates/auth_recovery.html` — port from existing `supabase/templates/recovery.html`, same variable format conversion, add `{{name}}` greeting
- [x] Create `templates/admin_invitation.html` — extract from `send-admin-invitation/index.ts` inline HTML (lines 115-127), convert to `{{orgName}}` and `{{invitationLink}}` variables

## Phase B: Edge function with Resend REST delivery

- [x] Implement `index.ts` request handler: CORS preflight, parse JSON body `{ scenario, to, payload }`, validate scenario exists in registry
- [x] Implement auth check: verify `Authorization: Bearer <SERVICE_ROLE_KEY>` header matches `SUPABASE_SERVICE_ROLE_KEY` env var
- [x] Implement payload validation: check all `requiredFields` for the scenario are present in `payload`, return 400 with missing field names if not
- [x] Implement template loading: `Deno.readTextFile()` from `templates/` directory relative to `import.meta.url`
- [x] Implement variable substitution: replace all `{{key}}` in template HTML with `payload[key]` values. Also interpolate subject line (for `admin_invitation` subject with `{{orgName}}`)
- [x] Implement Resend REST API call: POST to `https://api.resend.com/emails` with `from`, `to`, `subject`, `html`. Return Resend response ID on success, error details on failure

---

## Plane IDs (populated by /pp)

Phase A: AHR-237

- Task 1: AHR-238
- Task 2: AHR-239
- Task 3: AHR-240
- Task 4: AHR-241
- Task 5: AHR-242

Phase B: AHR-243

- Task 1: AHR-244
- Task 2: AHR-245
- Task 3: AHR-246
- Task 4: AHR-247
- Task 5: AHR-248
- Task 6: AHR-249
