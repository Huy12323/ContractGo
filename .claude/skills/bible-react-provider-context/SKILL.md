---
name: bible-react-provider-context
description: Use when creating or modifying Provider Context components for local state management
---

# React Provider Context

Standard pattern for React Context providers using `class State + useReducer + setState(partial)`.

## When to Use

- Page-level state shared across subcomponents
- Component-level state in complex trees
- Parent-child/sibling communication without prop drilling
- **NOT for:** Global app state (use TanStack Store), server state (use TanStack Query), single component (use useState)

## Base Pattern

```typescript
import React, { createContext, useReducer } from "react";

class State {
    selectedId: string = "";
    isOpen: boolean = false;
    count: number = 0;
}

const ContextDefault: { state: State; setState: React.Dispatch<Partial<State>> } = {
    state: new State(),
    setState: () => {},
};

const Reducer = (state: State, partial: Partial<State>): State => ({ ...state, ...partial });
const Context = createContext(ContextDefault);

export const Provider_Page_Dashboard = ({ children }: { children: React.ReactNode }) => {
    const [state, setState] = useReducer(Reducer, new State());
    return <Context.Provider value={{ state, setState }}>{children}</Context.Provider>;
};

export const useProvider_Page_Dashboard = () => React.useContext(Context);
```

**Components:** State class (defaults) → ContextDefault (`Partial<State>`) → one-line Reducer → Provider (`useReducer`) → Hook (`useContext`)

## Naming

| Type     | Pattern               | Variable       |
| -------- | --------------------- | -------------- |
| Provider | `Provider_[Name]`     | —              |
| Hook     | `useProvider_[Name]`  | `p[Name]`      |

## Usage

```typescript
const pDashboard = useProvider_Page_Dashboard();
pDashboard.setState({ selectedId: "123" });                      // Single property
pDashboard.setState({ selectedId: "123", isOpen: true });        // Multiple
pDashboard.setState({ isOpen: !pDashboard.state.isOpen });       // Toggle
```

## initialState Extension

For initializing from props (e.g., route params):

```typescript
export const Provider_Page_Dashboard = ({
    children,
    initialState,
}: {
    children: React.ReactNode;
    initialState?: Partial<State>;
}) => {
    const [state, setState] = useReducer(
        Reducer,
        initialState ? { ...new State(), ...initialState } : new State(),
    );
    return <Context.Provider value={{ state, setState }}>{children}</Context.Provider>;
};

// Usage
<Provider_Page_Dashboard initialState={{ selectedId: routeParam }}>
```

## Scope Guidelines

- **Page-level:** Wrap at page root. Shared across subcomponents, persists across sub-mounts.
- **Component-level:** Wrap at component root. Only needed in subtree, resets on unmount.

**Move UP** when: siblings need access, parent needs to react, persist across unmounts.
**Move DOWN** when: single subtree uses it, implementation detail, should reset on unmount.

## Anti-Patterns

| Wrong | Correct |
|---|---|
| useState + individual setters | useReducer + setState(partial) |
| Deep nested state objects | Flat state: `modalIsOpen`, `panelIsCollapsed` |
| Default exports | Named exports only |
| Custom setter functions per key | Single `setState({ key: value })` |

**Why useReducer + partial:** Consistent API, no useCallback overhead, easy to extend (just add to State class), type-safe partial updates.

## Onboarding

### Decisions
None — pattern is universal.

### Scaffolding
None — providers are created per-feature as needed.
