import { Spin, Typography, theme } from "antd";
import { useQ_Signature_ReadUrl } from "@/hooks/useQ_Signature_ReadUrl";

type Props = {
    signatureId: string;
    height?: number;
    alt?: string;
};

/**
 * Renders one saved signature image (CG-029).
 *
 * Exists because a signature URL has to be SIGNED. An avatar can be rendered by
 * concatenating the Worker origin onto its `r2_key`, but the signature namespace
 * is token-authorized, so every `<img>` needs a round trip first. Wrapping that
 * in a component keeps the loading and failure states from being re-invented in
 * both the library grid and the signing-screen picker.
 *
 * A failure renders as text rather than a broken-image glyph: the most likely
 * cause is an expired token, which is transient and not the user's doing.
 */
export const App_SignatureImage = ({ signatureId, height = 64, alt = "Signature" }: Props) => {
    const { token } = theme.useToken();
    const qUrl = useQ_Signature_ReadUrl({ signatureId });

    const frameStyle: React.CSSProperties = {
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    };

    if (qUrl.query.isLoading) {
        return (
            <div style={frameStyle}>
                <Spin size="small" />
            </div>
        );
    }

    if (qUrl.query.isError || !qUrl.url) {
        return (
            <div style={frameStyle}>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    Couldn&apos;t load
                </Typography.Text>
            </div>
        );
    }

    return (
        <div style={frameStyle}>
            <img
                src={qUrl.url}
                alt={alt}
                style={{ maxWidth: "100%", maxHeight: height, objectFit: "contain" }}
            />
        </div>
    );
};
