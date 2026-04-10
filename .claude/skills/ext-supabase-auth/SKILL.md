---
name: ext-supabase-auth
description: Project-specific membership model and authorization checks — overrides the organization_members examples in the base skill
base: bible-supabase-auth
---

# Supabase Auth — Project Extensions

> Base skill: **bible-supabase-auth** — read it first for session checks, sign out, and auth state listener patterns.

## CRITICAL: This project does NOT use `organization_members`

The base skill's "Membership Guard" and "Role/Permission Check" sections show `supabase.from("organization_members")`. **That table does not exist in this project.** It was dropped in `supabase/migrations/20260402000000_redesign_org_membership.sql` as part of the membership redesign. Any new code that references `organization_members` will fail silently at runtime with a 403.

Use the patterns below instead.

## Project Membership Model

Three tables carry membership, one per role tier:

| Table | Purpose | Key columns |
|---|---|---|
| `organizations` | The org itself; owner is a single user | `id`, `owner_id` (uuid → auth.users) |
| `admins` | Users with admin (HR) role in an org | `user_id`, `organization_id` |
| `employees` | Rank-and-file employees in an org | `user_id`, `organization_id`, `email`, `first_name`, `last_name`, + custom columns |

Conceptually:
- **Owner** = `organizations.owner_id = auth.uid()`
- **Admin** = row in `admins` for `(user_id, organization_id)`
- **Employee** = row in `employees` for `(user_id, organization_id)`

A single user can be owner of one org and admin/employee of another. Owners are **not** also rows in `admins` — the check is "owner OR admin", never "admin only".

## SQL Helpers

Three `SECURITY DEFINER` functions defined in `supabase/migrations/20260406211234_rename_org_membership_tables.sql` abstract the role check. Call these from RLS policies, SQL functions, and SDK RPC calls — do not re-implement the joins.

```sql
public.is_org_member(org_id text) RETURNS boolean       -- owner OR admin OR employee
public.is_admin_or_owner(org_id text) RETURNS boolean   -- owner OR admin (the common HR-write gate)
public.get_organization_role(org_id text) RETURNS text  -- 'owner' | 'admin' | 'employee' | NULL
```

All three read `auth.uid()` internally — callers never pass the user id.

## Frontend Role Check (TanStack Query)

The canonical role-check hook calls the `get_organization_role` RPC:

```typescript
// src/hooks/useQ_Tables_MyRole.ts — already exists, use this
const qRole = useQ_Tables_MyRole({ organizationId });
if (qRole.role === 'owner') { /* owner-only UI */ }
if (qRole.role === 'admin' || qRole.role === 'owner') { /* HR UI */ }
```

Never query the `admins` or `employees` tables directly from the frontend to resolve a role — always go through `useQ_Tables_MyRole` or the RPC.

## Route Guards (TanStack Router `beforeLoad`)

For membership gates inside a `$organizationId` route, use the `get_my_member_organizations` RPC — it returns the full list in one round-trip and avoids per-route RPC calls:

```typescript
// src/routes/_protected/$organizationId/route.tsx — canonical reference
beforeLoad: async ({ params }) => {
    const sb_RpcGetMyMemberOrganizations = await supabase.rpc('get_my_member_organizations')
    if (sb_RpcGetMyMemberOrganizations.error) throw redirect({ to: '/' })
    const isMember = sb_RpcGetMyMemberOrganizations.data?.some(
        (org) => org.id === params.organizationId,
    )
    if (!isMember) throw redirect({ to: '/' })
},
```

Do NOT replace this with `supabase.from('employees').select().eq(...)` or similar — it bypasses the helper layer and duplicates logic that may change.

## Edge Function Admin-or-Owner Check

Edge functions use the service_role key and bypass RLS, so they must verify caller authorization explicitly. The canonical pattern is in `frontend/vite/supabase/functions/employee-management_create-column/index.ts:81-102`:

```typescript
const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("owner_id")
    .eq("id", organization_id)
    .single();

const isOwner = org?.owner_id === user.id;

let isAdmin = false;
if (!isOwner) {
    const { data: adminRow } = await supabaseAdmin
        .from("admins")
        .select("id")
        .eq("organization_id", organization_id)
        .eq("user_id", user.id)
        .maybeSingle();
    isAdmin = !!adminRow;
}

if (!isOwner && !isAdmin) {
    return jsonResponse({ error: "Forbidden — admin or owner role required" }, 403);
}
```

Rules:
- **Always check `owner_id` first** — a single row lookup on the org
- **Fall back to `admins`** only if not owner — `.maybeSingle()` returns null without erroring if no row
- **Never query `organization_members`** — the table does not exist
- **Never use `.single()` on the `admins` lookup** — non-admin callers are legitimate and should not throw

For edge functions that only need "is in this org at all" (not HR-gated), call the `is_org_member` SQL function via RPC instead of replicating the three-table check client-side.

## Anti-Patterns (Project-Specific)

| Wrong | Correct |
|---|---|
| `from("organization_members").select("role")` | `from("organizations").select("owner_id")` + fallback to `admins` lookup |
| `from("organization_members")` anywhere | Use the three tables: `organizations`, `admins`, `employees` |
| Hardcoding role strings other than `'owner' \| 'admin' \| 'employee'` | These are the only roles `get_organization_role` returns |
| Direct joins through admins + employees in app code | Use `is_org_member` / `is_admin_or_owner` SQL helpers |
| Component-level role check | Check in route `beforeLoad` via `get_my_member_organizations`, render from `useQ_Tables_MyRole` |
