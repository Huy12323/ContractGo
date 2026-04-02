---
name: bible-tanstack-router
description: Use when creating or modifying routes, route guards, layout routes, or navigation with TanStack Router
---

# TanStack Router

File-based routing with TanStack Router — route naming, guards, params, layout routes, and navigation.

## File-Based Routing Structure

```
src/routes/
├── __root.tsx                    # Root layout (double underscore)
├── _protected.tsx                # Layout route (single underscore, pathless)
├── _protected/
│   ├── index.tsx                 # URL: /
│   └── $organizationId.tsx       # URL: /$organizationId (dynamic param)
├── _auth.tsx                     # Layout route for auth pages
├── _auth/
│   ├── login.tsx                 # URL: /login (not /_auth/login)
│   └── signup.tsx                # URL: /signup
└── not-found.tsx                 # Standalone public route
```

**Naming rules:**
- **Root route:** `__root.tsx` (double underscore)
- **Layout routes:** `_` prefix (pathless — no URL segment)
- **Dynamic params:** `$paramName` syntax
- **Index routes:** `index.tsx` within folder

## Route Guards with beforeLoad

Use `beforeLoad` for authentication and authorization — never component-level checks.

```tsx
export const Route = createFileRoute("/_protected")({
    beforeLoad: async ({ location }) => {
        // Authentication check — see your auth skill for implementation
        const session = await getSession();

        if (!session) {
            // Preserve redirect path for post-login UX
            const redirectPath = `${location.pathname}${location.search ? `?${new URLSearchParams(location.search).toString()}` : ""}`;
            throw redirect({ to: "/login", search: { redirect: redirectPath } });
        }

        // Authorization checks (membership, role, etc.) — see your auth skill
    },
    component: ProtectedLayout,
});
```

## Dynamic Param Routes

```tsx
export const Route = createFileRoute("/_protected/$organizationId")({
    beforeLoad: async ({ params }) => {
        const { organizationId } = params;
        // Verify membership — see your auth skill
        const membership = await checkMembership(organizationId);
        if (!membership) throw redirect({ to: "/access-denied" });
    },
    component: Page_Dashboard,
});
```

## Extracting Route Params

**ALWAYS use the `from` option for type safety:**

```typescript
// ✅ Full type safety
const { organizationId } = useParams({
    from: "/_protected/$organizationId",
});

// ❌ Loses type safety
const { organizationId } = useParams({ strict: false }) as { organizationId: string };
```

## Public Routes with Redirect

```tsx
const LoginSearchSchema = z.object({
    redirect: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_auth/login")({
    validateSearch: LoginSearchSchema.parse,
    beforeLoad: async ({ search }) => {
        const session = await getSession();
        if (session) throw redirect({ to: search.redirect || "/" });
    },
    component: Page_Login,
});
```

## Layout Routes

Layout routes wrap child routes with shared UI (nav, sidebar, theme). They use the `_` prefix convention and render children via `<Outlet />`.

**CRITICAL:** Never use wrapper components for shared layouts. If 2+ routes share a visual frame, it MUST be a layout route.

### Layout Route File

```tsx
// src/routes/_auth.tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth")({
    component: AuthLayout,
});

function AuthLayout() {
    return (
        <div style={{ /* shared layout styles */ }}>
            {/* Shared UI: sidebars, navs, decorations */}
            <Outlet /> {/* Child route renders here */}
        </div>
    );
}
```

Child routes become pure content — no layout wrapping.

### When to Create a Layout Route

**Create when:** 2+ routes share a visual wrapper, routes need a common guard, or pages need a shared container.

**Don't create when:** Only one page uses it (inline in page) or it's just a provider (put in `__root.tsx`).

### Height Contract

Layout routes define the container size; child pages use relative heights:

```tsx
// Layout provides sized container
function ProtectedLayout() {
    return (
        <div style={{ height: "calc(100vh - navHeight)" }}>
            <Outlet />
        </div>
    );
}

// Page uses height: 100% — NEVER recalculate viewport
function Page_Dashboard() {
    return <div style={{ height: "100%" }}>{/* content */}</div>;
}
```

## Route Tree Regeneration

After creating or moving route files, the route tree auto-regenerates during dev server. The generated `routeTree.gen.ts` is auto-managed — never edit manually.

## Anti-Patterns

| Wrong | Correct |
|---|---|
| `_root.tsx` (single underscore) | `__root.tsx` (double) |
| `:paramName` or `{paramName}` | `$paramName` |
| Component-level auth checks | `beforeLoad` guard |
| Cache-based security decisions | Direct database query in guard |
| No redirect path preservation | Pass `location.pathname` as search param |
| `useParams({ strict: false })` | `useParams({ from: '/path/$param' })` |
| Wrapper components for shared layouts | Layout routes with `<Outlet />` |
| Layout without `<Outlet />` | Always include `<Outlet />` for child rendering |
| `createFileRoute("/login")` for `_auth/login.tsx` | `createFileRoute("/_auth/login")` |

## Onboarding

### Decisions
None — TanStack Router file-based routing is the standard.

### Scaffolding
Install: `pnpm add @tanstack/react-router`

Create root route:
- Path: `src/routes/__root.tsx`
- Template:

```tsx
import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
    component: () => <Outlet />,
});
```
