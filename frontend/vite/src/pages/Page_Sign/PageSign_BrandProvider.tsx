import type { ReactNode } from "react";
import { ConfigProvider } from "antd";

/**
 * Applies the sending organization's accent colour to the signing ceremony, and
 * to nothing else.
 *
 * ═══ WHY IT IS NESTED AND SCOPED ═══
 *
 * The app has ONE `ConfigProvider`, in `providers/antd/Provider_ANTD.tsx`.
 * Setting `colorPrimary` there would repaint the authenticated app in a
 * customer's colour — including, on a shared browser, whichever signing link was
 * opened last. This provider wraps ONLY the signing subtree, so the tenant's
 * colour reaches the ceremony and stops at its edge.
 *
 * `ConfigProvider` merges with the ancestor rather than replacing it, so every
 * other token — fonts, radii, the `Table` overrides — is inherited. This
 * overrides exactly one thing.
 *
 * ═══ A COLOUR IS A HINT, NEVER A GATE ═══
 *
 * `brand_color` arrives from an anonymous, unauthenticated endpoint and is
 * tenant-controlled. It is validated at the database (`#RRGGBB`, by CHECK) and
 * validated AGAIN here, because this component must never be the reason a signer
 * cannot sign. Anything that is not a plain six-digit hex is ignored and the
 * ceremony renders in the product's own palette — never blank, never broken.
 */

/** Mirrors `organizations_brand_color_check`. */
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export const PageSign_BrandProvider = ({
    brandColor,
    children,
}: {
    brandColor: string | null | undefined;
    children: ReactNode;
}) => {
    const accent = brandColor && HEX_COLOR.test(brandColor) ? brandColor : null;
    if (!accent) return <>{children}</>;

    return <ConfigProvider theme={{ token: { colorPrimary: accent } }}>{children}</ConfigProvider>;
};
