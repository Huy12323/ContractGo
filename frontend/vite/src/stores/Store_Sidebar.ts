import { Store, useStore } from "@tanstack/react-store";

class State_Sidebar {
    collapsed: boolean = false;
}

export const Store_Sidebar = new Store(new State_Sidebar());

// Selectors
export const useStore_Sidebar_Collapsed = () => useStore(Store_Sidebar, (s) => s.collapsed);

// Actions
export const Store_Sidebar_Actions = {
    overwrite: (partial: Partial<State_Sidebar>) =>
        Store_Sidebar.setState((s) => ({ ...s, ...partial })),
    toggle: () =>
        Store_Sidebar.setState((s) => ({ ...s, collapsed: !s.collapsed })),
    setCollapsed: (collapsed: boolean) =>
        Store_Sidebar.setState((s) => ({ ...s, collapsed })),
};
