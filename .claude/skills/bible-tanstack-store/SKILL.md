---
name: bible-tanstack-store
description: Use when creating or modifying TanStack Store for global or per-instance state management
---

# TanStack Store

State management using `@tanstack/react-store` with granular selectors. Two scoping models: **global** (module-level singleton) and **per-instance** (factory + Context, for subtree-scoped state that must isolate across concurrent mounts).

## When to Use

- **Global Store** — Truly app-wide state (theme, prefs, cross-page state). Module-level singleton in `src/stores/`.
- **Per-Instance Store** — Page/subtree state with high-frequency narrow consumption (drag, keypress, click) that must isolate across concurrent Provider mounts (e.g., main UI + offscreen preview generator). Declared at the Provider (highest common parent) via `useState(() => new Store(init))`, exposed through Context, consumed via `useStore(pProvider.store, selector)`. Co-located with the Provider file (not in `src/stores/`).
- **Provider Context (alone)** — Stable instance values that don't churn (services, ref objects, callbacks).
- **TanStack Query** — Server state.
- **useState** — Single-component state.

**Rule:** *module singleton for app-global state; per-instance Store passed through Context for subtree-scoped state with granular subscriptions.* The Provider Context skill still handles low-frequency subtree values (init data, stable callbacks, ref objects). Reach for a per-instance Store inside a Provider when many consumers (~20+) read high-frequency state whose Context-value churn would re-render wastefully, or when the subtree must isolate across concurrent mounts.

## Global Pattern

```typescript
import { Store, useStore, shallow } from "@tanstack/react-store";

// 1. State class with defaults
class State_App {
    theme: "light" | "dark" = "light";
    sidebarCollapsed: boolean = false;
    notifications: string[] = [];
}

// 2. Store instance — module-level singleton
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

## Per-Instance Pattern

The Store is created lazily inside the Provider via `useState`, never as a module-level singleton. Consumers receive it via Context and pass it to selector hooks.

```typescript
// Store_PageDashboard.ts — co-located with the Provider
import { Store, useStore, shallow } from "@tanstack/react-store";

export class State_PageDashboard {
    selectedId: string = "";
    isDragging: boolean = false;
    dragHoverId: string | null = null;
    tags: string[] = [];
}

// Selectors take the store as an argument (per-instance, not module-level)
export const useStore_PageDashboard_SelectedId = (store: Store<State_PageDashboard>) =>
    useStore(store, (s) => s.selectedId);

export const useStore_PageDashboard_IsDragging = (store: Store<State_PageDashboard>) =>
    useStore(store, (s) => s.isDragging);

export const useStore_PageDashboard_Tags = (store: Store<State_PageDashboard>) =>
    useStore(store, (s) => s.tags, { equal: shallow });

// Actions factory — bound to a specific store instance
export const Store_PageDashboard_Actions = (store: Store<State_PageDashboard>) => ({
    overwrite: (partial: Partial<State_PageDashboard>) =>
        store.setState((s) => ({ ...s, ...partial })),
    setSelectedId: (id: string) => store.setState((s) => ({ ...s, selectedId: id })),
    clearSelection: () => store.setState((s) => ({ ...s, selectedId: "" })),
});
```

```typescript
// Provider_Page_Dashboard.tsx — instantiates the store and distributes it via Context
import React, { createContext, useState } from "react";
import { Store } from "@tanstack/react-store";
import { State_PageDashboard } from "./Store_PageDashboard";

type ProviderValue = {
    store: Store<State_PageDashboard>;
    // + stable services, refs, callbacks here (Context distribution layer)
};

const Context = createContext<ProviderValue | null>(null);

export const Provider_Page_Dashboard = ({ children }: { children: React.ReactNode }) => {
    // Lazy init — runs once per Provider mount, StrictMode-safe
    const [store] = useState(() => new Store(new State_PageDashboard()));
    return <Context.Provider value={{ store }}>{children}</Context.Provider>;
};

