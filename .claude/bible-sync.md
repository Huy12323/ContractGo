# Bible Sync

Bible: git@github.com:aiursoftware/bible.git
Last synced: a004ffdbd3fc5f9deaa2356cda07641ca4a2fab9
Synced on: 2026-04-02
Consumer type: standard

## Tracked Files

| File | Status | Notes |
|------|--------|-------|
| .claude/commands/pm.md | synced | |
| .claude/commands/p.md | synced | |
| .claude/commands/s.md | synced | |
| .claude/commands/pp.md | synced | |
| .claude/commands/rp.md | synced | |
| .claude/commands/triage.md | synced | |
| .claude/commands/gitpush.md | synced | |
| .claude/commands/load-skills.md | synced | |
| .claude/commands/bible-sync.md | synced | |
| .claude/skills/po/SKILL.md | diverged | Filled with project-specific constants (workspace, project IDs, states, estimates, Outline doc IDs) |
| scripts/config-get.js | synced | |
| scripts/lib/config.js | synced | |
| scripts/lib/plane-parse-id.js | synced | |
| scripts/lib/plane-api.js | synced | |
| scripts/plane-cycle-items.js | synced | |
| scripts/plane-work-items.js | synced | |
| scripts/plane-item-get.js | synced | |
| scripts/plane-item-update.js | synced | |
| scripts/plane-item-create.js | synced | |
| scripts/plane-latest-version.js | synced | |
| scripts/plane-intake-get.js | synced | |
| scripts/plane-intake-update.js | synced | |
| scripts/plane-intake-handling.js | synced | |
| scripts/outline-pull.js | synced | |
| scripts/outline-push.js | synced | |
| scripts/outline-upload.js | synced | |
| docs/pm.md | synced | |
| docs/pm-workflow-guide.html | skipped | Not present in Bible either |
| config.json | diverged | Filled with project-specific workspace/project UUIDs, states, estimates |
| .env.example | diverged | Expanded with environment sections (SHARED, dev/stag/prod targets) |

## Skills

| Skill | Category | Status | Notes |
|-------|----------|--------|-------|
| bible-react-naming | react | adopted | Onboarded: prefix=App_, alias=@/ |
| bible-react-provider-context | react | adopted | |
| bible-react-code-style | react | adopted | |
| bible-react-hotkeys | react | skipped | No react-hotkeys-hook dependency, not needed for HR app |
| bible-antd-components | antd-v6 | adopted | |
| bible-tanstack-query-mutation | tanstack | adopted | Onboarded: cache=manual |
| bible-tanstack-store | tanstack | adopted | |
| bible-tanstack-router | tanstack | adopted | |
| bible-supabase-schema | supabase | adopted | Onboarded: PK=generate_id, tenant_key=organization_id |
| bible-supabase-rls-policies | supabase | adopted | Onboarded: tenant_key=organization_id, delete=org-member |
| bible-supabase-migrations | supabase | adopted | Onboarded: hard deletes, types=packages/shared |
| bible-supabase-edge-functions | supabase | adopted | |
| bible-supabase-cli | supabase | adopted | Onboarded: supabase_dir=root, project_id=worldcraft |
| bible-supabase-auth | supabase | adopted | Onboarded: tenant_key=organization_id, auth=email/password |
| bible-supabase-sdk | supabase | adopted | |
| bible-supabase-options | supabase | adopted | |
| bible-env-variables | env | adopted | Onboarded: jet-env |
| bible-project-structure | project | adopted | Onboarded: app_folder=apps/web |
| bible-skill-extension | meta | adopted | |
