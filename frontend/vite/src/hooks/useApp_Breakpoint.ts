// One definition of "mobile" for the whole app.
//
// A thin wrapper over ANTD's `Grid.useBreakpoint()` rather than a `matchMedia`
// hook of our own: the breakpoints it reports are the same ones ANTD's own
// responsive props (`Descriptions`, `Table`, `Drawer`) use, so a component that
// mixes the two cannot disagree with itself about where the layout changes.
//
// `md` (768) is the mobile boundary. It is the widest screen on which the app
// shell's 240px sider plus a page's content still leaves an unusable canvas, and
// it is above every phone in portrait. `lg` (992) is where the multi-rail
// authoring surfaces start to have room.

import { Grid } from "antd";

export type App_Breakpoint = {
    /** Below `md` (768) — phones, and tablets in portrait. */
    isMobile: boolean;
    /** `md` to just below `lg` — one rail fits, two do not. */
    isTablet: boolean;
    /** `lg` (992) and up — the layout every page was originally drawn for. */
    isDesktop: boolean;
    /**
     * `xl` (1200) and up — room for a THIRD column beside a document.
     *
     * ADDITIVE, and `xl` rather than `lg` for a concrete reason (CG-049): the
     * desktop signing filler already owns a 260px "Your fields" rail, so at 992
     * a 380px assistant panel leaves the PDF about 330px — an unreadable
     * contract, which defeats the feature asking for the space.
     */
    isWide: boolean;
};

export const useApp_Breakpoint = (): App_Breakpoint => {
    const screens = Grid.useBreakpoint();

    return {
        isMobile: !screens.md,
        isTablet: !!screens.md && !screens.lg,
        isDesktop: !!screens.lg,
        isWide: !!screens.xl,
    };
};
