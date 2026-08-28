// The section that has to earn the word "evidence".
//
// This is the difference between ContractGo and a PDF editor with a signature
// stamp, so it gets the most space and the most specific language: a hash chain,
// a certificate, PAdES, an OTP to the recipient's own mailbox. Every claim here
// maps to something the product does — do not add one that does not, because
// this is the section a sceptical buyer reads twice.
//
// It ends with a live link to `/verify` rather than a screenshot of it. A reader
// can check a signed PDF right now, without an account, which is a stronger
// argument than the six cards above it.

import { forwardRef } from "react";
import { Button, Space, Typography, theme } from "antd";
import { Link } from "@tanstack/react-router";
import { PageLanding_Section } from "./PageLanding_Section";
import { PageLanding_ItemGrid } from "./PageLanding_ItemGrid";
import { const_Landing_Evidence } from "./const_LandingContent";

export const PageLanding_Evidence = forwardRef<HTMLElement>((_props, ref) => {
    const { token } = theme.useToken();

    return (
        <PageLanding_Section
            ref={ref}
            id="evidence"
            eyebrow="Evidence"
            heading="A signature is only worth the record behind it"
            subheading="Anyone can flatten a picture of a signature onto a PDF. What makes an agreement hold up is being able to show who signed, how they proved it, and that nothing has changed since."
        >
            <PageLanding_ItemGrid items={const_Landing_Evidence} columns={3} />

            <Space
                size={token.marginSM}
                wrap
                style={{ marginTop: token.marginXL, alignItems: "center" }}
            >
                <Typography.Text type="secondary">
                    Been sent a signed document? Check it yourself — no account, and the file never
                    leaves your browser.
                </Typography.Text>
                <Link to="/verify">
                    <Button>Verify a document</Button>
                </Link>
            </Space>
        </PageLanding_Section>
    );
});

PageLanding_Evidence.displayName = "PageLanding_Evidence";
