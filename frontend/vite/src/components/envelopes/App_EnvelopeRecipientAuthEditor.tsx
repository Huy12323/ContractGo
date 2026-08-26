import { Select, Typography, theme } from "antd";
import {
    utils_Envelope_AuthFromSelect,
    utils_Envelope_AuthToSelect,
    utils_Envelope_RecipientAuthOptions,
} from "@/components/envelopes/const_EnvelopeRecipientAuthOptions";
import type { Envelope_SignerAuth } from "@/components/envelopes/const_EnvelopeSignerAuthOptions";

// One recipient's exception to the envelope-level choice — CG-032.
//
// Presentational only, the same shape as `App_EnvelopeScheduleEditor` and
// `App_EnvelopeSigningSecurityEditor`: `value` / `onChange`, no fetching, no
// knowledge of where it is rendered.
//
// A COMPACT SELECT, DELIBERATELY NOT A RADIO GROUP — which is the opposite of
// what the envelope-level control does, on purpose. That one is a decision every
// sender makes once, so it earns a paragraph per option. This one is an
// EXCEPTION almost nobody sets, and giving an exception equal visual weight is
// how a sender ends up reading three paragraphs per role on a five-role
// template. The prose is not lost: it moves into `optionRender`, so it appears
// on open — which is exactly when someone is choosing rather than skimming.
//
// `value` IS `null` FOR INHERIT, never the sentinel. See
// `const_EnvelopeRecipientAuthOptions` for why that boundary is here.

type Props = {
    /** NULL means inherit the envelope-level choice. */
    value: Envelope_SignerAuth | null;
    /** What this recipient would follow if `value` stays NULL. Labels the
     *  inherit option, so the sender can name what they are excepting from. */
    inherited: Envelope_SignerAuth;
    onChange: (value: Envelope_SignerAuth | null) => void;
    disabled?: boolean;
};

export const App_EnvelopeRecipientAuthEditor = ({
    value,
    inherited,
    onChange,
    disabled,
}: Props) => {
    const { token } = theme.useToken();
    const options = utils_Envelope_RecipientAuthOptions(inherited);

    return (
        <Select
            value={utils_Envelope_AuthToSelect(value)}
            onChange={(next) => onChange(utils_Envelope_AuthFromSelect(next))}
            disabled={disabled}
            style={{ width: "100%" }}
            options={options.map((option) => ({ value: option.value, label: option.label }))}
            optionRender={(option) => {
                const meta = options.find((o) => o.value === option.value);
                return (
                    <div style={{ paddingBlock: token.paddingXXS }}>
                        <Typography.Text strong>{meta?.label}</Typography.Text>
                        <Typography.Paragraph
                            type="secondary"
                            style={{
                                margin: 0,
                                fontSize: token.fontSizeSM,
                                whiteSpace: "normal",
                            }}
                        >
                            {meta?.description}
                        </Typography.Paragraph>
                    </div>
                );
            }}
        />
    );
};
