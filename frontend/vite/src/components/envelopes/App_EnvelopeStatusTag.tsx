import { Tag, Tooltip } from "antd";
import {
    const_EnvelopeSignerStatusOptions,
    const_EnvelopeStatusOptions,
    type Envelope_Status,
    type EnvelopeSigner_Status,
} from "@/components/envelopes/const_EnvelopeStatusOptions";

// One tag, two vocabularies. An envelope's status and a signer's status are
// different enums that appear side by side all over the list and detail views,
// and giving them one component is what keeps "Signed" the same green in both
// places — the v1 code hand-rolled a Tag at each call site and drifted.

type Props =
    | { kind?: "envelope"; status: Envelope_Status; hint?: string }
    | { kind: "signer"; status: EnvelopeSigner_Status; hint?: string };

export const App_EnvelopeStatusTag = (props: Props) => {
    const option =
        props.kind === "signer"
            ? const_EnvelopeSignerStatusOptions.map[props.status]
            : const_EnvelopeStatusOptions.map[props.status];

    // An unknown value means the enum grew without this catalogue following.
    // The `satisfies` check in the consts file makes that a build error, so this
    // only fires against a database ahead of the deployed bundle — show the raw
    // value rather than an empty tag, which would read as "no status".
    const tag = <Tag color={option?.color ?? "default"}>{option?.label ?? props.status}</Tag>;

    return props.hint ? <Tooltip title={props.hint}>{tag}</Tooltip> : tag;
};
