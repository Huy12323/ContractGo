import { useMemo, useState } from "react";
import { Alert, Button, Checkbox, Divider, Input, Tag, Typography, theme } from "antd";
import {
    DeleteOutlined,
    MailOutlined,
    PhoneOutlined,
    PlusOutlined,
    UserOutlined,
} from "@ant-design/icons";
import type { SignerRole, TemplateLayout } from "@/types/template.types";
import { App_EnvelopeRecipientAuthEditor } from "@/components/envelopes/App_EnvelopeRecipientAuthEditor";
import { App_EnvelopeRecipientIdentityCheck } from "@/components/envelopes/App_EnvelopeRecipientIdentityCheck"; // [ekyc]
import { App_EnvelopeSigningSecurityEditor } from "@/components/envelopes/App_EnvelopeSigningSecurityEditor";
import { App_EnvelopeIdentityCheckEditor } from "@/components/envelopes/App_EnvelopeIdentityCheckEditor"; // [ekyc]
import type { Envelope_SignerAuth } from "@/components/envelopes/const_EnvelopeSignerAuthOptions";

// Who each of the template's parties actually IS.
//
// A template declares ROLES — abstract parties like "Employer" and "Employee" —
// and every field names one. Sending is the act of putting a real person behind
// each role, so this renders one row per role rather than a free-form "add a
// recipient" list: the set of signing parties is a property of the document, not
// of the send, and letting the sender invent a signer with no role would produce
// someone with nothing to fill.
//
// The SENDER role (order 0) is excluded. That party is the person composing —
// they fill their fields in the next step and never receive a link.
//
// ROLES ARE GROUPED BY `order`, and that grouping is the v1.1 feature rather
// than a layout choice. Roles sharing an order sign in PARALLEL: CG-011 replaced
// `UNIQUE (request_id, signer_order)` with `UNIQUE (request_id, role_id)`, so an
// order is now a batch, and `signature_advance_after_signature` holds the
// document there until every member of it has signed. `App_EnvelopeSignerList`
// already renders the RESULT that way ("Step N — sign in parallel"); this makes
// the composer read the same, so what the sender arranges and what they later
// watch are visibly the same structure.
//
// N parties are expressed as N ROLES, never as N people on one role. A role owns
// positioned field boxes on a fixed page — two people behind one role would
// write the same boxes and sign into the same rectangle, with no non-arbitrary
// answer to who wins.

export type EnvelopeRecipient = {
    role_id: string;
    name: string;
    email: string;
    /**
     * OPTIONAL, and not part of `utils_Envelope_IsRecipientComplete` — a send must
     * not be blocked because the sender does not have someone's number. It is
     * asked for because the audit trail identifies a performer by name, email AND
     * phone (CG-016), and because it is the number an SMS one-time passcode will
     * be sent to once that verification lands.
     */
    phone?: string;
    /**
     * This recipient's EXCEPTION to the envelope-level `signer_auth` — CG-032.
     * `undefined`/`null` means inherit, which is what every recipient does
     * unless the sender opens the exception panel below and changes it.
     *
     * OPTIONAL, and deliberately absent from `utils_Envelope_IsRecipientComplete`
     * for the same reason `phone` is: an exception is never a send requirement,
     * and every existing construction site keeps compiling untouched.
     */
    auth_method?: Envelope_SignerAuth | null;
    /** [ekyc] This recipient's exception to the envelope's identity requirement
     *  — CG-033. `undefined`/`null` means inherit. Optional for the same reason
     *  `auth_method` is: an exception is never a send requirement. */
    require_identity_check?: boolean | null;
};

/**
 * An observer. No role and no turn — CG-011 pins a `cc` row to `signer_order` 0,
 * which `signature_requests.current_order >= 1` can never equal, so
 * `signature_claim_turn` cannot match one. They receive a read-only `view` link.
 *
 * `key` is local to this editor: a CC has no role to be identified by and no
 * database row until the envelope is sent, so React needs something stable to
 * key the rows on that is not the email the sender is still typing.
 */
export type EnvelopeCcRecipient = {
    key: string;
    name: string;
    email: string;
    /** As on a signer — identification for the trail, never a send requirement. */
    phone?: string;
    /** Copy them when the document is SENT as well as when it completes. */
    notify_on_send: boolean;
};

