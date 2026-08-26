import { Alert, Radio, Space, Typography, theme } from "antd";
import {
    const_EnvelopeSignerAuthOptions,
    type Envelope_SignerAuth,
} from "@/components/envelopes/const_EnvelopeSignerAuthOptions";

// Who has to prove what before they can sign — CG-031.
//
// A presentational control shaped exactly like `App_EnvelopeScheduleEditor`:
// `value` / `onChange`, no data fetching, no knowledge of where it is rendered.
//
// IT MOVED FROM "Prepare & send" TO "Recipients" (CG-032). The original argument
// for Prepare was that this and the deadline are both terms of THIS send. True,
// but it stopped being the strongest argument once this became a DEFAULT with
// per-recipient EXCEPTIONS: the exceptions live on each role card, and a default
// has to be visible at the same time as the things that override it. This is a
// statement about the recipients, so it sits above them.
//
// A RADIO GROUP AND NOT A SWITCH, even though there are two options today. A
// switch has an implied "off", and neither of these is the absence of the other:
// they are two different kinds of evidence, and the SMS driver in
// `_shared/signing.ts` means there will be a third. It also gives each option
// room for the sentence that explains what it costs, which a switch label cannot
// carry and which is the only reason a sender can choose between them properly.

type Props = {
    value: Envelope_SignerAuth;
    onChange: (value: Envelope_SignerAuth) => void;
    /** Disabled while a send is in flight, like the rest of the prepare step. */
    disabled?: boolean;
};

export const App_EnvelopeSigningSecurityEditor = ({ value, onChange, disabled }: Props) => {
    const { token } = theme.useToken();

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
            <Radio.Group
                value={value}
                onChange={(event) => onChange(event.target.value as Envelope_SignerAuth)}
                disabled={disabled}
                style={{ width: "100%" }}
            >
                <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
                    {const_EnvelopeSignerAuthOptions.options.map((option) => (
                        <Radio key={option.value} value={option.value}>
                            <Typography.Text strong>{option.label}</Typography.Text>
                            <Typography.Paragraph
                                type="secondary"
                                style={{
                                    margin: 0,
                                    fontSize: token.fontSizeSM,
                                    // The description belongs to the label, so it
                                    // sits inside the Radio rather than beside it
                                    // — clicking the explanation selects the thing
                                    // it explains, which is what someone reading
                                    // it is about to want.
                                    whiteSpace: "normal",
                                }}
                            >
                                {option.description}
                            </Typography.Paragraph>
                        </Radio>
                    ))}
                </Space>
            </Radio.Group>

            {/* Shown only for the weaker option, and worded as a consequence
                rather than a warning. The sender is not doing anything wrong —
                this is the mode that exists to get contracts signed — but "the
                code proves the mailbox, not the person" is the sentence they
                would otherwise only discover in a dispute. `info`, not
                `warning`: a yellow banner on a deliberate, supported choice
                trains senders to ignore banners. */}
            {value === "email_otp" && (
                <Alert
                    type="info"
                    showIcon
                    message="Anyone who can read that mailbox can sign"
                    description="A code proves the recipient controls the address you sent to at the moment they sign — not that a particular person did. For agreements where that distinction matters, ask recipients to sign in instead."
                />
            )}
        </div>
    );
};
