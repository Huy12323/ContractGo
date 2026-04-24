---
name: bible-react-naming
description: Use when creating or naming pages, components, stores, hooks, routes, or utilities
---

# React Naming Conventions

Strict naming conventions for all frontend code entities. NO default exports — always `export const`.

## Directory Structure

```
src/
├── pages/              Page components
├── components/         Shared UI components (UI_*, App_*)
├── hooks/              Shared hooks (useQ_*, useM_*)
├── stores/             TanStack stores (ALWAYS here, never co-located)
├── providers/          App-level providers
├── services/           Global singleton services
├── utils/              Global utilities (Utils_*)
├── types/              Type definitions
├── configs/            Config files (supabase, etc.)
└── routes/             TanStack Router route files
```

## Pages

**Pattern:** `Page_[Name]` — folder and file match.

```
src/pages/Page_Dashboard/Page_Dashboard.tsx
```

```tsx
export const Page_Dashboard = () => <div>Dashboard</div>;
```

## Subcomponents (Page-Specific)

**Pattern:** `Page[Name]_[ComponentName]` (remove underscore after "Page")

```tsx
PageDashboard_Header      // ✅ Correct
Page_Dashboard_Header     // ❌ Extra underscore
Dashboard_Header          // ❌ Missing "Page" prefix
```

**Folder:** `src/pages/Page_Dashboard/PageDashboard_Header/PageDashboard_Header.tsx`

### Three-Level Nesting

When a subcomponent is ONLY used by another subcomponent:

```tsx
PageDashboard_ProjectList_ProjectCard   // Used only by ProjectList
```

## Custom Shared Components

**Pattern:** `App_[Name]` (configurable prefix — default `App_`, your project may use a different prefix)

```tsx
export const App_Switch = () => { ... };    // Shared custom component
export const App_Modal = () => { ... };     // Shared modal wrapper
```

**Modal suffix** appends directly (no underscore before Modal):
```tsx
App_AssetManagerModal     // ✅ Correct
App_AssetManager_Modal    // ❌ Wrong
```

## UI Components (Pure, Reusable)

**Pattern:** `UI_[Name]` — pure, no external context, ANTD-based.

```tsx
// src/components/UI_HorizontalNav/UI_HorizontalNav.tsx
export const UI_HorizontalNav = () => <nav>...</nav>;
```

## Stores (TanStack Store)

**Pattern:** `Store_[Scope_Name]`

**Location depends on store scope** (see `bible-tanstack-store` for the full global vs per-instance pattern):

- **Global stores** (module-level singletons): `src/stores/Store_[Name].ts`. Any component may import without a Provider wrapper.
- **Per-instance stores** (subtree-scoped via factory + Context): co-located with the Provider that owns them — e.g., `src/pages/Page_Dashboard/Store_PageDashboard.ts` alongside `Provider_Page_Dashboard.tsx`. The Store file exports the State class + selector hooks + Actions factory; the Provider file instantiates via `useState(() => new Store(init))` and distributes through Context.

Rule of thumb: if the state must isolate across concurrent mounts of the same component tree, it's per-instance (co-located). Otherwise, if any component should read it without a Provider wrapper, it's global (`src/stores/`).

```tsx
// Global — src/stores/Store_App.ts
export const Store_App = new Store(new State_App());
export const useStore_App_Theme = () => useStore(Store_App, (s) => s.theme);

// Per-instance — src/pages/Page_Dashboard/Store_PageDashboard.ts
export class State_PageDashboard { selectedId: string = ""; }
export const useStore_PageDashboard_SelectedId = (store: Store<State_PageDashboard>) =>
    useStore(store, (s) => s.selectedId);
```

**Scope depth:** `App` (app-wide), `PageDashboard` (cross-subcomponent), `PageDashboard_Timeline` (feature-specific). Same naming for both models.

## Services (Singleton Classes)

**Use for:** Platform APIs, binary caches, RAF loop data — NOT React state.

**Pattern:** `service_[Scope]_[Name]` | **Variable:** `s[Name]`

| Entity    | Pattern                             | Example                           |
| --------- | ----------------------------------- | --------------------------------- |
| File      | `service_[Scope]_[Name].ts`         | `service_PageEditor_WebAudio.ts`  |
| Class     | `Service_[Scope]_[Name]_Class`      | `Service_PageEditor_WebAudio_Class` |
| Singleton | `service_[Scope]_[Name]`            | `service_PageEditor_WebAudio`     |
| Types     | `Service_[Scope]_[Name]_[TypeName]` | `Service_PageEditor_WebAudio_ClipData` |

