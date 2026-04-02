---
name: bible-tanstack-query-mutation
description: Use when creating TanStack Query hooks for data fetching (useQ_*) or mutations (useM_*)
---

# TanStack Query & Mutation Hooks

Hook structure patterns for TanStack Query. Data layer implementation (queryFn/mutationFn bodies) belongs to your backend skill — this skill defines the hook shell.

## Critical Rule: No Destructuring

```typescript
// ✅ Store entire hook result with short variable name
const qProjects = useQ_PageDashboard_Projects({ organizationId });
qProjects.query.isLoading;
qProjects.projects?.length;

// ❌ Never destructure
const { query, projects } = useQ_PageDashboard_Projects({ organizationId });

// ❌ Variable name too verbose
const qPageDashboard_Projects = useQ_PageDashboard_Projects();
```

## Query Hook Pattern

### Naming

**Hook:** `useQ_[Scope]_[Entity]` | **Variable:** `q[Entity]` (drop scope)

Scope MUST match folder/subcomponent hierarchy:

| Location            | Scope                         | Example                            |
| ------------------- | ----------------------------- | ---------------------------------- |
| Page root           | `Page[Name]`                  | `useQ_PageDashboard_Projects`      |
| Subcomponent        | `Page[Name]_[SubComp]`        | `useQ_PageDashboard_Sidebar_Tags`  |
| User-specific       | `Me`                          | `useQ_Me`                          |
| Direct table access | `Tables`                      | `useQ_Tables_Organizations`        |

**Entity:** Plural for lists (`Projects`), singular for single items (`Project`).

### Return Structure

```typescript
return {
    query,           // Always return full query object
    projects,        // Raw data (array or single item)
    projectsMap,     // Optional: Map for O(1) lookup
};
```

### Full Example

```typescript
import { useQuery } from "@tanstack/react-query";
import { QueryKeys } from "@/utils/query/queryKeys";

// 1. Extract query function OUTSIDE hook for type inference
const createProjectsQuery = (orgId: string) =>
    // Data layer call — see your backend skill
    fetchProjects(orgId);

// 2. Infer type from query shape
export type PageDashboard_Projects_QueryData = Awaited<ReturnType<typeof createProjectsQuery>>;

// 3. Hook
export const useQ_PageDashboard_Projects = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.projects.list(), { organizationId }],
        queryFn: () => createProjectsQuery(organizationId),
    });

    const projects = useMemo(() => query.data || [], [query.data]);
    const projectsMap = useMemo(
        () => projects.reduce((acc, p) => ({ ...acc, [p.id]: p }), {} as Record<string, PageDashboard_Projects_QueryData[number]>),
        [projects],
    );

    return { query, projects, projectsMap };
};
```

## QueryKeys Pattern

**Use `.list()` for list queries and `.record(id)` for single-record queries.**

```typescript
// LIST — fetches multiple rows
queryKey: [...QueryKeys.projects.list(), { organizationId }];

// RECORD — fetches one row by ID
queryKey: [...QueryKeys.projects.record(projectId)];

// Single record with joined arrays (1 project + N files)
queryKey: [...QueryKeys.projects.record(projectId), ...QueryKeys.files.list()];
```

### Join Strategy

| Case | Relationship            | Pattern                         |
| ---- | ----------------------- | ------------------------------- |
| 1    | A (1) + B (1:1, known)  | `A.record(aId), B.record(bId)` |
| 2    | As (list) + Bs (list)   | `A.list(), B.list()`            |
| 3    | A (1) + Bs (1:N array)  | `A.record(aId), B.list()`      |
| 1b   | A (1) + B (1:1, unknown)| `A.record(aId), B.list()`      |

## Query Key Factory for Mutation Reuse

Export query key factory when mutations need cache access:

```typescript
// Export factory (NOT a hook)
export const PageDashboard_Project_QueryKey = (projectId: string) =>
    [...QueryKeys.projects.record(projectId)] as const;

// Use in query hook
queryKey: PageDashboard_Project_QueryKey(projectId);

// Use in mutation for optimistic updates
const queryKey = PageDashboard_Project_QueryKey(variables.id);
queryClient.setQueryData(queryKey, optimisticValue);
```

## Minimal Processing Principle

Query hooks do MINIMAL transformation. Components handle business logic.

**Allowed:** Null coalescing (`query.data || []`), map building, `useMemo` wrappers.

**Forbidden:** Flattening/reshaping data, extracting nested arrays, business logic (isOwner, permissions), cross-hook merging.