type Props = {
    roles: SignerRole[];
    layout: TemplateLayout;
    value: Record<string, EnvelopeRecipient>;
    onChange: (roleId: string, patch: Partial<EnvelopeRecipient>) => void;
    cc: EnvelopeCcRecipient[];
    onCcAdd: () => void;
    onCcChange: (key: string, patch: Partial<EnvelopeCcRecipient>) => void;
    onCcRemove: (key: string) => void;
    /** Per-role messages, keyed by role id. Set after a rejected send. */
    errors?: Record<string, string>;
    /**
     * The envelope-level `signer_auth` — the DEFAULT every recipient follows
     * unless excepted (CG-031/032). Set at the top of this step, and passed down
     * to label each role's inherit option.
     */
    inheritedAuth: Envelope_SignerAuth;
    onInheritedAuthChange: (value: Envelope_SignerAuth) => void;
    /** [ekyc] The envelope-level identity requirement — CG-033. Same shape. */
    inheritedIdentityCheck: boolean;
    /** [ekyc] */
    onInheritedIdentityCheckChange: (value: boolean) => void;
};

/**
 * The per-recipient exception, COLLAPSED BEHIND A LINK.
 *
 * A sender with no opinion is never asked to form one: the Recipients step looks
 * exactly as it did before CG-032 for every envelope in existence, because every
 * recipient inherits and the panel starts shut. It opens by default when this
 * recipient already carries an exception, so a resumed draft shows what was set
 * rather than hiding it one click deep.
 *
 * Its own component purely so the disclosure state can be per role without the
 * editor carrying a `Record<string, boolean>` that would have to be kept in step
 * with the role list.
 */
const RecipientExceptionPanel = ({
    value,
    inherited,
    onChange,
    identityValue,
    inheritedIdentityCheck,
    onIdentityChange,
}: {
    value: Envelope_SignerAuth | null | undefined;
    inherited: Envelope_SignerAuth;
    onChange: (next: Envelope_SignerAuth | null) => void;
    /** [ekyc] */
    identityValue: boolean | null | undefined;
    /** [ekyc] */
    inheritedIdentityCheck: boolean;
    /** [ekyc] */
    onIdentityChange: (next: boolean | null) => void;
}) => {
    const { token } = theme.useToken();
    // Open when EITHER exception is already set, so a resumed draft shows what
    // was chosen rather than hiding it one click deep.
    const [open, setOpen] = useState(!!value || identityValue !== null);

    if (!open) {
        return (
            <Button
                type="link"
                size="small"
                style={{ padding: 0, height: "auto", alignSelf: "flex-start" }}
                onClick={() => setOpen(true)}
            >
                Different for this recipient
            </Button>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginXXS }}>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                How this recipient proves who they are
            </Typography.Text>
            <App_EnvelopeRecipientAuthEditor
                value={value ?? null}
                inherited={inherited}
                onChange={onChange}
            />
            {/* [ekyc] One JSX block. Removing eKYC deletes it and the three
                props above; nothing else in this file changes. */}
            <App_EnvelopeRecipientIdentityCheck
                value={identityValue ?? null}
                inherited={inheritedIdentityCheck}
                onChange={onIdentityChange}
            />
        </div>
    );
};

export const const_Envelope_SenderRoleOrder = 0;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const utils_Envelope_IsRecipientComplete = (recipient?: EnvelopeRecipient): boolean =>
    !!recipient?.name.trim() && EMAIL_PATTERN.test(recipient?.email.trim() ?? "");

/** A CC row the sender started and left half-finished blocks the send, the same
 *  way an incomplete signer does — an empty row is simply ignored instead. */
export const utils_Envelope_IsCcComplete = (recipient: EnvelopeCcRecipient): boolean =>
    !!recipient.name.trim() && EMAIL_PATTERN.test(recipient.email.trim());

export const utils_Envelope_IsCcEmpty = (recipient: EnvelopeCcRecipient): boolean =>
    !recipient.name.trim() && !recipient.email.trim();

