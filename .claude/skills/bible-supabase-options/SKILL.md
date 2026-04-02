---
name: bible-supabase-options
description: Use when creating SELECT, Radio, or dropdown options for database columns with fixed enum values — ALWAYS use instead of hardcoding options arrays
---

# Supabase Enum Options

Static, type-safe enum options derived from Supabase database enums. Provides compile-time safety ensuring UI options always match database schema.

## When to Use

- Fixed schema enums (status, type, mode, category) — use static options
- Dynamically fetched values (admin-configurable, per-org) — use query hooks instead

## File Location

**Co-located with the domain that owns the enum.** Options files live alongside the hooks/components that use them, following the `const_*` naming convention.

```
src/hooks/Files/
├── useQ_Files_List.ts
├── useM_Files_Create.ts
└── const_FilesCategoryOptions.ts       ← enum options for files.category

src/hooks/Tasks/
├── useQ_Tasks_List.ts
└── const_TasksStatusOptions.ts         ← enum options for tasks.status
```

**Why co-located:**
- Discovery is intuitive — options live with their domain
- Deletion is clean — remove a feature, its options go with it
- Matches how `useQ_*`, `useM_*`, `utils_*` already co-locate by domain

## Core Pattern

```typescript
// src/hooks/Tasks/const_TasksStatusOptions.ts
import { Supabase_Enums } from "@/types/supabase.types";
import { Utils_Options_EnumsToOptions } from "@/utils/options/EnumsToOptions";

const Tasks_Status: Record<
    Supabase_Enums<"tasks_status_enum">,
    { value: Supabase_Enums<"tasks_status_enum">; label: string }
> = {
    pending: { value: "pending", label: "Pending" },
    active: { value: "active", label: "Active" },
    completed: { value: "completed", label: "Completed" },
};

export const const_TasksStatusOptions = Utils_Options_EnumsToOptions(Tasks_Status);
```

**Export naming:** `const_{Table}{Column}Options`

**Return structure:** `{ options: T[], map: Record<string, T> }`
- `.options` — for Select/Radio components
- `.map` — for O(1) lookups by value

## Usage

```typescript
// Select component
<Select options={const_TasksStatusOptions.options} />

// Map lookup (O(1))
const meta = const_TasksStatusOptions.map[status];
<Tag color={meta.color}>{meta.label}</Tag>

// Validation
const allowed = const_FilesCategoryOptions.map[category].allowedExtensions;
```

## Metadata Extensions

Extend the base `{ value, label }` with domain-specific metadata:

```typescript
const Tasks_Status: Record<
    Supabase_Enums<"tasks_status_enum">,
    { value: Supabase_Enums<"tasks_status_enum">; label: string; color: string }
> = {
    pending: { value: "pending", label: "Pending", color: "warning" },
    active: { value: "active", label: "Active", color: "processing" },
    completed: { value: "completed", label: "Completed", color: "success" },
};
```

Common metadata: `color` (tags/badges), `description` (tooltips), `icon` (menus), `allowedExtensions` (file validation).

## Shared Enums

When an enum (like `app_role`) is used by multiple tables, the primary owner defines it. Others import:

```typescript
// src/hooks/Members/const_MembersRoleOptions.ts — primary owner
export const const_MembersRoleOptions = Utils_Options_EnumsToOptions(Members_Role);

// src/hooks/Invitations/const_InvitationsRoleOptions.ts — re-exports
import { const_MembersRoleOptions } from "@/hooks/Members/const_MembersRoleOptions";
export const const_InvitationsRoleOptions = const_MembersRoleOptions;
```

## Type Safety Guarantee

When a Supabase enum changes, TypeScript forces updating the mapping:

```bash
# After: ALTER TYPE tasks_status_enum ADD VALUE 'cancelled';
# Regenerate types, then:
# Error: Type '{ pending: {...}; active: {...}; completed: {...} }' is missing: cancelled
```

Build fails until all enum values have labels/metadata.

## Anti-Patterns

| Wrong | Correct |
|---|---|
| Hardcoded options array in component | Import from `const_*Options` |
| `src/types/{table}.options.ts` (centralized) | Co-locate with domain hooks |
| Duplicating shared enum definitions | Import from primary owner |
| Query hooks for fixed enums | Static options (no network) |
| Direct union types `"admin" \| "user"` | `Supabase_Enums<"enum_name">` |

## Onboarding

### Decisions
None — co-located `const_*` naming is a cross-project standard.

### Scaffolding
Create the EnumsToOptions utility:
- Path: `src/utils/options/EnumsToOptions.ts`
- Template:

```typescript
type OptionBase = { value: string; label: string };

export const Utils_Options_EnumsToOptions = <T extends OptionBase>(
    record: Record<string, T>,
): { options: T[]; map: Record<string, T> } => ({
    options: Object.values(record),
    map: record,
});
```
