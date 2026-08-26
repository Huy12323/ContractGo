import { Select, theme } from "antd";

// [ekyc] One recipient's exception to the envelope's identity requirement —
// CG-033.
//
// A SEPARATE COMPONENT FROM `App_EnvelopeRecipientAuthEditor` PURELY FOR
// REMOVABILITY. They render side by side in the same collapsed panel and could
// obviously be one file with two controls — but then removing eKYC would be an
// argument-list edit inside a working component instead of deleting a file and
// one JSX line.
//
// THREE-WAY, not a checkbox: "same as everyone" is a distinct state from "not
// required", because the first tracks the envelope and the second overrides it.
// A two-state control could not express "explicitly exempt this witness even if
// I later turn the requirement on for the document".

const INHERIT = "__inherit__";

type Props = {
    /** NULL means inherit the envelope-level requirement. */
    value: boolean | null;
    /** What this recipient would follow if `value` stays NULL. */
    inherited: boolean;
    onChange: (value: boolean | null) => void;
    disabled?: boolean;
};

export const App_EnvelopeRecipientIdentityCheck = ({
    value,
    inherited,
    onChange,
    disabled,
}: Props) => {
    const { token } = theme.useToken();

    return (
        <Select
            value={value === null ? INHERIT : value ? "required" : "not_required"}
            disabled={disabled}
            style={{ width: "100%" }}
            onChange={(next) => onChange(next === INHERIT ? null : next === "required")}
            options={[
                {
                    value: INHERIT,
                    label: `Same as everyone — identity check ${inherited ? "required" : "not required"}`,
                },
                { value: "required", label: "Must verify their identity" },
                { value: "not_required", label: "Does not need to verify their identity" },
            ]}
            styles={{ popup: { root: { fontSize: token.fontSizeSM } } }}
        />
    );
};
