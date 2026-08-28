// The hero, and with it the trial card.
//
// The background is `BG_GRADIENT` — the same value `Provider_ANTD` exports and
// the auth screens already use. No new asset, no image to download, and the
// landing page looks like the product from the first paint rather than like a
// separate site that happens to share a logo.

import { Button, Space, Typography, theme } from "antd";
import { Link } from "@tanstack/react-router";
import { BG_GRADIENT } from "@/providers/antd/Provider_ANTD";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { PageLanding_Section } from "./PageLanding_Section";
import { PageLanding_TrialCard } from "./PageLanding_TrialCard";
import { const_Landing_Hero } from "./const_LandingContent";

type Props = {
    /** Scrolls to the "How it works" section. */
    onSeeHowItWorks: () => void;
};

export const PageLanding_Hero = ({ onSeeHowItWorks }: Props) => {
    const { token } = theme.useToken();
    const { isMobile, isDesktop } = useApp_Breakpoint();

    return (
        <PageLanding_Section background={BG_GRADIENT}>
            <div
                style={{
                    display: "grid",
                    // One column below `lg`: the trial card is the primary call to
                    // action and belongs directly under the pitch on a phone, not
                    // squeezed beside it.
                    gridTemplateColumns: isDesktop ? "1.1fr 0.9fr" : "1fr",
                    gap: isDesktop ? token.marginXL * 2 : token.marginXL,
                    alignItems: "center",
                }}
            >
                <div>
                    <Typography.Text
                        style={{
                            display: "block",
                            color: token.colorPrimary,
                            fontSize: token.fontSizeSM,
                            letterSpacing: 0.6,
                            textTransform: "uppercase",
                            marginBottom: token.marginSM,
                        }}
                    >
                        {const_Landing_Hero.eyebrow}
                    </Typography.Text>

                    <Typography.Title
                        level={1}
                        style={{
                            marginTop: 0,
                            marginBottom: token.margin,
                            fontSize: isMobile ? 34 : 52,
                            lineHeight: 1.12,
                        }}
                    >
                        {const_Landing_Hero.heading}
                    </Typography.Title>

                    <Typography.Paragraph
                        type="secondary"
                        style={{
                            fontSize: token.fontSizeLG,
                            maxWidth: 620,
                            marginBottom: token.marginXL,
                        }}
                    >
                        {const_Landing_Hero.subheading}
                    </Typography.Paragraph>

                    <Space size={token.marginSM} wrap>
                        <Link to="/try">
                            <Button type="primary" size="large">
                                {const_Landing_Hero.primaryCta}
                            </Button>
                        </Link>
                        <Button size="large" onClick={onSeeHowItWorks}>
                            {const_Landing_Hero.secondaryCta}
                        </Button>
                    </Space>
                </div>

                <PageLanding_TrialCard />
            </div>
        </PageLanding_Section>
    );
};
