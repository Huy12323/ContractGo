import { useEffect } from "react";
import { useParams } from "@tanstack/react-router";
import { Button, Card, Form, Input, Select, Skeleton, Space, Switch, Typography } from "antd";
import { useQ_Tables_Organization } from "@/hooks/useQ_Tables_Organization";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";
import {
    useM_OrgSettings_OrganizationUpdate,
    type UseM_OrgSettings_OrganizationUpdate_Body,
} from "@/hooks/useM_OrgSettings_OrganizationUpdate";
import { App_OrgOwnerOnlyAlert } from "@/components/organization/App_OrgOwnerOnlyAlert";
import { const_OrganizationsTimezoneOptions } from "./const_OrganizationsTimezoneOptions";

/**
 * General organization settings — name, timezone, and the CG-049 AI kill switch.
 *
 * ═══ WHY `ai_assistant_enabled` IS HERE AND NOT ON A TAB OF ITS OWN ═══
 *
 * CG-049 shipped the column, defaulted it to `true`, and had
 * `signing_session_open` read it — but nothing ever wrote it. Its own migration
 * header says a law firm "must be able to turn off for themselves without a
 * deploy", and until CG-050 the only way to do that was a manual UPDATE. One
 * switch does not deserve a tab; it belongs with the other org-wide facts.
 *
 * ═══ THE TIMEZONE HAS EXACTLY ONE CONSUMER, AND THAT IS DELIBERATE ═══
 *
 * It formats the deadline line in reminder and expiry email. It does NOT touch
 * the completion certificate, which stays UTC forever — `certificate.text.ts`
 * argues that a bare local timestamp in an evidentiary document is a timestamp
 * nobody can reason about later. The help text below says so, because an owner
 * setting a timezone will reasonably assume it applies everywhere.
 *
 * ═══ OWNER-WRITE, MEMBER-READ ═══
 *
 * RLS UPDATE on `organizations` is `get_organization_role(id) = 'owner'`, and
 * CG-050 narrowed it further to column-wise grants. An admin gets the real
 * values in a disabled form plus `App_OrgOwnerOnlyAlert` — see that component
 * for why disabled beats hidden.
 */
export const Page_OrgSettingsGeneral = () => {
    const { organizationId } = useParams({
        from: "/_protected/$organizationId/settings/general",
    });
    const [form] = Form.useForm<UseM_OrgSettings_OrganizationUpdate_Body>();

    const { organization, query } = useQ_Tables_Organization({ organizationId });
    const qRole = useQ_Tables_MyRole({ organizationId });
    const { mutation } = useM_OrgSettings_OrganizationUpdate({ organizationId });

    const isOwner = qRole.role === "owner";

    // The row arrives after first paint, so the form is seeded from an effect
    // rather than `initialValues` — which antd reads once and never again.
    useEffect(() => {
        if (!organization) return;
        form.setFieldsValue({
            name: organization.name,
            timezone: organization.timezone,
            ai_assistant_enabled: organization.ai_assistant_enabled,
        });
    }, [organization, form]);

    if (query.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;

    return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {!isOwner && (
                <App_OrgOwnerOnlyAlert organizationId={organizationId} what="these settings" />
            )}

            <Card>
                <Form
                    form={form}
                    layout="vertical"
                    disabled={!isOwner}
                    onFinish={(values) => mutation.mutate(values)}
                    style={{ maxWidth: 560 }}
                >
                    <Form.Item
                        name="name"
                        label="Organization name"
                        extra="Recipients see this name on every document you send and in the emails announcing them."
                        rules={[
                            { required: true, message: "An organization needs a name" },
                            { max: 100, message: "Keep it under 100 characters" },
                        ]}
                    >
                        <Input placeholder="Acme Legal" />
                    </Form.Item>

                    <Form.Item
                        name="timezone"
                        label="Timezone"
                        extra="Used for the deadline dates in reminder and expiry emails. Completion certificates always record UTC, so the audit trail stays comparable across regions."
                    >
                        <Select
                            showSearch
                            optionFilterProp="label"
                            options={[...const_OrganizationsTimezoneOptions]}
                            placeholder="UTC"
                        />
                    </Form.Item>

                    <Form.Item
                        name="ai_assistant_enabled"
                        label="Document assistant for signers"
                        valuePropName="checked"
                        extra="Lets signers ask questions about the document they are about to sign, answered only from that document. Turn it off if your documents must not be summarised by a third-party model."
                    >
                        <Switch />
                    </Form.Item>

                    {isOwner && (
                        <Form.Item style={{ marginBottom: 0 }}>
                            <Button type="primary" htmlType="submit" loading={mutation.isPending}>
                                Save changes
                            </Button>
                        </Form.Item>
                    )}
                </Form>
            </Card>

            <Typography.Text type="secondary">
                Organization ID: <Typography.Text code>{organizationId}</Typography.Text>
            </Typography.Text>
        </Space>
    );
};
