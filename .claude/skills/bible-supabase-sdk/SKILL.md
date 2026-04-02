---
name: bible-supabase-sdk
description: Use when making direct Supabase SDK calls in TypeScript files (hooks, components, routes, utilities)
---

# Supabase SDK Usage

Conventions for all Supabase client SDK calls — naming, error handling, and integration patterns.

## Naming Convention for SDK Responses

**Cross-project standard.** All Supabase SDK responses use the `sb_*` prefix.

### Pattern

```typescript
const sb_Service[StringParam]_Operation = await supabase.service.method();
```

**Components:**

- `sb_` — prefix for all Supabase SDK responses
- `Service` — the Supabase service: `Auth`, `From`, `Functions`, `Storage`
- `[StringParam]` — string parameters converted to PascalCase, concatenated directly (no underscore)
- `Operation` — the primary operation: `Select`, `Insert`, `Update`, `Delete`, `Invoke`, etc.

### String Parameter Conversion

**snake_case → PascalCase**

```typescript
"organization_members" → OrganizationMembers
"rel__files__tags" → RelFilesTags
```

**kebab-case → PascalCase**

```typescript
"generate-upload-url" → GenerateUploadUrl
"delete-file" → DeleteFile
```

### Primary Operation Only

Use only the main operation — ignore modifiers like `.single()`, `.eq()`, `.maybeSingle()`:

```typescript
// ✅ Correct — primary operation only
const sb_FromProjects_Select = await supabase
    .from("projects")
    .select()
    .eq("id", id)
    .single();

// ❌ Wrong — don't include modifiers
const sb_FromProjects_SelectEqSingle = await supabase
    .from("projects")
    .select()
    .eq("id", id)
    .single();
```

## Core Examples

### Database Operations (from)

```typescript
// Insert
const sb_FromProjects_Insert = await supabase
    .from("projects")
    .insert(body)
    .select()
    .single();

// Select
const sb_FromMembers_Select = await supabase
    .from("organization_members")
    .select("*, organizations(*)")
    .eq("user_id", userId);

// Update
const sb_FromProjects_Update = await supabase
    .from("projects")
    .update(body)
    .eq("id", id)
    .select()
    .single();

// Delete
const sb_FromRelFilesTags_Delete = await supabase
    .from("rel__files__tags")
    .delete()
    .eq("file_id", fileId);
```

### Auth Operations

```typescript
const sb_Auth_GetUser = await supabase.auth.getUser();
const user = sb_Auth_GetUser.data.user;

const sb_Auth_GetSession = await supabase.auth.getSession();
const session = sb_Auth_GetSession.data.session;

const sb_Auth_SignOut = await supabase.auth.signOut();
```

### Functions (Edge Functions)

```typescript
const sb_Functions_InvokeGenerateUploadUrl = await supabase.functions.invoke(
    "generate-upload-url",
    { body: { fileName, projectId } },
);
```

### Storage Operations

```typescript
const sb_StorageProjectFiles_Upload = await supabase.storage
    .from("project-files")
    .upload(path, file);

const sb_StorageProjectFiles_Download = await supabase.storage
    .from("project-files")
    .download(path);
```

## Error Handling

```typescript
const sb_FromProjects_Select = await supabase.from("projects").select();
if (sb_FromProjects_Select.error) {
    console.error("Failed to fetch projects:", sb_FromProjects_Select.error);
    throw sb_FromProjects_Select.error;
}
const projects = sb_FromProjects_Select.data;
```

## Why This Convention?

Destructuring causes naming conflicts with multiple SDK calls and inconsistent renaming across developers:

```typescript
const { data, error } = await supabase.from("projects").insert();
const { data, error } = await supabase.from("files").select(); // ❌ Conflict!
const { data: uploadData, error: urlError } = ...;             // ❌ Ugly, inconsistent
```

`sb_*` gives each response a unique, self-documenting name with no conflicts.

## Common Patterns

### Early Return

```typescript
const sb_Auth_GetUser = await supabase.auth.getUser();
if (sb_Auth_GetUser.error || !sb_Auth_GetUser.data.user) return null;
const user = sb_Auth_GetUser.data.user;
```

### Nested Data Extraction

```typescript
const sb_Auth_GetSession = await supabase.auth.getSession();
const session = sb_Auth_GetSession.data.session;
```

## Usage with Data Fetching Hooks

The `sb_*` convention is used inside query and mutation hook bodies:

```typescript
// In a query hook's queryFn:
const queryFn = async (projectId: string) => {
    const sb_FromFiles_Select = await supabase
        .from("files")
        .select("*, rel__files__tags(tags(*))")
        .eq("project_id", projectId);

    if (sb_FromFiles_Select.error) throw sb_FromFiles_Select.error;
    return sb_FromFiles_Select.data;
};

// In a mutation hook's mutationFn:
const mutationFn = async (body: CreateProjectBody) => {
    const sb_FromProjects_Insert = await supabase
        .from("projects")
        .insert(body)
        .select()
        .single();

    if (sb_FromProjects_Insert.error) throw sb_FromProjects_Insert.error;
    return sb_FromProjects_Insert.data;
};
```

See your data fetching skill for the hook structure itself.

## Anti-Patterns

| Wrong | Correct |
|---|---|
| `const { data, error }` destructuring | `const sb_From*_Operation` pattern |
| `const { data: projectData }` renaming | `const sb_FromProjects_Select` |
| Including modifiers in name (`SelectEqSingle`) | Primary operation only (`Select`) |
| Inconsistent naming across team | Always follow `sb_Service[Param]_Operation` |

## Onboarding

### Decisions
None — `sb_*` naming is a cross-project standard.

### Scaffolding
Create Supabase client config:
- Path: `src/configs/supabase/config.ts`
- Template:

```typescript
import { createClient } from "@supabase/supabase-js";
import type { DatabaseWithCustomTypes } from "@/types/database.override.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient<DatabaseWithCustomTypes>(
    supabaseUrl,
    supabaseAnonKey,
);
```

Create Supabase type helpers:
- Path: `src/types/supabase.types.ts`
- Template:

```typescript
import type { DatabaseWithCustomTypes } from "./database.override.types";

export type Supabase_Tables<T extends keyof DatabaseWithCustomTypes["public"]["Tables"]> =
    DatabaseWithCustomTypes["public"]["Tables"][T];

export type Supabase_Enums<T extends keyof DatabaseWithCustomTypes["public"]["Enums"]> =
    DatabaseWithCustomTypes["public"]["Enums"][T];
```
