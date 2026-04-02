---
name: bible-supabase-schema
description: Use when designing database tables, columns (including fixed-value columns), relationships, or JSONB type overrides
---

# Supabase Schema Design

Guidelines for database tables, columns, relationships, naming conventions, and type safety patterns.

## Primary Key Strategy

Default: custom `generate_id('prefix')` for human-readable IDs.

```sql
id TEXT PRIMARY KEY DEFAULT generate_id('prj')  -- ✅ Custom ID with prefix
id UUID PRIMARY KEY DEFAULT gen_random_uuid()   -- Alternative: standard UUID
```

**Common prefixes:** `org`, `prj`, `usr`, `mem`, `doc`, `fil`

Choose a prefix per table — short (2-4 chars), unique across schema.

## Naming Conventions

**All identifiers:** snake_case

**Avoid redundant prefixes:** Table name already provides context.

| Table      | Good           | Bad                      |
| ---------- | -------------- | ------------------------ |
| `files`    | `name`, `size` | `file_name`, `file_size` |
| `projects` | `name`         | `project_name`           |

**Exception:** Foreign keys keep full context: `organization_id`, `project_id`

**Index naming:** `idx_{table}_{column}` (full names)

## Foreign Key Relationships

**Use inline REFERENCES with ON DELETE behavior** — PostgreSQL auto-generates constraint names.

```sql
-- ✅ Correct — inline (auto-generates {table}_{column}_fkey)
organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE

-- ❌ Wrong — duplicate constraints
organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
CONSTRAINT fk_projects_org FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id) ON DELETE CASCADE  -- Creates duplicate!
```

**DELETE behaviors:** CASCADE (most common), SET NULL (optional refs), RESTRICT (rarely)

## Junction Tables (Many-to-Many)

**Naming:** `rel__[table1]__[table2]` (double underscore delimiters, alphabetical order)

```sql
CREATE TABLE public.rel__files__tags (
    file_id TEXT NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (file_id, tag_id)
);

CREATE INDEX idx_rel__files__tags_file_id ON public.rel__files__tags(file_id);
CREATE INDEX idx_rel__files__tags_tag_id ON public.rel__files__tags(tag_id);
```

**Requirements:** Composite PK, CASCADE on both FKs, index each FK, include `created_at`

## Standard Columns Pattern

### Top-Level Table (direct child of organizations)

```sql
CREATE TABLE public.productions (
    id TEXT PRIMARY KEY DEFAULT generate_id('prd'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_productions_organization_id ON public.productions(organization_id);
```

### Child Table (any depth below top-level)

```sql
CREATE TABLE public.shots (
    id TEXT PRIMARY KEY DEFAULT generate_id('sht'),
    scene_id UUID NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL,  -- trigger-populated, not a FK
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shots_scene_id ON public.shots(scene_id);
CREATE INDEX idx_shots_organization_id ON public.shots(organization_id);
```

**Key differences:**
- Top-level: `organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE` — native FK
- Child: `organization_id TEXT DEFAULT '' NOT NULL` — no FK, populated by BEFORE INSERT trigger from parent
- `DEFAULT ''` is required so Supabase type gen treats it as optional on Insert (trigger always overrides it)

**Required columns:** `id`, `organization_id` (native or trigger-populated), `created_at`, `updated_at`. See your RLS skill for trigger and policy templates.

## Enum Naming Convention

**Pattern:** `[table]_[column]_enum`

```sql
CREATE TYPE files_category_enum AS ENUM ('character', 'location', 'camera');
ALTER TABLE public.files ADD COLUMN category files_category_enum;
```

## Fixed Value Columns: ALWAYS Use ENUM

| Aspect           | ENUM                    | TEXT + CHECK  |
| ---------------- | ----------------------- | ------------- |
| TypeScript types | Auto-generated union    | Just `string` |
| Frontend options | `Supabase_Enums<"...">` | Must hardcode |
| Type safety      | Full compile-time       | None          |

```sql
-- ✅ Correct: ENUM
CREATE TYPE tasks_status_enum AS ENUM ('pending', 'active', 'completed');
ALTER TABLE public.tasks
ADD COLUMN status tasks_status_enum NOT NULL DEFAULT 'pending';

-- ❌ Wrong: TEXT + CHECK (no TypeScript safety)
ADD COLUMN status TEXT CHECK (status IN ('pending', 'active', 'completed'));
```

**After creating ENUM:** Create a typed options file for frontend dropdowns/selects (see your enum options skill).

## Type Generation Reference

```typescript
type Project = Supabase_Tables<"projects">["Row"];
type ProjectInsert = Supabase_Tables<"projects">["Insert"];
type ProjectUpdate = Supabase_Tables<"projects">["Update"];
```

## Custom Types for JSONB Columns

JSONB columns generate as `Json` type. Use `MergeDeep` from `type-fest` for type safety:

```typescript
// src/types/my-table.types.ts
export type MyTable_Data = {
    settings: { theme: string; layout: "grid" | "list" };
};

// src/types/database.override.types.ts
import type { MergeDeep } from "type-fest";
import type { Database } from "./database.types";
import type { MyTable_Data } from "./my-table.types";

type DatabaseOverrides = {
    public: {
        Tables: {
            my_table: {
                Row: { data: MyTable_Data };
                Insert: { data?: MyTable_Data };
                Update: { data?: MyTable_Data };
            };
        };
    };
};

export type DatabaseWithCustomTypes = MergeDeep<Database, DatabaseOverrides>;

// src/configs/supabase/config.ts
export const supabase = createClient<DatabaseWithCustomTypes>(...);
```

**Requirements:** `pnpm add -D type-fest`, `strictNullChecks: true`

## Anti-Patterns

| Wrong | Correct |
|---|---|
| UUID for all PKs without discussion | Choose PK strategy during onboarding |
| `file_name` on `files` table | `name` (table provides context) |
| TEXT + CHECK for fixed values | ENUM with `[table]_[column]_enum` naming |
| Manual JSONB type casts | `MergeDeep` override pattern |
| Missing indexes on FK columns | `idx_{table}_{column}` on every FK |
| Duplicate CONSTRAINT + inline REFERENCES | Inline REFERENCES only |

## Onboarding

### Decisions
- PK strategy: `generate_id('prefix')` (default) or `gen_random_uuid()`
- Multi-tenant key column name: `organization_id` (default)
- Realtime events system: plan with user (table-by-table decision)

### Scaffolding
If using `generate_id()`, create the PK generator migration:
- Path: `supabase/migrations/00000000000000_generate_id.sql`
- Template:

```sql
-- Custom ID generator: generate_id('prefix') → 'prefix_abc123...'
CREATE OR REPLACE FUNCTION public.generate_id(prefix TEXT)
RETURNS TEXT AS $$
DECLARE
    bytes BYTEA;
    result TEXT := '';
    i INT;
    chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
BEGIN
    bytes := gen_random_bytes(16);
    FOR i IN 0..15 LOOP
        result := result || substr(chars, (get_byte(bytes, i) % 62) + 1, 1);
    END LOOP;
    RETURN prefix || '_' || result;
END;
$$ LANGUAGE plpgsql;
```

Create database override types file:
- Path: `src/types/database.override.types.ts`
- Template:

```typescript
import type { MergeDeep } from "type-fest";
import type { Database } from "./database.types";

// Add JSONB column overrides here as your schema grows
type DatabaseOverrides = {
    public: { Tables: {} };
};

export type DatabaseWithCustomTypes = MergeDeep<Database, DatabaseOverrides>;
```
