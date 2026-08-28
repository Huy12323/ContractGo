// The developer section.
//
// A distinct buyer deserves distinct proof, and for this one the proof is a
// request they can read. The snippet is a plain `<pre>` with a static string —
// NO syntax-highlighting library. Adding one would put a parser and a theme in
// the bundle of the page whose whole performance argument is that it is small,
// to colour six lines nobody copy-pastes from a marketing page.

import { forwardRef } from "react";
import { Typography, theme } from "antd";
import { CheckCircleFilled } from "@ant-design/icons";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { PageLanding_Section } from "./PageLanding_Section";
import { const_Landing_Developers } from "./const_LandingContent";

export const PageLanding_Developers = forwardRef<HTMLElement>((_props, ref) => {
    const { token } = theme.useToken();
    const { isDesktop } = useApp_Breakpoint();

    return (
        <PageLanding_Section
            ref={ref}
            id="developers"
            eyebrow="For developers"
            heading={const_Landing_Developers.heading}
            subheading={const_Landing_Developers.subheading}
        >
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: isDesktop ? "0.9fr 1.1fr" : "1fr",
                    gap: token.marginXL,
                    alignItems: "start",
                }}
            >
                <div>
                    {const_Landing_Developers.bullets.map((bullet) => (
                        <div
                            key={bullet}
                            style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: token.marginXS,
                                marginBottom: token.marginSM,
                            }}
                        >
                            <CheckCircleFilled
                                style={{ color: token.colorSuccess, marginTop: 4 }}
                            />
                            <Typography.Text type="secondary">{bullet}</Typography.Text>
                        </div>
                    ))}
                </div>

                <pre
                    style={{
                        margin: 0,
                        background: token.colorBgContainer,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        borderRadius: token.borderRadiusLG,
                        padding: token.paddingMD,
                        fontSize: token.fontSizeSM,
                        lineHeight: 1.6,
                        // The snippet is wider than a phone. It scrolls INSIDE its
                        // own box; letting it widen the page would give the whole
                        // landing a horizontal scrollbar.
                        overflowX: "auto",
                        fontFamily: token.fontFamilyCode,
                    }}
                >
                    <code>{const_Landing_Developers.snippet}</code>
                </pre>
            </div>
        </PageLanding_Section>
    );
});

PageLanding_Developers.displayName = "PageLanding_Developers";