export const App_EnvelopeRecipientsEditor = ({
    roles,
    layout,
    value,
    onChange,
    cc,
    onCcAdd,
    onCcChange,
    onCcRemove,
    errors,
    inheritedAuth,
    onInheritedAuthChange,
    inheritedIdentityCheck,
    onInheritedIdentityCheckChange,
}: Props) => {
    const { token } = theme.useToken();

    const recipientRoles = useMemo(
        () =>
            roles
                .filter((role) => role.order !== const_Envelope_SenderRoleOrder)
                .sort((a, b) => a.order - b.order),
        [roles]
    );

    // One group per distinct order, in order. `steps` is what the sender counts
    // — "step 1, step 2" — while `order` is the number the database routes on;
    // they diverge as soon as a template's roles are numbered 1, 3, 7.
    const orderGroups = useMemo(() => {
        const byOrder = new Map<number, SignerRole[]>();
        for (const role of recipientRoles) {
            byOrder.set(role.order, [...(byOrder.get(role.order) ?? []), role]);
        }
        return [...byOrder.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([order, groupRoles], index) => ({ order, roles: groupRoles, step: index + 1 }));
    }, [recipientRoles]);

    const fieldCountByRole = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const field of layout) counts[field.role_id] = (counts[field.role_id] ?? 0) + 1;
        return counts;
    }, [layout]);

    if (recipientRoles.length === 0) {
        return (
            <Alert
                type="warning"
                showIcon
                message="This template has no signing roles"
                description="Open it in the builder and add a role before sending it to anyone."
            />
        );
    }

    return (
        <div
            style={{ display: "flex", flexDirection: "column", gap: token.marginLG, maxWidth: 640 }}
        >
            {/* THE DEFAULT, AT THE TOP, ABOVE THE PARTIES IT APPLIES TO.

This used to live on the Prepare step while the per-recipient
                exceptions lived here — a default and its exceptions a step and a
                click apart, held together by a summary Tag and a "unless you set
                a different requirement on the Recipients step" line. Needing
                those mitigations was the signal the split was wrong.

It belongs on THIS step for a simpler reason than removability:
                it is a statement about the RECIPIENTS, and this is the one screen
                where every recipient is visible at once — which is exactly the
                context in which "everyone does X, except this one does Y" reads
                as a single thought instead of two settings that might disagree. */}
            <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
                <div>
                    <Typography.Text strong>How recipients sign</Typography.Text>
                    <Typography.Paragraph
                        type="secondary"
                        style={{ fontSize: token.fontSizeSM, margin: 0 }}
                    >
                        Applies to everyone below. You can set something different for an individual
                        recipient on their card.
                    </Typography.Paragraph>
                </div>
                <App_EnvelopeSigningSecurityEditor
                    value={inheritedAuth}
                    onChange={onInheritedAuthChange}
                />
            </div>

            {/* [ekyc] CG-033. Its own block directly below rather than folded in,
                because the two are orthogonal: an identity check is *also*, never
                *instead of*. Removing eKYC deletes this whole block. */}
            <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
                <Typography.Text strong>Identity verification</Typography.Text>
                <App_EnvelopeIdentityCheckEditor
                    value={inheritedIdentityCheck}
                    onChange={onInheritedIdentityCheckChange}
                />
            </div>

            <Divider style={{ margin: 0 }} />

            {orderGroups.map((group) => (
                <div
                    key={group.order}
                    style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}
                >
                    <div style={{ display: "flex", alignItems: "baseline", gap: token.marginXS }}>
                        <Typography.Text strong>Step {group.step}</Typography.Text>
                        {group.roles.length > 1 && (
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: token.fontSizeSM }}
                            >
                                — these sign in parallel; whoever is last releases the next step
                            </Typography.Text>
                        )}
                    </div>

                    {group.roles.map((role) => {
                        const recipient = value[role.id];
                        const fieldCount = fieldCountByRole[role.id] ?? 0;
                        const emailValue = recipient?.email ?? "";
                        const emailLooksWrong =
                            !!emailValue.trim() && !EMAIL_PATTERN.test(emailValue.trim());

                        return (
                            <div
                                key={role.id}
                                style={{
                                    border: `1px solid ${token.colorBorderSecondary}`,
                                    borderRadius: token.borderRadiusLG,
                                    padding: token.paddingMD,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: token.marginSM,
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: token.marginSM,
                                    }}
                                >
                                    <Tag color={role.color} style={{ margin: 0 }}>
                                        {role.name}
                                    </Tag>
                                    <Typography.Text
                                        type="secondary"
                                        style={{ fontSize: token.fontSizeSM }}
                                    >
                                        {fieldCount} field{fieldCount === 1 ? "" : "s"}
                                    </Typography.Text>
                                    {fieldCount === 0 && (
                                        <Typography.Text
                                            type="warning"
                                            style={{ fontSize: token.fontSizeSM }}
                                        >
                                            nothing to fill
                                        </Typography.Text>
                                    )}
                                </div>

                                <div style={{ display: "flex", gap: token.marginSM }}>
                                    <Input
                                        placeholder="Full name"
                                        prefix={<UserOutlined />}
                                        value={recipient?.name ?? ""}
                                        onChange={(e) =>
                                            onChange(role.id, { name: e.target.value })
                                        }
                                    />
                                    <Input
                                        placeholder="name@example.com"
                                        type="email"
                                        prefix={<MailOutlined />}
                                        status={emailLooksWrong ? "error" : undefined}
                                        value={emailValue}
                                        onChange={(e) =>
                                            onChange(role.id, { email: e.target.value })
                                        }
                                    />
                                </div>

                                {/* Unvalidated and unrequired. The number is
                                    identification evidence rather than a routing
                                    address — nothing is dialled today — so
                                    rejecting a format would refuse the only number
                                    the sender has for no benefit. */}
                                <Input
                                    placeholder="Phone (optional)"
                                    prefix={<PhoneOutlined />}
                                    value={recipient?.phone ?? ""}
                                    onChange={(e) => onChange(role.id, { phone: e.target.value })}
                                />

                                <RecipientExceptionPanel
                                    value={recipient?.auth_method}
                                    inherited={inheritedAuth}
                                    onChange={(next) => onChange(role.id, { auth_method: next })}
                                    identityValue={recipient?.require_identity_check}
                                    inheritedIdentityCheck={inheritedIdentityCheck}
                                    onIdentityChange={(next) =>
                                        onChange(role.id, { require_identity_check: next })
                                    }
                                />

                                {errors?.[role.id] && (
                                    <Typography.Text
                                        type="danger"
                                        style={{ fontSize: token.fontSizeSM }}
                                    >
                                        {errors[role.id]}
                                    </Typography.Text>
                                )}
                            </div>
                        );
                    })}
                </div>
            ))}

            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                Each signer gets a private link by email. The link is personal — it identifies them
                to the document and is recorded in the audit trail.
            </Typography.Text>

            <Divider style={{ margin: 0 }} />

            {/* Observers sit outside the numbered steps, which is what they are:
                parties to the record rather than to the agreement. Rendering them
                as a step would show a step that never completes. */}
            <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
                <div>
                    <Typography.Text strong>Copy to (optional)</Typography.Text>
                    <Typography.Paragraph
                        type="secondary"
                        style={{ fontSize: token.fontSizeSM, margin: 0 }}
                    >
                        Observers receive a read-only link. They are not asked to sign, take no
                        turn, and cannot hold up the document.
                    </Typography.Paragraph>
                </div>

                {cc.map((observer) => {
                    const emailLooksWrong =
                        !!observer.email.trim() && !EMAIL_PATTERN.test(observer.email.trim());

                    return (
                        <div
                            key={observer.key}
                            style={{
                                border: `1px solid ${token.colorBorderSecondary}`,
                                borderRadius: token.borderRadiusLG,
                                padding: token.paddingSM,
                                display: "flex",
                                flexDirection: "column",
                                gap: token.marginXS,
                            }}
                        >
                            <div style={{ display: "flex", gap: token.marginSM }}>
                                <Input
                                    placeholder="Full name"
                                    prefix={<UserOutlined />}
                                    value={observer.name}
                                    onChange={(e) =>
                                        onCcChange(observer.key, { name: e.target.value })
                                    }
                                />
                                <Input
                                    placeholder="name@example.com"
                                    type="email"
                                    prefix={<MailOutlined />}
                                    status={emailLooksWrong ? "error" : undefined}
                                    value={observer.email}
                                    onChange={(e) =>
                                        onCcChange(observer.key, { email: e.target.value })
                                    }
                                />
                                <Button
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => onCcRemove(observer.key)}
                                />
                            </div>
                            <Input
                                placeholder="Phone (optional)"
                                prefix={<PhoneOutlined />}
                                value={observer.phone ?? ""}
                                onChange={(e) =>
                                    onCcChange(observer.key, { phone: e.target.value })
                                }
                            />
                            <Checkbox
                                checked={observer.notify_on_send}
                                onChange={(e) =>
                                    onCcChange(observer.key, { notify_on_send: e.target.checked })
                                }
                            >
                                <Typography.Text style={{ fontSize: token.fontSizeSM }}>
                                    Also copy them now, when the document is sent
                                </Typography.Text>
                            </Checkbox>
                        </div>
                    );
                })}

                <div>
                    <Button icon={<PlusOutlined />} onClick={onCcAdd}>
                        Add observer
                    </Button>
                </div>

                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    Observers are copied when every party has signed. The completed document is the
                    one worth keeping — a copy sent earlier is a copy of something that may still be
                    declined.
                </Typography.Text>
            </div>
        </div>
    );
};
