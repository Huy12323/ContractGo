// The electronic-signature consent gate.
//
// Not a formality. An electronic signature is binding only where the signer
// agreed to transact electronically, and that agreement has to exist as
// EVIDENCE rather than as an assumption baked into the UI. So:
//
//   * the checkbox state is sent to `signing_submit` as `consent_accepted`, and
//     the server REFUSES the submission without it — a client that skipped this
//     component cannot sign;
//   * the acceptance is written into the hash-chained audit trail along with the
//     signer's IP and user-agent, so what was agreed and by whom is
//     reconstructible later.
//
// The wording deliberately names the mechanism the signature actually uses. The
// mock signing driver produces a structurally valid but evidentially meaningless
// self-signed PAdES (plan risk 6), so the disclosure below must not be upgraded
// to claim more than the deployment delivers.

import { Checkbox, Typography, theme } from "antd";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

type Props = {
    checked: boolean;
    onChange: (checked: boolean) => void;
    signerName: string;
    signerEmail: string;
    disabled?: boolean;
};

export const App_SigningConsentGate = ({
    checked,
    onChange,
    signerName,
    signerEmail,
    disabled = false,
}: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();

    return (
        <div
            style={{
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusLG,
                padding: token.paddingMD,
                background: token.colorFillQuaternary,
                display: "flex",
                flexDirection: "column",
                gap: token.marginXS,
            }}
        >
            {/* The label is part of the target, so the row is already wide. What it
                lacks on a phone is HEIGHT — the default row is ~22px against the
                ~44px a fingertip needs, and this is the control the whole ceremony
                rests on. Padding rather than a transform so the hit area and the
                thing the signer sees stay the same rectangle. */}
            <Checkbox
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                style={{ padding: `${isMobile ? token.paddingXS : 0}px 0`, alignItems: "center" }}
            >
                <Typography.Text>I agree to sign this document electronically.</Typography.Text>
            </Checkbox>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                Signing as <strong>{signerName}</strong> ({signerEmail}). Your signature, the time
                you signed, your IP address and your browser are recorded in a tamper-evident audit
                trail attached to this document.
            </Typography.Text>
        </div>
    );
};
