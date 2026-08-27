import { Alert, Button, Tag, Typography, theme } from "antd";
import { UndoOutlined } from "@ant-design/icons";
import { App_EnvelopeStatusTag } from "@/components/envelopes/App_EnvelopeStatusTag";
import { const_EnvelopeRecipientTypeOptions } from "@/components/envelopes/const_EnvelopeStatusOptions";
import { utils_Envelope_SignerAuthOption } from "@/components/envelopes/const_EnvelopeSignerAuthOptions";
import type { Tables_Envelope_Signer } from "@/hooks/useQ_Tables_Envelope";
import type { SignerRole } from "@/types/template.types";

// The parties, in routing order, with whose turn it is made visible.
//
// Order is the product, not a display detail: `signature_claim_turn` refuses a
// signature whose `signer_order` is not the request's `current_order`, so a
// sender asking "why hasn't Dana signed" needs to see that Dana is third in line
// and the second party has not finished. Grouping by order rather than listing
// flat is what makes parallel signers (same order) legible as parallel.

// `Utils_Options_EnumsToOptions` widens its map to `Record<string, T>`, so the
// lookup is optional even for a key the `satisfies` check guarantees exists —
// same defensive read as `App_EnvelopeStatusTag`.
const CC_OPTION = const_EnvelopeRecipientTypeOptions.map.cc;

type Props = {
    signers: Tables_Envelope_Signer[];
    roles: SignerRole[];
    currentOrder: number;
    /** Only an in-flight request has a turn; a completed one has a history. */
    isInFlight: boolean;
    /**
     * Offers "Request changes" on signed signers. Omitted on a document that is
     * not in flight — a completed one has been burned, hashed and signed, and
     * CG-014 refuses to reopen it (see the migration's scope decision), so
     * rendering the action there would offer something the server declines.
     */
    onRequestChanges?: (signer: Tables_Envelope_Signer) => void;
};

