import type { CSSProperties } from "react";

/**
 * The `width`/`style` pair that makes an ANTD `Modal` go near-fullscreen on a phone.
 *
 * Extracted rather than repeated because the failure mode is silent. `width: "100vw"`
 * on its own gives every phone a horizontal page scrollbar — ANTD's modal wrap adds
 * its own padding outside the width you set, so the content box ends up wider than
 * the viewport. The `maxWidth` clamp is what stops that, and it is exactly the part
 * a hand-copied version drops.
 *
 * `top: 8` rather than ANTD's default 100 because a dialog that starts a third of
 * the way down a 844px screen has nowhere to put its body once the keyboard opens.
 *
 * Returns props to spread: `<Modal {...Utils_Modal_Responsive(isMobile, 420)} …>`.
 * `isMobile` must come from `useApp_Breakpoint` — never from a `matchMedia` of your own.
 *
 * @param desktopWidth What the modal was already sized at. Omit to keep ANTD's 520 default.
 */
export const Utils_Modal_Responsive = (
    isMobile: boolean,
    desktopWidth?: number | string
): { width: number | string | undefined; style: CSSProperties | undefined } => ({
    width: isMobile ? "100vw" : desktopWidth,
    style: isMobile ? { top: 8, maxWidth: "calc(100vw - 16px)", margin: "0 auto" } : undefined,
});
