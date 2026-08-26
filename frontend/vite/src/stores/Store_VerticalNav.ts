import { Store, useStore } from "@tanstack/react-store";

class State_VerticalNav {
    /**
     * DESKTOP ONLY — the sider is narrow (icons) rather than wide (icons +
     * labels). The nav is always on screen either way.
     */
    collapsed: boolean = false;
    /**
     * MOBILE ONLY — the nav is a drawer, and this is whether it is showing.
     *
     * A SECOND flag rather than a re-reading of `collapsed`, because the two mean
     * opposite things at rest: a desktop nav defaults to visible-and-expanded
     * (`collapsed: false`), a mobile drawer defaults to closed. Sharing one
     * boolean would either open the drawer over the page on every cold load, or
     * start the desktop sider collapsed to make the drawer behave.
     */
    mobileOpen: boolean = false;
}

export const Store_VerticalNav = new Store(new State_VerticalNav());

// Selectors
export const useStore_VerticalNav_Collapsed = () => useStore(Store_VerticalNav, (s) => s.collapsed);
export const useStore_VerticalNav_MobileOpen = () =>
    useStore(Store_VerticalNav, (s) => s.mobileOpen);

// Actions
export const Store_VerticalNav_Actions = {
    overwrite: (partial: Partial<State_VerticalNav>) =>
        Store_VerticalNav.setState((s) => ({ ...s, ...partial })),
    toggle: () => Store_VerticalNav.setState((s) => ({ ...s, collapsed: !s.collapsed })),
    setCollapsed: (collapsed: boolean) => Store_VerticalNav.setState((s) => ({ ...s, collapsed })),
    toggleMobile: () => Store_VerticalNav.setState((s) => ({ ...s, mobileOpen: !s.mobileOpen })),
    setMobileOpen: (mobileOpen: boolean) =>
        Store_VerticalNav.setState((s) => ({ ...s, mobileOpen })),
};
