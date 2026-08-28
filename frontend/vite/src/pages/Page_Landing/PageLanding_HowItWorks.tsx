// Three numbered steps: prepare, send, sign.
//
// Numbered rather than iconed — this is the one section where ORDER is the
// information, and an icon grid reads as a feature list where a reader is
// looking for a sequence.

import { forwardRef } from "react";
import { Typography, theme } from "antd";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { PageLanding_Section } from "./PageLanding_Section";
import { const_Landing_HowItWorks } from "./const_LandingContent";

export const PageLanding_HowItWorks = forwardRef<HTMLElement>((_props, ref) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();

    return (
        <PageLanding_Section
            ref={ref}
            id="how-it-works"
            tinted
            eyebrow="How it works"
            heading="From a PDF to a signed agreement"
        >
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
                    gap: token.marginLG,
                }}
            >
                {const_Landing_HowItWorks.map((step, index) => (
                    <div key={step.title}>
                        <div
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: "50%",
                                background: token.colorPrimary,
                                color: token.colorTextLightSolid,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontWeight: 700,
                                marginBottom: token.marginSM,
                            }}
                        >
                            {index + 1}
                        </div>
                        <Typography.Title
                            level={5}
                            style={{ marginTop: 0, marginBottom: token.marginXXS }}
                        >
                            {step.title}
                        </Typography.Title>
                        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            {step.body}
                        </Typography.Paragraph>
                    </div>
                ))}
            </div>
        </PageLanding_Section>
    );
});

PageLanding_HowItWorks.displayName = "PageLanding_HowItWorks";