export const App_EnvelopeSignerList = ({
    signers,
    roles,
    currentOrder,
    isInFlight,
    onRequestChanges,
}: Props) => {
    const { token } = theme.useToken();

    const roleById = new Map(roles.map((role) => [role.id, role]));

    // CC observers hold `signer_order` 0 and never take a turn, so they would
    // otherwise render as a "Step 0" that can never complete. They get their own
    // section below, outside the numbered steps; the numbered steps are signers
    // only.
    const signingParties = signers.filter((signer) => signer.recipient_type === "signer");
    const observers = signers.filter((signer) => signer.recipient_type === "cc");
    const orders = [...new Set(signingParties.map((signer) => signer.signer_order))].sort(
        (a, b) => a - b
    );
    // What the sender counts vs. what the database routes on. A template whose
    // roles are numbered 1, 3, 7 has three steps, and calling the last one
    // "Step 7" invites the question of what happened to steps 4 through 6.
    const stepByOrder = new Map(orders.map((order, index) => [order, index + 1]));

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
            {orders.map((order) => {
                const group = signingParties.filter((signer) => signer.signer_order === order);
                const isCurrent = isInFlight && order === currentOrder;

                return (
                    <div
                        key={order}
                        style={{
                            border: `1px solid ${isCurrent ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
                            background: isCurrent ? token.colorPrimaryBg : undefined,
                            borderRadius: token.borderRadiusLG,
                            padding: token.paddingSM,
                            display: "flex",
                            flexDirection: "column",
                            gap: token.marginXS,
                        }}
                    >
                        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            {group.length > 1
                                ? `Step ${stepByOrder.get(order)} — sign in parallel`
                                : `Step ${stepByOrder.get(order)}`}
                            {isCurrent && " · in progress"}
                        </Typography.Text>

                        {group.map((signer) => (
                            <div
                                key={signer.id}
                                style={{ display: "flex", flexDirection: "column" }}
                            >
                                {/* Wraps for the same reason the composer's
                                    summary row does: this row can carry up to
                                    four Tags, every ANTD Tag is `nowrap`, and
                                    without a wrap they squeeze the name to one
                                    character per line in a narrow column. */}
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        flexWrap: "wrap",
                                        gap: token.marginXS,
                                    }}
                                >
                                    <Typography.Text
                                        strong
                                        style={{ minWidth: 0, wordBreak: "break-word" }}
                                    >
                                        {signer.signer_name}
                                    </Typography.Text>
                                    <App_EnvelopeStatusTag kind="signer" status={signer.status} />
                                    <Typography.Text
                                        type="secondary"
                                        style={{ fontSize: token.fontSizeSM }}
                                    >
                                        {signer.role_id
                                            ? (roleById.get(signer.role_id)?.name ?? signer.role_id)
                                            : null}
                                    </Typography.Text>
                                    {/* CG-032, and ONLY on an exception. This is
                                        the "noted on a recipient" the detail
                                        page's summary points at — the pair is
                                        what stops the envelope-level Tag reading
                                        as a statement about everyone. */}
                                    {signer.auth_method && (
                                        <Tag
                                            color={
                                                utils_Envelope_SignerAuthOption(signer.auth_method)
                                                    .color
                                            }
                                            style={{ margin: 0 }}
                                        >
                                            {/* `shortLabel`, not `label` — the
                                                latter is a full sentence meant
                                                for the composer's radio group. */}
                                            {
                                                utils_Envelope_SignerAuthOption(signer.auth_method)
                                                    .shortLabel
                                            }
                                        </Tag>
                                    )}
                                    {/* [ekyc] CG-033, and only on an exception —
                                        same rule as the auth Tag above. */}
                                    {signer.require_identity_check !== null &&
                                        signer.require_identity_check !== undefined && (
                                            <Tag
                                                color={
                                                    signer.require_identity_check
                                                        ? "purple"
                                                        : "default"
                                                }
                                                style={{ margin: 0 }}
                                            >
                                                {signer.require_identity_check
                                                    ? "ID check required"
                                                    : "No ID check"}
                                            </Tag>
                                        )}
                                </div>
                                <Typography.Text
                                    type="secondary"
                                    style={{ fontSize: token.fontSizeSM }}
                                >
                                    {signer.signer_email}
                                    {signer.signed_at &&
                                        ` · signed ${new Date(signer.signed_at).toLocaleString()}`}
                                    {!signer.signed_at &&
                                        signer.viewed_at &&
                                        ` · opened ${new Date(signer.viewed_at).toLocaleString()}`}
                                </Typography.Text>

                                {/* "Have they been chased" without opening the
                                    audit trail. Shown only while the signature is
                                    still outstanding: once someone has signed,
                                    how many times they were nudged is history the
                                    timeline already holds. */}
                                {signer.reminder_count > 0 && !signer.signed_at && (
                                    <Typography.Text
                                        type="secondary"
                                        style={{ fontSize: token.fontSizeSM }}
                                    >
                                        {signer.reminder_count === 1
                                            ? "Reminded once"
                                            : `Reminded ${signer.reminder_count} times`}
                                        {signer.last_reminded_at &&
                                            ` · last ${new Date(signer.last_reminded_at).toLocaleString()}`}
                                    </Typography.Text>
                                )}

                                {signer.status === "declined" && (
                                    <Alert
                                        type="error"
                                        showIcon
                                        style={{ marginTop: token.marginXXS }}
                                        message="Declined"
                                        description={
                                            signer.decline_reason || "No reason was given."
                                        }
                                    />
                                )}

                                {/* Warning rather than error, matching the status
                                    tag's colour: the sender did this on purpose
                                    and the document is live. The reason is the
                                    sender's own words, shown back to them so
                                    "what did I ask for" does not require opening
                                    the audit trail. */}
                                {signer.status === "changes_requested" && (
                                    <Alert
                                        type="warning"
                                        showIcon
                                        style={{ marginTop: token.marginXXS }}
                                        message="Sent back for changes"
                                        description={
                                            signer.changes_requested_reason ||
                                            "No explanation was recorded."
                                        }
                                    />
                                )}

                                {/* Offered only on a signature that currently
                                    counts. A signer already in
                                    `changes_requested` has nothing to send back —
                                    their capture is superseded and the server
                                    answers `not_signed` — so the action
                                    disappears rather than failing when pressed. */}
                                <div style={{ display: "flex", gap: token.marginXS }}>
                                    {onRequestChanges && signer.status === "signed" && (
                                        <Button
                                            type="link"
                                            size="small"
                                            icon={<UndoOutlined />}
                                            style={{ paddingLeft: 0 }}
                                            onClick={() => onRequestChanges(signer)}
                                        >
                                            Request changes
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                );
            })}

            {/* Deliberately unnumbered and visually quieter than the steps. An
                observer is a party to the RECORD, not to the agreement: they
                hold a read-only `view` token, which `assertCanAct` rejects for
                signing, and nothing about the document waits on them. */}
            {observers.length > 0 && (
                <div
                    style={{
                        border: `1px dashed ${token.colorBorderSecondary}`,
                        borderRadius: token.borderRadiusLG,
                        padding: token.paddingSM,
                        display: "flex",
                        flexDirection: "column",
                        gap: token.marginXS,
                    }}
                >
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        Copied — read-only, no signature required
                    </Typography.Text>

                    {observers.map((observer) => (
                        <div key={observer.id} style={{ display: "flex", flexDirection: "column" }}>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: token.marginXS,
                                }}
                            >
                                <Typography.Text strong>{observer.signer_name}</Typography.Text>
                                <Tag color={CC_OPTION?.color ?? "default"} style={{ margin: 0 }}>
                                    {CC_OPTION?.label ?? "Receives a copy"}
                                </Tag>
                            </div>
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: token.fontSizeSM }}
                            >
                                {observer.signer_email}
                                {observer.notified_at
                                    ? ` · copied ${new Date(observer.notified_at).toLocaleString()}`
                                    : " · will be copied when the document completes"}
                                {observer.viewed_at &&
                                    ` · opened ${new Date(observer.viewed_at).toLocaleString()}`}
                            </Typography.Text>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
