---
name: bible-supabase-auth
description: Use when implementing authentication, session management, sign-out, or authorization checks using Supabase Auth
---

# Supabase Authentication

Authentication patterns using Supabase Auth for session management, sign-out, and authorization checks. Route guard integration is the Supabase side — see your router skill for the guard structure.

## Core Principles

1. **Supabase manages sessions** — never create custom auth stores
2. **Fresh session checks** — always use `supabase.auth.getSession()` (async)
3. **Route-level authentication** — security checks happen in route guards, not components
4. **Direct database queries** — use `supabase.from()` for authorization verification
5. **Components assume access** — if a component renders, the user is authorized

## Session Check & Route Guard

Always get a fresh session. The guard structure belongs to your router skill — this is the Supabase implementation:

```typescript
const sb_Auth_GetSession = await supabase.auth.getSession();
const session = sb_Auth_GetSession.data.session;

if (!session) {
    // Preserve redirect path for post-login navigation
    const redirectPath = `${location.pathname}${location.search ? `?${new URLSearchParams(location.search).toString()}` : ""}`;
    // Redirect to login with redirect param (router-specific mechanism)
}
```

## Authorization Checks

After confirming authentication, verify authorization with direct database queries:

### Membership Guard

```typescript
const sb_FromMembers_Select = await supabase
    .from("organization_members")
    .select("*")
    .eq("user_id", session.user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

if (!sb_FromMembers_Select.data) {
    // User is not a member — redirect to access denied
}
```

### Role/Permission Check

```typescript
const sb_FromMembers_Select = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", session.user.id)
    .eq("organization_id", organizationId)
    .single();

if (sb_FromMembers_Select.data?.role !== "admin") {
    // User lacks required role — redirect
}
```

### Profile Verification

```typescript
const sb_FromProfiles_Select = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", session.user.id)
    .single();

if (!sb_FromProfiles_Select.data?.is_active) {
    // Account not active — redirect
}
```

## Sign Out Pattern

```typescript
const handleSignOut = async () => {
    try {
        const sb_Auth_SignOut = await supabase.auth.signOut();
        if (sb_Auth_SignOut.error) throw sb_Auth_SignOut.error;

        // Success feedback (see your UI framework skill)
        // Navigate to login (see your router skill)
    } catch (error) {
        console.error("Error signing out:", error);
        // Error feedback (see your UI framework skill)
    }
};
```

## Auth State Listener

For reacting to auth changes (login, logout, token refresh):

```typescript
supabase.auth.onAuthStateChange((event, session) => {
    switch (event) {
        case "SIGNED_IN":
            // User logged in
            break;
        case "SIGNED_OUT":
            // User logged out — clear local state, redirect
            break;
        case "TOKEN_REFRESHED":
            // Session refreshed — no action needed
            break;
    }
});
```

## Anti-Patterns

| Wrong | Correct |
|---|---|
| Custom auth store/context | `supabase.auth.getSession()` |
| Cached session in React state | Fresh async check in route guard |
| Auth check in component body | Auth check in route guard only |
| `localStorage.getItem('session')` | `supabase.auth.getSession()` |
| Rendering protected UI then checking auth | Check auth first, render only on success |

## Onboarding

### Decisions
- Multi-tenant key column name: `organization_id` (default)
- Auth provider(s): email/password, OAuth, magic link (project-specific)
- Profile table structure: confirm fields needed

### Scaffolding
None — Supabase Auth is configured via Supabase dashboard. Route guards are implemented per your router skill.
