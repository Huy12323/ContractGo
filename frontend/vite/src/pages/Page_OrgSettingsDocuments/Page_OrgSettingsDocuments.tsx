import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { Button, Card, Radio, Skeleton, Space, Typography } from "antd";
import dayjs from "dayjs";
import { useQ_Tables_Organization } from "@/hooks/useQ_Tables_Organization";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";
import { useM_OrgSettings_OrganizationUpdate } from "@/hooks/useM_OrgSettings_OrganizationUpdate";
import { App_OrgOwnerOnlyAlert } from "@/components/organization/App_OrgOwnerOnlyAlert";
import { App_EnvelopeScheduleEditor } from "@/components/envelopes/App_EnvelopeScheduleEditor";
import {
    const_OrganizationsDefaultSignerAuthOptions,
    type Envelope_SignerAuth,
} from "./const_OrganizationsDefaultSignerAuthOptions";

/**
 * Document defaults — the house policy every new envelope starts from.
 *
 * ═══ THIS TAB IS ALMOST ENTIRELY EXISTING CODE ═══
 *
 * `App_EnvelopeScheduleEditor` already renders deadline + reminder preset +
 * the stranded-reminder warning, and already has an `asDefaults` mode built for
 * the template builder — where a deadline is a DAY COUNT rather than a date,
 * because a template has no send date. An organization default has exactly the
 * same shape for exactly the same reason, so this tab is that component's third
 * caller and adds no new UI. The signer-auth options are likewise a re-export.
 *
 * ═══ WHERE THESE SIT IN THE PRECEDENCE CHAIN ═══
 *
 *   expiry     explicit request body (incl. null = never)
 *              > template version > THIS > never expires
 *   reminders  explicit body (incl. [] = none)
 *              > template version IF NON-EMPTY > THIS > none
 *   auth       explicit body > THIS > account
 *
 * The "if non-empty" on reminders is a known limitation, not an oversight:
 * `contract_templates.default_reminder_days` is `NOT NULL DEFAULT '{}'`, so a
 * template cannot distinguish "never configured" from "explicitly no reminders".
 * It is resolved toward inheritance, and a sender can still opt out per-envelope
 * by sending `reminder_days: []`.
 *
 * ═══ AND WHERE THEY DO NOT REACH ═══
 *
 * Changing anything here NEVER moves a document already in flight. Expiry and
 * reminders are pinned onto `signature_requests` at send time and the crons read
 * them from there — CG-013 and CG-031 both state that a later settings change
 * must not move a live document's deadline. The help text says so, because an
 * owner tightening a policy will reasonably wonder whether it applies now.
 */
export const Page_OrgSettingsDocuments = () => {
    const { organizationId } = useParams({
        from: "/_protected/$organizationId/settings/documents",
    });

    const { organization, query } = useQ_Tables_Organization({ organizationId });
    const qRole = useQ_Tables_MyRole({ organizationId });
    const { mutation } = useM_OrgSettings_OrganizationUpdate({ organizationId });

    const isOwner = qRole.role === "owner";

    const [expiryDays, setExpiryDays] = useState<number | null>(null);
    const [reminderDays, setReminderDays] = useState<number[]>([]);
    const [signerAuth, setSignerAuth] = useState<Envelope_SignerAuth>("account");

    useEffect(() => {
        if (!organization) return;
        setExpiryDays(organization.default_expiry_days);
        setReminderDays(organization.default_reminder_days ?? []);
        setSignerAuth(organization.default_signer_auth);
    }, [organization]);

    if (query.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;

    return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {!isOwner && (
                <App_OrgOwnerOnlyAlert
                    organizationId={organizationId}
                    what="this organization's document defaults"
                />
            )}

            <Card title="Deadline and reminders">
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                    <Typography.Text type="secondary">
                        Applied to new documents that do not set their own. A template with its own
                        schedule still wins, and changing these never moves a document that has
                        already been sent.
                    </Typography.Text>

                    <div
                        style={{
                            pointerEvents: isOwner ? undefined : "none",
                            opacity: isOwner ? 1 : 0.6,
                        }}
                    >
                        <App_EnvelopeScheduleEditor
                            asDefaults
                            // Day 0. In `asDefaults` mode the deadline is rendered
                            // as a day count, so this only anchors the
                            // stranded-reminder check — "day 14 with a day-7
                            // deadline never fires".
                            sentAt={dayjs()}
                            expiryDays={expiryDays}
                            onExpiryDaysChange={setExpiryDays}
                            value={{ expiresAt: null, reminderDays }}
                            onChange={(patch) => {
                                if (patch.reminderDays) setReminderDays(patch.reminderDays);
                            }}
                        />
                    </div>
                </Space>
            </Card>

            <Card title="Signer authentication">
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                    <Typography.Text type="secondary">
                        How recipients prove who they are, unless a document says otherwise.
                        Documents created through the API inherit this too — see{" "}
                        <Typography.Text code>docs/api.md</Typography.Text>.
                    </Typography.Text>

                    <Radio.Group
                        disabled={!isOwner}
                        value={signerAuth}
                        onChange={(e) => setSignerAuth(e.target.value as Envelope_SignerAuth)}
                    >
                        <Space direction="vertical">
                            {const_OrganizationsDefaultSignerAuthOptions.options.map((option) => (
                                <Radio key={option.value} value={option.value}>
                                    <Typography.Text strong>{option.label}</Typography.Text>
                                    <br />
                                    <Typography.Text type="secondary">
                                        {option.description}
                                    </Typography.Text>
                                </Radio>
                            ))}
                        </Space>
                    </Radio.Group>
                </Space>
            </Card>

            {isOwner && (
                <Button
                    type="primary"
                    loading={mutation.isPending}
                    onClick={() =>
                        mutation.mutate({
                            default_expiry_days: expiryDays,
                            default_reminder_days: reminderDays,
                            default_signer_auth: signerAuth,
                        })
                    }
                >
                    Save changes
                </Button>
            )}
        </Space>
    );
};
