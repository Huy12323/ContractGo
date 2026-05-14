---
name: backup
description: Use when backing up or restoring seed data, before running migrations, or when the user says /backup. Protects against data loss from schema changes.
---

# Database Backup

Back up and restore seed data for local and remote Supabase databases. **Seed data is precious and must never be lost.**

## Critical Rules

1. **NEVER drop or reset the database** — not even in dev. Seed data took significant effort to create and must be preserved unconditionally.
2. **Always back up before migrations** — run a backup before `supabase db push --local`, `pnpm sb:dev:push`, or any remote migration push.
3. **Backups go in `backups/`** at project root (gitignored, never committed — they contain data).
4. **Keep the last 20 backups** — prune older ones after each new backup.

## Connection Details

### Local (dev)

```
Host:     localhost (or 127.0.0.1)
Port:     54322
User:     postgres
Password: postgres
Database: postgres
```

### Remote (staging/production)

Read the Supavisor pooler URL from `.env.stag` or `.env.prod` (`SUPABASE_DB_URL`). Parse host/port/user/password/dbname from the URL.

## Backup Procedure

### 1. Create backup directory if needed

```powershell
if (-not (Test-Path backups)) { New-Item -ItemType Directory backups }
```

### 2. Run pg_dump (data-only)

**Local:**

```powershell
pg_dump -h localhost -p 54322 -U postgres -d postgres --data-only --no-owner --no-privileges --disable-triggers -F plain -f "backups/{timestamp}_{env}.sql"
```

Set `$env:PGPASSWORD = 'postgres'` before running.

**Naming convention:** `backups/20260513_143000_local.sql` — format `YYYYMMDD_HHmmss_{env}.sql`

**Remote:** Same command but with connection details from the env file. Use env name (`staging` or `production`) in the filename.

### 3. Verify backup

Check the file exists and has a reasonable size (should be >1KB for any seeded database). Report the file size to the user.

### 4. Prune old backups

After a successful backup, list all `.sql` files in `backups/`, sort by name (which sorts chronologically), and delete all but the 20 most recent.

## Restore Procedure

### 1. List available backups

```powershell
Get-ChildItem backups/*.sql | Sort-Object Name -Descending | Select-Object -First 20 Name, Length, LastWriteTime
```

Show the user the list and ask which one to restore.

### 2. Restore

```powershell
$env:PGPASSWORD = 'postgres'
psql -h localhost -p 54322 -U postgres -d postgres -f "backups/{selected_file}"
```

For remote restores, parse connection details from the env file. **Always confirm with the user before restoring to staging or production.**

### 3. Verify

Run a quick count on key tables to confirm data was restored:

```sql
SELECT 'employees' AS tbl, count(*) FROM employees
UNION ALL SELECT 'timeclock_sessions', count(*) FROM timeclock_sessions
UNION ALL SELECT 'organizations', count(*) FROM organizations;
```

## Usage Patterns

| User says | Action |
|-----------|--------|
| `/backup` | Back up local dev database |
| `/backup production` | Back up production database |
| `/backup restore` | List backups and restore selected one |
| `/backup list` | List available backups |

## Integration with Migrations

When Claude is about to run any migration command (`supabase db push`, `pnpm sb:dev:push`, `pnpm sb:production:push`, etc.), **always run a backup first**. This is non-negotiable. The backup protects against migrations that corrupt or lose data.

Sequence:
1. Back up current state
2. Apply migration
3. If migration fails or corrupts data → restore from backup
