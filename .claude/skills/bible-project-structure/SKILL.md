---
name: bible-project-structure
description: Use when setting up a new project, understanding monorepo layout, or determining where top-level directories belong
---

# Project Structure

Monorepo root skeleton. Each skill owns its own internal paths — this skill only defines where top-level directories live.

## Standard Layout

```
repo-root/
├── .claude/                ← Claude Code config + skills
│   ├── skills/             ← Bible skills + local skills + extensions
│   ├── commands/           ← Slash commands
│   └── rules/              ← Agent rules
├── scripts/                ← Build, deploy, and utility scripts
├── docs/                   ← Documentation
├── cycles/                 ← Plan files (organized by cycle)
├── frontend/               ← Frontend workspaces
│   └── vite/               ← Vite React app
│       └── supabase/       ← Supabase config, migrations, edge functions
├── cloudflare/             ← Cloudflare Workers (if applicable)
│   └── workers/
├── backend/                ← Backend services (if applicable)
├── desktop/                ← Desktop app (if applicable)
├── pnpm-workspace.yaml     ← Workspace config
├── package.json            ← Root package.json
├── .env                    ← Environment variables (gitignored)
└── .env.example            ← Environment template (committed)
```

## Principles

### Flat Root

No project wrapper folder. Workspaces sit directly at root:

```
repo-root/frontend/vite/     ← ✅ Correct
repo-root/my-project/frontend/vite/  ← ❌ Wrong (extra nesting)
```

### Workspace Separation

Each domain gets its own top-level directory. Don't mix concerns:

```
frontend/    ← React/Vite apps only
cloudflare/  ← Workers only
backend/     ← API/server only
```

### Skills Own Their Internal Paths

This skill defines WHERE top-level directories live. Individual skills define their internal structure:

- React naming skill → `src/pages/`, `src/hooks/`, `src/stores/`
- Supabase CLI skill → where `supabase/config.toml` lives
- Edge functions skill → `supabase/functions/` layout

Don't duplicate path definitions across skills.

## pnpm Workspace Config

```yaml
# pnpm-workspace.yaml
packages:
  - "frontend/*"
  - "cloudflare/*"
  - "backend/*"
  - "desktop/*"
```

## Supabase Location

Supabase lives **inside the frontend app** (`frontend/vite/supabase/`), not at root. This is required because:

- `supabase gen types typescript --local` outputs types that must land in `src/types/database.types.ts` — colocating keeps the path clean
- Edge functions share the same workspace context as the frontend
- The Supabase CLI requires commands to run from the directory containing `supabase/config.toml`

Root-level `supabase/` is only appropriate if multiple frontends share one Supabase instance and you accept the type generation path complexity.

## Onboarding

### Decisions
- Frontend app folder name: `vite` (default)
- Which top-level directories to create (not all projects need cloudflare/, desktop/, etc.)

### Scaffolding
Create base directories and workspace config. The onboarding agent creates only the directories the project needs.
