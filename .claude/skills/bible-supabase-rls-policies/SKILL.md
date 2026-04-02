---
name: bible-supabase-rls-policies
description: Use when creating or modifying Row Level Security policies, designing multi-tenant table access control, or adding organization_id to new tables
---

# Supabase Row Level Security (RLS) Policies

Row Level Security controls which rows users can access. Every org-scoped table gets `organization_id` directly on the row — RLS checks it with a single-hop query. No multi-table join chains.

## Multi-Tenant RLS Architecture

Every org-scoped table has `organization_id` directly on the row. This is **pre-computed on INSERT** by a trigger, not re-computed on every SELECT. The RLS policy is a simple membership check — no FK chain traversal.

### Two Table Patterns

**Top-level tables** (direct children of `organizations`): native FK column.

```sql
CREATE TABLE public.productions (
    id TEXT PRIMARY KEY DEFAULT generate_id('prd'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- ...
);
```

**Child tables** (any depth below top-level): trigger-populated, `DEFAULT ''`.

```sql
CREATE TABLE public.shots (
    id TEXT PRIMARY KEY DEFAULT generate_id('sht'),
    scene_id UUID NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL,  -- trigger-populated
    -- ...
);
```

**Why `DEFAULT ''`?** Supabase type generation makes `NOT NULL` columns with a DEFAULT optional on Insert. Without the DEFAULT, the generated TypeScript type requires `organization_id` on every `.insert()` call — but the frontend doesn't pass it (the trigger handles it). The empty string is never committed because the BEFORE INSERT trigger always sets the real value.

## Standard RLS Policy Pattern

Every org-scoped table uses the same policy template:

```sql
ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_can_view_my_table"
    ON public.my_table FOR SELECT TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "org_members_can_insert_my_table"
    ON public.my_table FOR INSERT TO authenticated
    WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "org_members_can_update_my_table"
    ON public.my_table FOR UPDATE TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "org_members_can_delete_my_table"
    ON public.my_table FOR DELETE TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = (SELECT auth.uid())
        )
    );
```

**Policy naming:** `org_members_can_{verb}_{table_name}`

## BEFORE INSERT Trigger Pattern

Every child table needs a trigger to auto-populate `organization_id` from its direct parent (1-hop lookup).

```sql
CREATE OR REPLACE FUNCTION public.set_org_id_from_{parent}()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    SELECT organization_id INTO NEW.organization_id
    FROM public.{parent_table}
    WHERE id = NEW.{parent_fk};

    IF NEW.organization_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve organization_id for {parent_fk} %', NEW.{parent_fk};
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_org_id_{table}
    BEFORE INSERT ON public.{table}
    FOR EACH ROW
    EXECUTE FUNCTION public.set_org_id_from_{parent}();
```

**Rules:**
- `SECURITY DEFINER` — bypasses RLS when reading parent's org_id
- `SET search_path = public` — required for SECURITY DEFINER functions
- `RAISE EXCEPTION` if NULL — fail loudly, never insert a row without org_id
- **One function per parent table** — shared by all tables with the same FK (e.g., all tables with `scene_id` share `set_org_id_from_scene()`)
- **Always 1-hop** — read from direct parent, never traverse the FK chain

## Performance Optimization

**Always wrap `auth.uid()` in a SELECT subquery** — without it, evaluated per-row:

```sql
-- Correct (evaluated once per query)
WHERE user_id = (SELECT auth.uid())

-- Wrong (evaluated per row — 99% slower on large tables)
WHERE user_id = auth.uid()
```

## Anti-Patterns

| Wrong | Correct |
|---|---|
| RLS policy joins through FK chain to reach org_members | `organization_id` directly on row, 1-hop check |
| `EXISTS (SELECT 1 FROM parent JOIN grandparent JOIN ...)` | `organization_id IN (SELECT ... FROM organization_members)` |
| Multi-hop trigger (reads through FK chain) | 1-hop trigger (reads from direct parent) |
| `organization_id TEXT NOT NULL` on child table (no DEFAULT) | `organization_id TEXT DEFAULT '' NOT NULL` (type gen compatibility) |
| Omitting `TO authenticated` on policy | Always explicit `TO authenticated` |
| `auth.uid()` without SELECT subquery wrapper | `(SELECT auth.uid())` for per-query evaluation |

### Why Join-Chain RLS Fails

When a table's RLS policy joins through multiple tables (e.g., `keyframes → scene_files → scenes → scripts → productions → org_members`), and each intermediate table ALSO has RLS policies, Postgres expands the authorization check recursively. A 5-hop chain can produce 648+ subplans per query. With limited `work_mem` (e.g., 3.5MB on Supabase free tier), this saturates the query planner and causes timeouts.

Denormalized `organization_id` eliminates this entirely — one column, one check, zero recursion.

## Realtime Event Routing

Tables with realtime triggers use `get_organization_id_for_change()` to determine which organization to broadcast changes to. With denormalized `organization_id`, this function becomes trivial:

```sql
-- Every table reads organization_id directly from the record
org_id := p_record_data->>'organization_id';
```

No FK chain queries needed. When adding a new table to realtime, just add it to the direct-lookup WHEN clause.

## Verification

```bash
supabase db lint --local
```

Check for `0003_auth_rls_initplan` warning (`auth.uid()` not optimized).

## Onboarding

### Decisions
- Multi-tenant key column name: `organization_id` (default)
- Whether immutable tables skip UPDATE policy (e.g., file_previews, script_versions)
- Whether DELETE uses creator-only check or org-member check

### Scaffolding
None — RLS policies are created per-table in migrations. Follow the templates above.
