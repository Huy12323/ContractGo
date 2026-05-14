---
name: bible-supabase-cli
description: Use when running Supabase CLI commands, debugging database/schema issues against the live local DB, or investigating local/production database operations
---

# Supabase CLI

Reference for Supabase CLI commands for development, testing, and deployment.

## Prerequisites

**All supabase commands must run from the directory containing `supabase/config.toml`.** Commands will fail from any other directory.

Typically this is your frontend app root (e.g., `frontend/vite/`). Check your project's `supabase/` directory location.

## Critical Rules

1. **Check pnpm scripts first** — your project may wrap CLI commands in pnpm scripts
2. **Use `--local` flag** for local development to prevent accidental production changes
3. **Regenerate types after schema changes**
4. **Prefer live DB over guessing** — when debugging, inspect the actual database
5. **NEVER run `supabase db reset`** — dropping the database is forbidden, even in dev. Seed data is precious and must be preserved unconditionally. Use `supabase db push --local` instead (applies only pending migrations, preserves existing data).
6. **ALWAYS back up before migrations** — run `/backup` before any `db push` command. See the backup skill for the full procedure.

## Quick Reference

### Local Development

| Command                      | Purpose                |
| ---------------------------- | ---------------------- |
| `supabase start`             | Start local stack      |
| `supabase stop`              | Stop local stack       |
| `supabase status`            | Check running services |

### Migrations

| Command                          | Purpose                           |
| -------------------------------- | --------------------------------- |
| `supabase migration new <name>`  | Create empty migration            |
| `supabase db diff --local`       | Generate from UI changes          |
| `supabase db push --local`       | Apply migrations (preserves data) |
| `supabase db reset --local`      | **DESTRUCTIVE** — wipes all data, re-runs from scratch. Requires user approval |
| `supabase migration list --local`| List local migrations             |

### Database

| Command                      | Purpose                           |
| ---------------------------- | --------------------------------- |
| `supabase status`            | Get Database URL and service info |
| `supabase db lint --local`   | Lint schema for issues            |
| `supabase db push --dry-run` | Preview production push           |
| `supabase db push --linked`  | Push to production                |

### Types

| Command                                          | Purpose                      |
| ------------------------------------------------ | ---------------------------- |
| `supabase gen types typescript --local`           | Generate TS types from local |

### Edge Functions

| Command                                          | Purpose              |
| ------------------------------------------------ | -------------------- |
| `supabase functions serve --env-file .env.local`  | Serve locally        |
| `supabase functions deploy <name>`                | Deploy to production |

## Direct Database Access

Use `supabase status` to get the Database URL for direct psql access:

```bash
# Get connection info
supabase status
# Output includes: Database URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Run SQL directly
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "SELECT * FROM my_table"
```

**Windows (Git Bash) quirk:** The `-c` flag gets mangled. Use heredoc instead:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres <<'SQL'
SELECT * FROM my_table LIMIT 10;
SQL
```

**When to use direct psql:**

- Complex INSERT/SELECT operations
- Data migration between tables
- Bulk operations
- When REST API is cumbersome

## Debugging with Live DB

**When debugging database/schema/query issues, always inspect the live database first.** Do not guess schema from TypeScript types or generated code — verify against the actual DB.

```bash
# 1. Confirm local stack is running
supabase status

# 2. Inspect table schema (columns, types, defaults)
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres <<'SQL'
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'TABLE_NAME'
ORDER BY ordinal_position;
SQL

# 3. Check access policies on a table
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres <<'SQL'
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'TABLE_NAME';
SQL

# 4. Sample data
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres <<'SQL'
SELECT * FROM TABLE_NAME LIMIT 5;
SQL
```

**Use this when:**

- A query returns unexpected data or errors
- You need to verify column names, types, or constraints
- Debugging access policy behavior
- Checking if data exists before writing frontend code

## Environment Flags

| Flag                  | Target           | Use Case              |
| --------------------- | ---------------- | --------------------- |
| `--local`             | Local stack      | Development, testing  |
| `--linked`            | Production       | Production operations |
| `--project-ref <ref>` | Specific project | Explicit selection    |

## Docker Lifecycle Management

Supabase CLI spawns Docker containers with `restart: always` by default. This causes **every project's Supabase stack to auto-start when Docker Desktop restarts** — a serious resource problem when working across multiple codebases.

### The Problem

```bash
docker ps
# supabase_db_vite          Up 2 hours    ← project A (not working on it)
# supabase_auth_vite        Up 2 hours    ← project A
# supabase_db_vite          Up 2 hours    ← project B (port conflict!)
# ... 20+ containers across 3 projects, all consuming RAM
```

Container names default to the parent folder of `supabase/` (e.g., `vite`), making them indistinguishable across projects.

### The Fix: `supabase-dev.js` Wrapper

Every project should have a `scripts/supabase-dev.js` that wraps `supabase start` with two behaviors:

1. **Names containers by project** — `project_id` in `config.toml` must match the repo name (e.g., `my-app`), so `docker ps` shows `supabase_db_my-app`
2. **Sets `restart=no`** — after start, updates all containers so they don't auto-start on Docker Desktop restart

**The script must exit after start.** Most projects chain it with other services via `&&` (e.g., `node scripts/supabase-dev.js && concurrently ...`). A blocking script would prevent downstream services from starting. Stop Supabase separately via `pnpm sb:dev:stop`.

```javascript
#!/usr/bin/env node