```typescript
// ✅ Components handle logic inline
{qProject.project?.owner_id === currentUserId && <OwnerBadge />}

// ❌ Don't compute in hooks
const isOwner = useMemo(() => project?.owner_id === userId, [...]);
```

**DRY exception:** Extract a `const` when the same check repeats 3+ times in the component.

## Hook Composition

Compose hooks to avoid deeply nested joins:

```typescript
export const useQ_PageDashboard_Organizations = () => {
    const qMe = useQ_Me();
    const orgIds = useMemo(() => qMe.user?.memberships?.map((m) => m.org_id) || [], [qMe.user]);
    const qOrgs = useQ_Tables_Organizations({ ids: orgIds });
    return { query: qMe.query, organizations: qOrgs.organizations };
};
```

## Mutation Hook Pattern

### Naming

**Hook:** `useM_[Scope]_[EntityAction]` | **Variable:** `m[EntityAction]` (drop scope)

**Actions:** Explicit suffix: `Create`, `Update`, `Delete`, `Upload`

### Create Pattern

```typescript
import { useMutation } from "@tanstack/react-query";

export type UseM_PageDashboard_ProjectCreate_Params = {
    organization_id: string;
    name: string;
    description?: string;
};

export const useM_PageDashboard_ProjectCreate = () => {
    const mutation = useMutation({
        mutationFn: async (body: UseM_PageDashboard_ProjectCreate_Params) => {
            // Data layer call — see your backend skill
            return await createProject(body);
        },
        onSuccess: () => {
            // User feedback — see your UI framework skill
        },
        onError: (error) => {
            console.error("Error creating project:", error);
            // User feedback — see your UI framework skill
        },
    });

    return { mutation };
};
```

### Update/Delete Pattern

Separates record ID (hook params) from mutable data (mutationFn params):

```typescript
export type UseM_PageDashboard_ProjectUpdate_Params = { projectId: string };
export type UseM_PageDashboard_ProjectUpdate_Body = Partial<{ name: string; description: string }>;

export const useM_PageDashboard_ProjectUpdate = ({ projectId }: UseM_PageDashboard_ProjectUpdate_Params) => {
    const mutation = useMutation({
        mutationKey: ["projects", "update", projectId],
        mutationFn: async (body: UseM_PageDashboard_ProjectUpdate_Body) => {
            // Data layer call — see your backend skill
            return await updateProject(projectId, body);
        },
        onSuccess: () => { /* feedback */ },
        onError: (error) => { console.error(error); /* feedback */ },
    });

    return { mutation };
};
```

| Aspect            | Create         | Update/Delete        |
| ----------------- | -------------- | -------------------- |
| Hook params       | None `()`      | Record ID `({ id })` |
| mutationFn params | Full body      | Only mutable fields  |
| Type exports      | `_Params` only | `_Params` + `_Body`  |
| mutationKey       | Generic        | Includes record ID   |

### mutate vs mutateAsync

- **`mutate`** — normal button clicks, fire-and-forget
- **`mutateAsync`** — when you need to await (modal confirmations, sequential operations)

## Error Handling

```typescript
// ❌ Logging twice
if (error) { console.error(error); throw error; }  // Logged here
onError: (error) => console.error(error);            // And here!

// ✅ Throw in mutationFn, let onError handle logging + feedback
if (error) throw error;
onError: (error) => { console.error(error); /* feedback */ };
```

## Anti-Patterns

| Wrong | Correct |
|---|---|
| Destructuring hooks | `const qEntity = useQ_*()` |
| `select("*")` in queries | Explicit column selection |
| Business logic in hooks | Move to components |
| Flattening/reshaping data | Return raw query.data |
| Verbose variable `qPageDashboard_Projects` | Short `qProjects` |
| Manual cache invalidation for realtime tables | Let realtime sync handle it (if applicable) |
| ID in mutationFn body | ID in hook params (for update/delete) |

## Onboarding

### Decisions
- Cache invalidation strategy: manual, realtime, or hybrid (project-specific)

### Scaffolding
Create QueryKeys factory:
- Path: `src/utils/query/queryKeys.ts`
- Template:

```typescript
export const QueryKeys = {
    // Add tables as your project grows:
    // projects: {
    //     all: () => ["projects"],
    //     list: () => [...QueryKeys.projects.all(), "list"],
    //     record: (id: string) => [...QueryKeys.projects.all(), id],
    // },
};
```

Create AtLeastOne utility type (for update body types):
- Path: `src/types/utility.types.ts`
- Template:

```typescript
export type AtLeastOne<T, U = { [K in keyof T]: Pick<T, K> }> = Partial<T> & U[keyof U];
```
