---
name: bible-supabase-migrations
description: Use when creating database migrations, modifying schema, running common DB workflows, or verifying schema changes
---

# Supabase Migrations & Workflows

Guidelines for creating migrations, common database recipes, type generation, and verification workflows.

## Critical Rules

1. **NEVER manually edit `database.types.ts`** — auto-generated
2. **ALWAYS regenerate types** after ANY schema change
3. **ALWAYS test locally** before production
4. **NEVER run `supabase db reset` without explicit user approval** — existing data must survive migrations. Use `supabase db push --local` (applies only pending migrations, preserves data). A migration that only passes on a clean reset gives false confidence — it proves nothing about staging/production where real data exists. The whole point is to verify data migrates correctly, not that it can be rebuilt from scratch.

## Migration Naming

**Pattern:** `YYYYMMDDHHMMSS_descriptive_name.sql`

Example: `20251106183429_add_projects_table.sql`

## Two Methods

| Method         | Command                    | Best For                        |
| -------------- | -------------------------- | ------------------------------- |
| Direct SQL     | `supabase migration new`   | New tables, functions, triggers |
| Studio UI Diff | `supabase db diff --local` | Column changes, visual design   |

Your project may wrap these in pnpm scripts — verify with your scripts config.

## Complete Workflow

```bash
# 1. Create migration
supabase migration new add_my_feature

# 2. Write SQL (see template below)

# 3. Apply locally (preserves data)
supabase db push --local

# 4. Generate TypeScript types
# (use your project's type generation script)

# 5. Test application

# 6. Verify application works with migrated data

# 7. Push to production (dry-run first)
supabase db push --dry-run
supabase db push --linked
```

## Migration Templates

### Top-Level Table (direct child of organizations)

```sql
-- ============================================
-- [FEATURE NAME]
-- ============================================

-- PHASE 1: CREATE TABLE
CREATE TABLE public.my_table (
    id TEXT PRIMARY KEY DEFAULT generate_id('pre'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_my_table_organization_id ON public.my_table(organization_id);

-- PHASE 2: ENABLE RLS (see your RLS skill for full policy templates)
ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY ... organization_id IN (SELECT organization_id FROM organization_members ...)

-- PHASE 3: REALTIME (if applicable)
-- Add realtime triggers here (project-specific)
```

### Child Table (any depth — trigger-populated organization_id)

```sql
-- ============================================
-- [FEATURE NAME]
-- ============================================

-- PHASE 1: CREATE TABLE
CREATE TABLE public.my_child_table (
    id TEXT PRIMARY KEY DEFAULT generate_id('chd'),
    parent_id TEXT NOT NULL REFERENCES public.parent_table(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL,  -- trigger-populated
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_my_child_table_parent_id ON public.my_child_table(parent_id);
CREATE INDEX idx_my_child_table_organization_id ON public.my_child_table(organization_id);

-- PHASE 2: TRIGGER (auto-populate organization_id from parent)
CREATE OR REPLACE FUNCTION public.set_org_id_from_parent()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    SELECT organization_id INTO NEW.organization_id
    FROM public.parent_table WHERE id = NEW.parent_id;
    IF NEW.organization_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve organization_id for parent_id %', NEW.parent_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_org_id_my_child_table
    BEFORE INSERT ON public.my_child_table
    FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_parent();

-- PHASE 3: ENABLE RLS (see your RLS skill for full policy templates)
ALTER TABLE public.my_child_table ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY ... organization_id IN (SELECT organization_id FROM organization_members ...)

-- PHASE 4: REALTIME (if applicable)
-- Add realtime triggers here (project-specific)
```

## New Table Checklist

- [ ] Create table with proper schema (see your schema design skill)
- [ ] Add `organization_id` — native FK (top-level) or `DEFAULT '' NOT NULL` (child)
- [ ] Add indexes for foreign keys + `organization_id`
- [ ] Create BEFORE INSERT trigger for `organization_id` (child tables only)
- [ ] Enable RLS with single-hop `organization_id` policies (see your RLS skill)
- [ ] Add to realtime system if needed (project-specific)
- [ ] Generate types
- [ ] Add query key entry (see your data fetching skill)

## Common Recipes

### Add Column to Existing Table

```sql
-- Add column with default value
ALTER TABLE public.my_table ADD COLUMN new_column TEXT DEFAULT 'default_value';

-- Add NOT NULL column (requires default or backfill)
ALTER TABLE public.my_table ADD COLUMN required_column TEXT NOT NULL DEFAULT 'value';

-- Add foreign key column
ALTER TABLE public.my_table ADD COLUMN parent_id TEXT REFERENCES public.parent_table(id) ON DELETE CASCADE;
CREATE INDEX idx_my_table_parent_id ON public.my_table(parent_id);
```

### Add Enum Column

```sql
CREATE TYPE my_table_status_enum AS ENUM ('draft', 'active', 'archived');
ALTER TABLE public.my_table ADD COLUMN status my_table_status_enum NOT NULL DEFAULT 'draft';
```

### Rename Column

```sql
ALTER TABLE public.my_table RENAME COLUMN old_name TO new_name;
```

### Drop Column

```sql
ALTER TABLE public.my_table DROP COLUMN column_name;
```

### Backfill Data

```sql
-- Backfill before adding NOT NULL constraint
UPDATE public.my_table SET new_column = 'default_value' WHERE new_column IS NULL;
ALTER TABLE public.my_table ALTER COLUMN new_column SET NOT NULL;
```

## Hard Delete Pattern

Default approach: hard deletes — no `deleted_at` columns. Simpler schema, no query filters, GDPR-compliant.

```sql
-- Delete via CASCADE (when parent is deleted, children follow)
-- Delete via SDK: see your SDK skill for the calling pattern
DELETE FROM public.my_table WHERE id = 'item_id';
```

**If you need audit trail:** Use PostgreSQL triggers to log deletions to a separate audit table.

## Type Generation

Regenerate TypeScript types after ANY schema change — after migrations, after Studio changes, before committing.

Output: `src/types/database.types.ts` (or your configured path).

## Verification

**Daily:** Apply migration → regenerate types → test → commit migration + types together.

**Before production:** Apply pending migrations (`db push --local`) → regenerate types → test → lint → dry-run → push.

## Database Lint

Run after every migration:

```bash
supabase db lint --local
```

**What it checks:**

- Access control performance issues
- Duplicate policies
- Duplicate indexes
- Other performance issues

**Required action:** Fix all warnings before deploying.

## Anti-Patterns

| Wrong | Correct |
|---|---|
| Manually editing `database.types.ts` | Regenerate with CLI |
| Running `db reset` without user approval | Use `db push --local` to apply pending migrations (preserves data) |
| Pushing to production without local verification | Always `db push --local` + test first |
| Skipping type generation after migration | Always regenerate types |
| TEXT + CHECK for fixed values | ENUM (see your schema design skill) |
| Missing indexes on FK columns | Index every FK |

## Onboarding

### Decisions
- Hard deletes vs soft deletes (default: hard deletes)
- Type generation output path (default: `src/types/database.types.ts`)
- pnpm script names for migration commands (project-specific wrappers)

### Scaffolding
None — migrations use Supabase CLI directly. Projects may add pnpm script wrappers.
