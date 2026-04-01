# Resend SMTP email configuration

Work Item: [AHR-71](https://plane.jimbui.dev/aiur/browse/AHR-71/)
Tier 1: [AHR-8] [v0.1.0 | Infrastructure] Supabase Self-Hosted Setup (Todo)
Module: Infrastructure (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/5241f682-b120-45d1-8d43-67cc5b13b0fa/)
Outline Spec: https://outline.jimbui.dev/doc/9fcfc1d6-ab82-4c88-b9ae-ce70a8dfbd15
Version Doc: https://outline.jimbui.dev/doc/77662576-cdbc-4d2e-9524-91b69d3bf0fc
Roadmap Feature: Supabase Self-Hosted Setup (https://outline.jimbui.dev/doc/0d76ece3-7275-4a79-89f6-105f356c3ddb)

## Context (from spec)

Non-tech: Configure Resend as the email provider for Supabase Auth emails (verification, password reset). Replaces Mailpit for both local dev and production.
Tech: `supabase/config.toml` (SMTP + inbucket sections), `.env.dev` (shared vars + SUPABASE_CONFIG section), `scripts/env-apply.js` (distributes to `supabase/.env`), `.env.example`
Related: Auth (https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098) — auth email flows (verification, password reset) depend on working SMTP
Siblings: 3 total, 0 Done — [AHR-71 Resend SMTP (Todo), AHR-72 Production hardening (Todo), AHR-73 Storage bucket (Todo)]
Execution Order: Step 1 of 2 — no prerequisites ✓

## Design Reference

Lightcraft `config.toml`:
```toml
[auth.email.smtp]
enabled = true
host = "smtp.resend.com"
port = 587
user = "resend"
pass = "env(RESEND_API_KEY)"
admin_email = "env(RESEND_SENDER_EMAIL)"
sender_name = "env(RESEND_SENDER_NAME)"
```
Lightcraft disables inbucket (`enabled = false`) and always uses Resend.

## Phase A: Configure Resend SMTP + update env-apply

- [x] Add `RESEND_SENDER_EMAIL=noreply@e.aiursoftware.com` and `RESEND_SENDER_NAME=AIUR HR` to `.env.dev` shared vars
- [x] Add `RESEND_SENDER_EMAIL` and `RESEND_SENDER_NAME` to `[SUPABASE_CONFIG]` section in `.env.dev` (as `${RESEND_SENDER_EMAIL}` and `${RESEND_SENDER_NAME}` refs)
- [x] Update `.env.example` with the new vars (empty values in shared, refs in SUPABASE_CONFIG)
- [x] Add `[auth.email.smtp]` section to `supabase/config.toml`: enabled true, host `smtp.resend.com`, port 587, user `resend`, pass `env(RESEND_API_KEY)`, admin_email `env(RESEND_SENDER_EMAIL)`, sender_name `env(RESEND_SENDER_NAME)`
- [x] Disable inbucket in `config.toml`: set `enabled = false`
- [x] Run `pnpm env:apply dev` to distribute new vars to `supabase/.env`

---

## Plane IDs (populated by /pp)

Phase A: AHR-74
- Task 1: AHR-75
- Task 2: AHR-76
- Task 3: AHR-77
- Task 4: AHR-78
- Task 5: AHR-79
- Task 6: AHR-80
