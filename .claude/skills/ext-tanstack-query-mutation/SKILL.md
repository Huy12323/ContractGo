---
name: ext-tanstack-query-mutation
description: Project-specific QueryKeys factory (snake_case, typed, "record" sentinel) + hybrid realtime invalidation policy. Overrides the base's scaffolding template.
base: bible-tanstack-query-mutation
---

# TanStack Query & Mutation — Project Extensions

> Base skill: **bible-tanstack-query-mutation** — read it first for universal hook patterns (useQ*\* / useM*\* shape, no-destructuring, minimal processing principle).

## CRITICAL: Drop-in replacement for the base's scaffolding template

The base skill's "Scaffolding" section shows a camelCase, untyped `QueryKeys` template with `record(id)` returning `[domain, id]`. **This project uses a different shape.** When reading the base, ignore that template and use the factory below.

## QueryKeys Factory

```typescript
// src/utils/query/queryKeys.ts
import type { Database } from "@/types/database.types";

type TableName = keyof Database["public"]["Tables"];

const createTableFactory = <T extends TableName>(tableName: T) =>
    ({
        all: () => [tableName] as const,
        list: () => [tableName, "list"] as const,
        record: (id: string) => [tableName, "record", id] as const,
    }) as const;

export const QueryKeys = {
    admin_invitations: createTableFactory("admin_invitations"),
    // ... one entry per DB table
} satisfies Record<TableName, ReturnType<typeof createTableFactory<TableName>>>;
```

Three rules enforce realtime-compatibility:

1. **Domain keys are snake_case DB table names.** The realtime event payload carries `table_name: "onboarding_invitations"` — the predicate matches by string equality, no mapping layer.

2. **`record(id)` returns `[tableName, "record", id]` with a `"record"` sentinel.** Distinguishes list queries from record queries in the realtime predicate (see below).

3. **The factory is typed against `keyof Database["public"]["Tables"]`.** Every key in `QueryKeys` must match a real table. Adding a new table forces an explicit entry — no silent drift between the realtime event payload and the cache.

4. **The key STRING must equal the table name, and there is a test for it.** `src/utils/query/queryKeys.test.ts` iterates every entry and asserts `factory.all()` equals `[keyName]`. The `satisfies` clause cannot catch this: renaming a key's string while keeping the table valid still compiles, and `Provider_SupabaseRealtimeSync` matches events by string equality — so the drift silently unwires the event bus. A rename must update the factory **and** stay green in that test.

## No Custom Methods

The factory exposes only `all` / `list` / `record`. Domain-specific access patterns use the spread pattern from the base skill:

| Pattern                                  | Shape                                                              |
| ---------------------------------------- | ------------------------------------------------------------------ |
| "My items" (current user)                | `[...QueryKeys.organizations.list(), "mine"]`                      |
| Current user's profile                   | `QueryKeys.profiles.record(userId)` (via `useStore_Auth_User`)     |
| Filtered list by org                     | `[...QueryKeys.onboarding_invitations.list(), { organizationId }]` |
| Lookup by unique non-id key (e.g. token) | `QueryKeys.onboarding_invitations.record(token)`                   |
| Alternate DTO view of a record           | `[...QueryKeys.onboarding_invitations.record(token), "preview"]`   |

Resist adding `.mine()` / `.byToken()` / `.preview()` convenience methods — they scale linearly with tables and muddy the realtime predicate. The 5 spread patterns above cover every historical case.

## Realtime Cache Invalidation

`useSupabaseRealtimeSync` (at `src/hooks/useSupabaseRealtimeSync.ts`) subscribes to a single `realtime-sync` channel. Every INSERT on `public.realtime_table_events` fires `invalidateQueries` with this predicate:

```typescript
predicate: (query) => {
    const key = query.queryKey;
    const i = key.findIndex((s) => s === event.table_name);
    if (i === -1) return false;
    const marker = key[i + 1];
    if (marker === "list") return true; // all list shapes
    if (marker === "record") {
        const keyId = key[i + 2];
        return event.record_id === null || keyId === event.record_id;
    }
    return false;
};
```

Because the factory uses `"list"` and `"record"` sentinels, every queryKey declares its scope unambiguously. Spread shapes like `[...list(), { organizationId }]` still match because positions 0-1 are `[tableName, "list"]`.

## Hybrid Invalidation Policy

The base skill's anti-pattern table lists:

> Manual cache invalidation for realtime tables → Let realtime sync handle it (if applicable)

**This project chooses hybrid rather than "realtime replaces manual":**

- **Mutations keep their `queryClient.invalidateQueries(...)` calls.** Gives the user who performed the mutation instant single-tab feedback (~0 ms) without waiting for the realtime round-trip (~100-500 ms).
- **Realtime is additive.** Covers cross-tab and cross-user cases where the mutation's local invalidation cannot reach.

Don't remove existing mutation invalidation "because we have realtime now" — the two paths complement each other.

## Anti-Patterns (project-specific)

| Wrong                                                         | Correct                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| `QueryKeys.adminInvitations` (camelCase)                      | `QueryKeys.admin_invitations` (snake_case, matches DB)     |
| `record(id)` returning `[domain, id]`                         | `record(id)` returning `[domain, "record", id]`            |
| `QueryKeys.organizations.mine()` convenience                  | `[...QueryKeys.organizations.list(), "mine"]`              |
| `QueryKeys` typed as `Record<string, ...>`                    | `satisfies Record<TableName, ...>` (completeness enforced) |
| Removing mutation `invalidateQueries` because realtime exists | Keep both — hybrid is the chosen policy                    |
