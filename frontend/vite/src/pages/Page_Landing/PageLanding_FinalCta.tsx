// The closing call to action — the conversion boundary restated as a choice.
//
// Two buttons, both live: try it free, or make an account to send. The thing to
// avoid here is a disabled "Send" that exists only to advertise a paywall; the
// send affordance is a signup link and it should read as one.

import { Button, Space, Typography, theme } from "antd";
import { Link } from "@tanstack/react-router";
import { PageLanding_Section } from "./PageLanding_Section";
import { const_Landing_FinalCta } from "./const_LandingContent";

export const PageLanding_FinalCta = () => {
    const { token } = theme.useToken();

    return (
        <PageLanding_Section centered tinted>
            <Typography.Title level={2} style={{ marginTop: 0, marginBottom: token.marginSM }}>
                {const_Landing_FinalCta.heading}
            </Typography.Title>
            <Typography.Paragraph
                type="secondary"
                style={{
                    fontSize: token.fontSizeLG,
                    maxWidth: 640,
                    margin: `0 auto ${token.marginXL}px`,
                }}
            >
                {const_Landing_FinalCta.subheading}
            </Typography.Paragraph>
            <Space size={token.marginSM} wrap style={{ justifyContent: "center" }}>
                <Link to="/try">
                    <Button type="primary" size="large">
                        {const_Landing_FinalCta.primaryCta}
                    </Button>
                </Link>
                <Link to="/signup">
                    <Button size="large">{const_Landing_FinalCta.secondaryCta}</Button>
                </Link>
            </Space>
        </PageLanding_Section>
    );
};