**Location:** Co-locate at closest common parent. If multiple pages → `src/services/`.

## Query Hooks

**Hook:** `useQ_[Scope]_[Entity]` | **Variable:** `q[Entity]` (drop scope prefix)

Scope MUST match folder/subcomponent hierarchy:

```tsx
// File: Page_Dashboard/useQ_PageDashboard_Projects.ts
export const useQ_PageDashboard_Projects = () => { ... };

// File: Page_Dashboard/PageDashboard_Sidebar/useQ_PageDashboard_Sidebar_Tags.ts
export const useQ_PageDashboard_Sidebar_Tags = () => { ... };
```

**Variable naming:**
```tsx
const qProjects = useQ_PageDashboard_Projects();    // ✅ Short
const qPageDashboard_Projects = ...;                 // ❌ Verbose
const { query, projects } = ...;                     // ❌ Never destructure
```

## Mutation Hooks

**Hook:** `useM_[Scope]_[EntityAction]` | **Variable:** `m[EntityAction]`

Same scope hierarchy as Query Hooks.

```tsx
const mProjectCreate = useM_PageDashboard_ProjectCreate();
mProjectCreate.mutation.mutate({ name: "New" });
```

## Junction/Relation Table Hooks

**Pattern:** `$Table1$Table2$Relation` — use actual table names, NOT invented entity names.

```tsx
useQ_PageDashboard_$Files$Tags$Relation           // ✅ Actual table names
useM_PageDashboard_$Files$Tags$RelationCreate     // ✅
useQ_PageDashboard_FileTags                        // ❌ Invented name
```

## Provider Hooks

**Hook:** `useProvider_[Name]` | **Variable:** `p[Name]`

```tsx
const pDashboard = useProvider_Page_Dashboard();
pDashboard.state.selectedId;
pDashboard.setState({ selectedId: "123" });
```

## Hotkey Hooks

**Pattern:** `useHotkeys_[ComponentName]` — co-located, side-effect only (no return).

```tsx
// File: useHotkeys_PageDashboard.ts
export const useHotkeys_PageDashboard = () => {
    useHotkeys("escape", () => clearSelection(), { enableOnFormTags: true });
};
```

## Routes (TanStack Router)

```
src/routes/__root.tsx                            // Root layout
src/routes/_protected.tsx                        // Protected layout
src/routes/_protected/$organizationId.tsx        // Dynamic param
src/routes/login.tsx                             // Public route
```

## Utility Functions

| Scope      | When                               | Pattern                   | Location              |
| ---------- | ---------------------------------- | ------------------------- | --------------------- |
| Global     | Cross-domain (auth + data, etc.)   | `Utils_[Category]_[Name]` | `src/utils/`          |
| Domain     | 2+ consumers under common parent   | `utils_[Scope]_[Name]`    | Closest common parent |
| Single-use | One consumer                       | `const camelCase`         | Inline in consumer    |

## Constants

**Pattern:** `const_[Scope]_[Name]` — extract when shared or large.

```typescript
// Extract — used by multiple files or large value
export const const_PageDashboard_HeaderHeight = 48;
export const const_PageDashboard_ZoomLevels = [0.5, 1, 2, 4] as const;

// Inline — small, single-use
const PADDING = 8;
```

| Condition                 | Action                     |
| ------------------------- | -------------------------- |
| Used in ONE file + small  | Inline `const` in consumer |
| Used in MULTIPLE files    | Extract to `const_` file   |
| Large value (single-use)  | Extract to `const_` file   |

## Anti-Patterns

| Wrong | Correct |
|---|---|
| `export default` | `export const` only |
| `const { query } = useQ_*()` | `const qEntity = useQ_*()` |
| `useOrganizations()` | `useQ_PageDashboard_Organizations()` |
| Scope missing subcomponent segment | `useQ_Page_Sub_Entity` not `useQ_Page_Entity` |
| Store without scope | `Store_PageDashboard` not `Store_Dashboard` |
| Global store co-located with a page | Global stores live in `src/stores/` |
| Per-instance store dumped in `src/stores/` | Per-instance stores co-locate with their Provider — see `bible-tanstack-store` |
| Single-function hook | Inline logic in consumer |
| `SCREAMING_SNAKE` for constants | `const_[Scope]_PascalName` |
| Invented junction entity name | Use actual table names with `$` |

## Onboarding

### Decisions
- Custom shared component prefix: `App_` (default) — your project may use a different prefix (e.g., `Spark_`, `Nova_`)
- Import alias: `@/` (default)
