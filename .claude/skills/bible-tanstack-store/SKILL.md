---
name: bible-tanstack-store
description: Use when creating or modifying TanStack Store for global state management
---

# TanStack Store

Global state management using `@tanstack/react-store` with granular selectors.

## When to Use

- **TanStack Store** — Global app state (theme, prefs, cross-page state)
- **Provider Context** — Page/component-level state (see your provider skill)
- **TanStack Query** — Server state
- **useState** — Single component state

## Core Pattern

```typescript
import { Store, useStore, shallow } from "@tanstack/react-store";

// 1. State class with defaults
class State_App {
    theme: "light" | "dark" = "light";
    sidebarCollapsed: boolean = false;
    notifications: string[] = [];
}

// 2. Store instance
export const Store_App = new Store(new State_App());

// 3. Selectors — one per key (granular subscriptions)
export const useStore_App_Theme = () => useStore(Store_App, (s) => s.theme);
export const useStore_App_SidebarCollapsed = () => useStore(Store_App, (s) => s.sidebarCollapsed);
export const useStore_App_Notifications = () =>
    useStore(Store_App, (s) => s.notifications, { equal: shallow });

// 4. Actions
export const Store_App_Actions = {
    overwrite: (partial: Partial<State_App>) => Store_App.setState((s) => ({ ...s, ...partial })),
    notifications: {
        add: (msg: string) =>
            Store_App.setState((s) => ({ ...s, notifications: [...s.notifications, msg] })),
        remove: (msg: string) =>
            Store_App.setState((s) => ({
                ...s,
                notifications: s.notifications.filter((n) => n !== msg),
            })),
        clear: () => Store_App.setState((s) => ({ ...s, notifications: [] })),
    },
};
```

## Naming

| Entity        | Pattern                       | Example                              |
| ------------- | ----------------------------- | ------------------------------------ |
| State class   | `State_[Scope_Name]`          | `State_App`, `State_PageDashboard`   |
| Store         | `Store_[Scope_Name]`          | `Store_App`, `Store_PageDashboard`   |
| Selector hook | `useStore_[Scope_Name]_[Key]` | `useStore_App_Theme`                 |
| Actions       | `Store_[Scope_Name]_Actions`  | `Store_App_Actions`                  |
| File          | `Store_[Scope_Name].ts`       | `src/stores/Store_App.ts`            |

**Scope depth:** `App` (app-wide), `PageDashboard` (cross-subcomponent), `PageDashboard_Timeline` (feature-specific).

## Usage

```typescript
// Read (granular — only re-renders when this value changes)
const theme = useStore_App_Theme();

// Write — simple values via overwrite
Store_App_Actions.overwrite({ theme: "dark" });
Store_App_Actions.overwrite({ theme: "dark", sidebarCollapsed: true });

// Write — complex operations via nested handlers
Store_App_Actions.notifications.add("New message");
Store_App_Actions.notifications.clear();
```

## Selector Rules

| State Type     | Selector                                            |
| -------------- | --------------------------------------------------- |
| Primitives     | `useStore(store, (s) => s.key)`                     |
| Arrays/Objects | `useStore(store, (s) => s.key, { equal: shallow })` |

**MUST use `shallow`** for arrays/objects to prevent re-renders when reference changes but contents are equal.

## Action Rules

| Scenario              | Use                                 |
| --------------------- | ----------------------------------- |
| Simple value updates  | `overwrite({ key: value })`         |
| Multiple keys at once | `overwrite({ k1: v1, k2: v2 })`    |
| Array mutations       | Nested: `add`, `remove`, `clear`    |
| Boolean toggle        | Nested: `toggle`                    |
| Computed updates      | Nested handler with logic           |

## Location Rule

**ALL stores MUST live in `src/stores/Store_[Name].ts`** — never co-located with pages.

Stores are global singletons (any component can import without a provider). This is different from Provider Context, which is tree-scoped.

**If state is page-scoped and only needed by children** — use Provider Context instead.

## Anti-Patterns

| Wrong | Correct |
|---|---|
| `useStore(store, (s) => s)` (subscribe to all) | `useStore(store, (s) => s.specificKey)` |
| Array selector without `shallow` | Add `{ equal: shallow }` |
| Direct `Store.setState()` in components | Use `Store_Actions.overwrite()` |
| Nested state objects | Keep state flat |
| Store co-located with page/component | Always in `src/stores/` |
| Store without scope prefix | `Store_PageDashboard` not `Store_Dashboard` |

## Onboarding

### Decisions
None — pattern is universal.

### Scaffolding
Install: `pnpm add @tanstack/react-store`
