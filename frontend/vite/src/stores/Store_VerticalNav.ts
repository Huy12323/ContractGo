import { Store, useStore } from "@tanstack/react-store";

class State_VerticalNav {
    collapsed: boolean = false;
}

export const Store_VerticalNav = new Store(new State_VerticalNav());

// Selectors
export const useStore_VerticalNav_Collapsed = () => useStore(Store_VerticalNav, (s) => s.collapsed);

// Actions
export const Store_VerticalNav_Actions = {
    overwrite: (partial: Partial<State_VerticalNav>) =>
        Store_VerticalNav.setState((s) => ({ ...s, ...partial })),
    toggle: () =>
        Store_VerticalNav.setState((s) => ({ ...s, collapsed: !s.collapsed })),
    setCollapsed: (collapsed: boolean) =>
        Store_VerticalNav.setState((s) => ({ ...s, collapsed })),
};
