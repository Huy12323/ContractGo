import { Typography, theme } from "antd";
import type { Signing_Session } from "@/hooks/useQ_Signing_Session";

/**
 * Who sent this document — logo and organization name, above the ceremony.
 *
 * ═══ WHY THIS EXISTS ═══
 *
 * Before CG-050 the signing page showed NO sender identity whatsoever: the
 * session payload carried none. A counterparty opening a contract could not tell
 * at a glance whether it came from the firm they were expecting, and "is this
 * real?" is the question that stops a signature.
 *
 * ═══ WHY IT LIVES ON THE WELCOME SCREEN AND NOT THE DOCUMENT PANE ═══
 *
 * `Page_Sign`'s header row is a single flex line holding the step indicator and
 * the CG-049 assistant trigger, already tight enough at 390px that the steps
 * degrade to `progressDot`. Adding a sender block there would compete with a
 * document pane that has no width to spare. The welcome screen is a plain 640px
 * content column that the signer reads once, before signing — which is exactly
 * when "who is this from" matters and exactly where there is room to answer it.
 *
 * ═══ IT MUST NEVER GATE ANYTHING ═══
 *
 * Every field is optional and every absence is normal — an older payload, an
 * organization with no logo, a logo whose image fails to load. It renders
 * nothing at all rather than an empty frame, and the ceremony below is
 * unaffected either way.
 */
export const PageSign_SenderHeader = ({ branding }: { branding: Signing_Session["branding"] }) => {
    const { token } = theme.useToken();

    const orgName = branding?.org_name?.trim();
    if (!orgName) return null;

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: token.marginSM,
                paddingBottom: token.paddingXS,
            }}
        >
            {branding?.logo_url && (
                <img
                    src={branding.logo_url}
                    alt={orgName}
                    // `onError` hides a broken image rather than leaving the
                    // browser's placeholder icon next to a contract, which reads
                    // worse than no logo at all.
                    onError={(e) => {
                        e.currentTarget.style.display = "none";
                    }}
                    style={{ maxHeight: 40, maxWidth: 160, objectFit: "contain" }}
                />
            )}
            <div>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    Sent to you by
                </Typography.Text>
                <Typography.Title level={5} style={{ margin: 0 }}>
                    {orgName}
                </Typography.Title>
            </div>
        </div>
    );
};
