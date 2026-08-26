import { Alert, Checkbox, Typography, theme } from "antd";

// [ekyc] Whether recipients must prove who they are in the WORLD — CG-033.
//
// A SEPARATE FILE FROM `App_EnvelopeSigningSecurityEditor`, AND THAT IS THE
// POINT. Two reasons, and the second is the one that would still hold even if
// eKYC were permanent:
//
//   1. Removability. Folding this into the security editor would make taking
//      eKYC out a line-revert inside a file that has to keep working. As its own
//      component it is an `rm` and one JSX line.
//   2. It is ORTHOGONAL. `signer_auth` asks "did they control the named
//      mailbox"; this asks "are they who they claim to be". A high-value
//      envelope wants BOTH — and *also*, not *instead of*, is what a checkbox
//      beside a radio group says correctly and a third radio option would not.
//
// THE WARNING IS NOT OPTIONAL. A mock that always approves, behind copy that
// says "identity verified", is a lie with legal weight. The composer already
// practises exactly this honesty for uncertified signatures ("Signatures are
// recorded, not yet certified"), and this is the same disclosure about the same
// kind of gap. `signing_identity_start` refuses the mock outright anywhere
// `ENVIRONMENT` is not a development one, so this banner and that refusal are
// two halves of one promise.

type Props = {
    value: boolean;
    onChange: (value: boolean) => void;
    /** Disabled while a send is in flight, like the rest of the prepare step. */
    disabled?: boolean;
};

export const App_EnvelopeIdentityCheckEditor = ({ value, onChange, disabled }: Props) => {
    const { token } = theme.useToken();

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
            <Checkbox
                checked={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
            >
                <Typography.Text strong>Recipients must verify their identity</Typography.Text>
                <Typography.Paragraph
                    type="secondary"
                    style={{ margin: 0, fontSize: token.fontSizeSM, whiteSpace: "normal" }}
                >
                    Before signing, each recipient photographs a government ID and takes a selfie.
                    The signature then rests on a check against an identity document, not only on
                    reaching an email address. It adds a step for them, and it is the strongest
                    claim this platform can record.
                </Typography.Paragraph>
            </Checkbox>

            {value && (
                <Alert
                    type="warning"
                    showIcon
                    message="Identity checks on this deployment are simulated"
                    description="No identity provider is connected. The check will complete without examining a real document, and the audit trail records the provider as “mock” so nobody can later mistake it for a real verification."
                />
            )}
        </div>
    );
};