/**
 * Supabase Dev Lifecycle Manager
 *
 * Wraps `supabase start` with:
 * 1. restart=no on all containers (prevents Docker Desktop auto-start)
 * 2. Exits after start so `concurrently` can run other services
 *
 * Clean shutdown: use `pnpm sb:dev:stop` or `supabase stop` separately.
 *
 * Requires: project_id in supabase/config.toml must match the repo name.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ONBOARDING: Set this to the directory containing supabase/config.toml
const SUPABASE_DIR = path.join(__dirname, "../frontend/vite");

function getSupabaseProjectId() {
    const configPath = path.join(SUPABASE_DIR, "supabase/config.toml");
    const content = fs.readFileSync(configPath, "utf-8");
    const match = content.match(/^project_id\s*=\s*"(.+)"/m);
    return match ? match[1] : null;
}

function disableAutoRestart(projectId) {
    try {
        const result = execSync(
            `docker ps -q --filter "label=com.supabase.cli.project=${projectId}"`,
            { encoding: "utf-8" },
        ).trim();

        if (!result) return;

        const containerIds = result.split("\n").filter(Boolean);
        console.log(
            `[supabase-dev] Setting restart=no on ${containerIds.length} containers`,
        );

        for (const id of containerIds) {
            execSync(`docker update --restart=no ${id}`, { stdio: "ignore" });
        }
    } catch (err) {
        console.warn("[supabase-dev] Warning: Could not update restart policies:", err.message);
    }
}

function main() {
    const projectId = getSupabaseProjectId();
    console.log(`[supabase-dev] Starting Supabase (project: ${projectId})...\n`);

    try {
        execSync("supabase start", { cwd: SUPABASE_DIR, stdio: "inherit" });
        if (projectId) disableAutoRestart(projectId);
        console.log(`\n[supabase-dev] Supabase ready (restart=no applied).`);
    } catch (err) {
        console.error("[supabase-dev] Failed to start:", err.message);
        process.exit(1);
    }
}

main();
```

### config.toml: `project_id`

The `project_id` in `supabase/config.toml` controls Docker container naming. It **must match the repo/project name** so containers are identifiable in `docker ps`:

```toml
# supabase/config.toml
project_id = "my-app"     # ✅ docker ps shows: supabase_db_my-app
project_id = "vite"        # ❌ default — meaningless, conflicts across projects
```

### Root package.json Integration

```json
{
    "scripts": {
        "dev": "node scripts/supabase-dev.js && concurrently ...",
        "sb:dev:start": "node scripts/supabase-dev.js",
        "sb:dev:stop": "cd frontend/vite && supabase stop"
    }
}
```

## Common Workflows

### Initial Setup

```bash
supabase start && supabase migration up --local
```

### New Migration

```bash
supabase migration new add_feature  # Create
# Edit migration file
supabase db push --local            # Apply
# Regenerate types
```

### Production Deploy

```bash
supabase db push --local            # Apply pending migrations (preserves data)
supabase db lint --local            # Check for issues
supabase db push --dry-run          # Preview production push
supabase db push --linked           # Deploy
```

## Troubleshooting

**Services won't start (port conflict):**

```bash
supabase stop && supabase start
```

**Types out of sync:**

Regenerate types from local schema.

**Migrations out of sync:**

```bash
supabase migration list --local
supabase migration list --linked
supabase db reset --local  # DESTRUCTIVE — only with user approval
```

## Local Services Ports

- Database: 54322
- Studio: 54323
- API Gateway: 54321
- Auth: 54324
- Realtime: 54325
- Storage: 54326

## Onboarding

### Decisions
- Supabase directory location (default: `frontend/vite/supabase/`)
- `project_id` in `config.toml` — must match the repo name
- pnpm script wrappers for common commands (project-specific)

### Scaffolding
1. Set `project_id` in `supabase/config.toml` to match the repo name
2. Create `scripts/supabase-dev.js` from the template in **Docker Lifecycle Management** above — update `SUPABASE_DIR` to match the project's supabase directory location
3. Update root `package.json` scripts: `sb:dev:start` → `node scripts/supabase-dev.js`, `dev` → starts supabase-dev.js before concurrent services
