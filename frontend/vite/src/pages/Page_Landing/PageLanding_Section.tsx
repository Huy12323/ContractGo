// The shared shell every landing section renders through.
//
// EVERYTHING goes through this — hero included — so vertical rhythm, page width
// and safe-area padding are defined once and cannot drift between sections. A
// marketing page that grows a section at a time is exactly where per-section
// padding tends to accumulate until no two bands line up.
//
// It also owns the anchor target. The marketing layout scrolls a DIV rather than
// the document, so `href="#id"` does not work; sections are reached by calling
// `scrollIntoView` on a ref, and `scrollMarginTop` keeps the sticky nav from
// covering the heading it just scrolled to.

import { forwardRef, type ReactNode } from "react";
import { Typography, theme } from "antd";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { const_MarketingNav_Height } from "@/components/marketing/App_MarketingNav";

/** The page's content column. Wide enough for three cards, narrow enough to read. */
export const const_Landing_MaxWidth = 1120;

type Props = {
    id?: string;
    /** Small label above the heading. */
    eyebrow?: string;
    heading?: string;
    subheading?: string;
    /** A tinted band, used to separate adjacent sections without a rule. */
    tinted?: boolean;
    /** Hero and final CTA centre their headings; content sections do not. */
    centered?: boolean;
    background?: string;
    children?: ReactNode;
};

export const PageLanding_Section = forwardRef<HTMLElement, Props>(
    ({ id, eyebrow, heading, subheading, tinted, centered, background, children }, ref) => {
        const { token } = theme.useToken();
        const { isMobile } = useApp_Breakpoint();

        return (
            <section
                id={id}
                ref={ref}
                style={{
                    scrollMarginTop: const_MarketingNav_Height,
                    background: background ?? (tinted ? token.colorFillAlter : undefined),
                    padding: `${isMobile ? token.paddingXL : token.paddingXL * 2}px ${
                        isMobile ? token.paddingMD : token.paddingLG
                    }px`,
                    paddingLeft: `calc(${
                        isMobile ? token.paddingMD : token.paddingLG
                    }px + var(--app-safe-left))`,
                    paddingRight: `calc(${
                        isMobile ? token.paddingMD : token.paddingLG
                    }px + var(--app-safe-right))`,
                }}
            >
                <div
                    style={{
                        maxWidth: const_Landing_MaxWidth,
                        margin: "0 auto",
                        textAlign: centered ? "center" : undefined,
                    }}
                >
                    {eyebrow && (
                        <Typography.Text
                            style={{
                                display: "block",
                                color: token.colorPrimary,
                                fontSize: token.fontSizeSM,
                                letterSpacing: 0.6,
                                textTransform: "uppercase",
                                marginBottom: token.marginXS,
                            }}
                        >
                            {eyebrow}
                        </Typography.Text>
                    )}

                    {heading && (
                        <Typography.Title
                            level={2}
                            style={{
                                marginTop: 0,
                                marginBottom: subheading ? token.marginSM : token.marginLG,
                                fontSize: isMobile ? 28 : 36,
                            }}
                        >
                            {heading}
                        </Typography.Title>
                    )}

                    {subheading && (
                        <Typography.Paragraph
                            type="secondary"
                            style={{
                                fontSize: token.fontSizeLG,
                                marginBottom: token.marginXL,
                                maxWidth: centered ? 720 : 800,
                                marginInline: centered ? "auto" : undefined,
                            }}
                        >
                            {subheading}
                        </Typography.Paragraph>
                    )}

                    {children}
                </div>
            </section>
        );
    }
);

PageLanding_Section.displayName = "PageLanding_Section";
