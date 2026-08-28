// The landing page's footer (CG-052).
//
// It carries one link that is not decoration: "Verify a document" points at
// `/verify`, the product's other no-account page. Someone who has been sent a
// signed PDF and wants to check it can do that here without an account and
// without uploading anything — which is a stronger trust signal on this page
// than any sentence about security, because it is a thing they can do rather
// than a claim they have to accept.
//
// Legal links are PLAIN TEXT until those pages exist. A footer that links to
// four 404s is worse than one that links to none, and quietly shipping dead
// links is the kind of thing nobody notices until a customer does.

import { Link } from "@tanstack/react-router";
import { Divider, Space, Typography, theme } from "antd";
import { FileProtectOutlined } from "@ant-design/icons";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

export const App_MarketingFooter = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();

    // A router <Link> IS an anchor, so wrapping one around <Typography.Link>
    // nests <a> inside <a> — invalid HTML that React reports at runtime and
    // that browsers recover from by silently splitting the element. The link
    // colour is applied to the Link itself instead.
    const linkStyle = { fontSize: token.fontSizeSM, color: token.colorLink };

    return (
        <footer
            style={{
                borderTop: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                padding: `${token.paddingXL}px ${isMobile ? token.paddingMD : token.paddingLG}px`,
                paddingLeft: `calc(${
                    isMobile ? token.paddingMD : token.paddingLG
                }px + var(--app-safe-left))`,
                paddingRight: `calc(${
                    isMobile ? token.paddingMD : token.paddingLG
                }px + var(--app-safe-right))`,
                // The home indicator on a notched phone sits over the last row.
                paddingBottom: `calc(${token.paddingXL}px + var(--app-safe-bottom))`,
            }}
        >
            <div
                style={{
                    maxWidth: 1120,
                    margin: "0 auto",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: token.marginLG,
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                }}
            >
                <Space direction="vertical" size={token.marginXXS}>
                    <Space size={token.marginXS}>
                        <FileProtectOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
                        <Typography.Text strong>ContractGo</Typography.Text>
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        Electronic signatures with evidence you can stand behind.
                    </Typography.Text>
                </Space>

                <Space size={isMobile ? token.margin : token.marginXL} wrap align="start">
                    <Space direction="vertical" size={token.marginXXS}>
                        <Typography.Text strong style={{ fontSize: token.fontSizeSM }}>
                            Product
                        </Typography.Text>
                        <Link to="/try" style={linkStyle}>
                            Try signing
                        </Link>
                        <Link to="/verify" style={linkStyle}>
                            Verify a document
                        </Link>
                    </Space>

                    <Space direction="vertical" size={token.marginXXS}>
                        <Typography.Text strong style={{ fontSize: token.fontSizeSM }}>
                            Account
                        </Typography.Text>
                        <Link to="/signup" style={linkStyle}>
                            Create an account
                        </Link>
                        <Link to="/login" style={linkStyle}>
                            Log in
                        </Link>
                    </Space>

                    <Space direction="vertical" size={token.marginXXS}>
                        <Typography.Text strong style={{ fontSize: token.fontSizeSM }}>
                            Legal
                        </Typography.Text>
                        {/* Not links. See the header. */}
                        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            Terms of service
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            Privacy policy
                        </Typography.Text>
                    </Space>
                </Space>
            </div>

            <Divider style={{ maxWidth: 1120, margin: `${token.marginLG}px auto` }} />

            <Typography.Text
                type="secondary"
                style={{
                    display: "block",
                    maxWidth: 1120,
                    margin: "0 auto",
                    fontSize: token.fontSizeSM,
                }}
            >
                © {new Date().getFullYear()} ContractGo
            </Typography.Text>
        </footer>
    );
};