export const useProvider_Page_Dashboard = (): ProviderValue => {
    const ctx = React.useContext(Context);
    if (!ctx) throw new Error("useProvider_Page_Dashboard must be used inside Provider_Page_Dashboard");
    return ctx;
};
```

**Usage from children:**

```typescript
const pDashboard = useProvider_Page_Dashboard();
const selectedId = useStore_PageDashboard_SelectedId(pDashboard.store);
const actions = Store_PageDashboard_Actions(pDashboard.store);
actions.setSelectedId("abc");
```

Each Provider mount owns its own Store. Rendering two `<Provider_Page_Dashboard>` siblings produces two fully isolated state containers — no pollution, no key management.

## Naming

| Entity                | Pattern                        | Example                                                 |
| --------------------- | ------------------------------ | ------------------------------------------------------- |
| State class           | `State_[Scope_Name]`           | `State_App`, `State_PageDashboard`                      |
| Store (global)        | `Store_[Scope_Name]`           | `Store_App` (exported module singleton)                 |
| Store (per-instance)  | Held on Provider — no module binding | `pDashboard.store`                                |
| Selector hook         | `useStore_[Scope_Name]_[Key]`  | `useStore_App_Theme`, `useStore_PageDashboard_SelectedId` |
| Actions (global)      | `Store_[Scope_Name]_Actions`   | `Store_App_Actions` (plain object bound to singleton)   |
| Actions (per-instance)| `Store_[Scope_Name]_Actions`   | `Store_PageDashboard_Actions(store)` (factory fn)       |
| File (global)         | `src/stores/Store_[Name].ts`   | `src/stores/Store_App.ts`                               |
| File (per-instance)   | Co-located with Provider       | `src/pages/Page_Dashboard/Store_PageDashboard.ts`       |

**Scope depth:** `App` (app-wide), `PageDashboard` (cross-subcomponent), `PageDashboard_Timeline` (feature-specific). Same rules for both models.

## Location Rule

- **Global Store** → `src/stores/Store_[Name].ts`. Module-level singleton. Any component can import without a Provider.
- **Per-Instance Store** → co-located with its Provider (e.g., `src/pages/Page_Dashboard/Store_PageDashboard.ts`). The Store file exports the State class + selector hooks + Actions factory; the Provider file creates the instance via `useState` and distributes it via Context.

**Rule of thumb:** if the state must isolate across concurrent mounts of the same component tree, it's per-instance. Otherwise, if any component should read it without a Provider wrapper, it's global.

## Per-Instance Caveats

- **Guard lazy init with `useState(() => new Store(init))`**, never `new Store(init)` in the render body. The lazy initializer runs once per mount.
- **Keep the store reference stable** — pass the same instance through Context for the life of the Provider. Replacing the store mid-life is untested.
- **StrictMode double-invocation is safe** — the second Store is garbage-collected before any consumer subscribes.
- **Transitions** — `useStore` uses `useSyncExternalStore`, which de-opts `startTransition` to synchronous. Fine for drag/keypress/click. Avoid per-instance Store for state you explicitly want to defer with React transitions.
- **Object/array selectors require `{ equal: shallow }`** — identical rule to global Stores.
- **Escape hatch** — the per-instance factory+Context shape is API-identical to Zustand's documented `createStore`+Context pattern. If a TanStack Store bug blocks the pattern in future, migration is mechanical.

## Selector Rules

| State Type     | Selector                                            |
| -------------- | --------------------------------------------------- |
| Primitives     | `useStore(store, (s) => s.key)`                     |
| Arrays/Objects | `useStore(store, (s) => s.key, { equal: shallow })` |

**MUST use `shallow`** for arrays/objects — prevents re-renders when reference changes but contents are equal.

## Action Rules

| Scenario              | Use                              |
| --------------------- | -------------------------------- |
| Simple value updates  | `overwrite({ key: value })`      |
| Multiple keys at once | `overwrite({ k1: v1, k2: v2 })`  |
| Array mutations       | Nested: `add`, `remove`, `clear` |
| Boolean toggle        | Nested: `toggle`                 |
| Computed updates      | Nested handler with logic        |

Per-instance actions are created via a factory function bound to a specific store (`Store_[Name]_Actions(store)`); global actions are exported as a plain object bound to the module singleton.

## Anti-Patterns

| Wrong                                                                   | Correct                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| `useStore(store, (s) => s)` (subscribe to everything)                   | `useStore(store, (s) => s.specificKey)`             |
| Array/object selector without `shallow`                                 | Add `{ equal: shallow }`                            |
| Direct `Store.setState()` in components                                 | Use `Store_Actions.overwrite()` / action helper     |
| Nested state objects                                                    | Keep state flat                                     |
| Global store for subtree-isolated state (would pollute concurrent mounts) | Per-instance store via factory + Context           |
| Per-instance Store instantiated without `useState` lazy init            | `useState(() => new Store(init))`                   |
| Per-instance Store re-instantiated or swapped mid-life                  | One stable instance for the Provider's lifetime     |
| Map-keyed global store to fake per-instance scoping                     | Use the per-instance pattern directly               |
| Many consumers reading a `class State` via `setState(partial)` Context  | Migrate high-churn fields to a per-instance Store   |
| Store without scope prefix                                              | `Store_PageDashboard`, not `Store_Dashboard`        |

## Onboarding

### Decisions

None — pattern is universal.

### Scaffolding

Install: `pnpm add @tanstack/react-store`
