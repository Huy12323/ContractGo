import { useState } from "react";
import { Alert, App, Button, Space, Typography, theme } from "antd";
import { CheckOutlined, CopyOutlined } from "@ant-design/icons";

/**
 * The one and only showing of a credential.
 *
 * ═══ WHY THIS IS ITS OWN COMPONENT ═══
 *
 * Two callers need it — a new API key and a webhook signing secret — and both
 * have the same problem: the string on screen exists nowhere else in the world.
 * `api_key_issue` and `webhook_endpoint_create` store a sha256 and a plaintext
 * respectively, but neither will ever hand the value back to a browser again.
 * Getting this panel wrong means an admin closes a modal and has lost something
 * unrecoverable.
 *
 * ═══ WHAT IT DOES ABOUT THAT ═══
 *
 *   * IT SAYS SO FIRST, in a warning above the value rather than a caption
 *     below it. A caption under a large monospace string is read after the
 *     string has been glanced at and the modal dismissed.
 *   * THE DISMISS BUTTON IS EXPLICIT and says "I've saved it". A modal that
 *     closes on a backdrop click has closed by accident, and this one cannot be
 *     reopened.
 *   * COPY REPORTS SUCCESS OR FAILURE. `navigator.clipboard` rejects on an
 *     insecure origin and in some embedded browsers, and a copy button that
 *     silently did nothing is how the value gets lost — the admin believes it is
 *     on their clipboard.
 *
 * The value is held in the CALLER's component state and never written to the
 * query cache, a store, or `localStorage`. It dies with the modal, which is the
 * intended lifetime.
 */
export const Page_SettingsApiKeys_RevealPanel = ({
    label,
    value,
    warning,
    onDone,
}: {
    /** What this is, in the words the docs use — "API key", "Signing secret". */
    label: string;
    value: string;
    /** The consequence of losing it, which differs per credential. */
    warning: string;
    onDone: () => void;
}) => {
    const { token } = theme.useToken();
    const { message } = App.useApp();
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            message.success(`${label} copied`);
        } catch {
            // Not a swallowed failure: the admin must know the clipboard did
            // NOT receive it, because the alternative is closing this panel
            // believing it did.
            message.error("Could not copy automatically — select the text and copy it manually.");
        }
    };

    return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
                type="warning"
                showIcon
                message={`Copy this ${label.toLowerCase()} now`}
                description={warning}
            />

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginXS,
                    padding: token.paddingSM,
                    background: token.colorFillQuaternary,
                    border: `1px solid ${token.colorBorder}`,
                    borderRadius: token.borderRadius,
                }}
            >
                {/* `copyable` is deliberately NOT antd's own, and `code` wraps:
                    a 40-character secret in a `Typography.Text` with ellipsis
                    would hide the end of the thing the user is here to read, and
                    selecting it by hand would then copy an ellipsis. */}
                <Typography.Text
                    code
                    style={{
                        flex: 1,
                        wordBreak: "break-all",
                        fontSize: token.fontSizeSM,
                        userSelect: "all",
                    }}
                >
                    {value}
                </Typography.Text>
                <Button
                    icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                    onClick={handleCopy}
                    type={copied ? "default" : "primary"}
                >
                    {copied ? "Copied" : "Copy"}
                </Button>
            </div>

            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                It will not be shown again. We store only a hash — nobody, including us, can recover
                it.
            </Typography.Text>

            <Button block onClick={onDone}>
                I&rsquo;ve saved it
            </Button>
        </Space>
    );
};
