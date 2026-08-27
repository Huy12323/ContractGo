import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { Button, Card, ColorPicker, Form, Input, Skeleton, Space, Typography } from "antd";
import { useQ_Tables_Organization } from "@/hooks/useQ_Tables_Organization";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";
import { useM_OrgSettings_OrganizationUpdate } from "@/hooks/useM_OrgSettings_OrganizationUpdate";
import { App_OrgOwnerOnlyAlert } from "@/components/organization/App_OrgOwnerOnlyAlert";
import { Utils_Organization_LogoSrc } from "@/utils/Utils_Files_PublicUrl";
import { PageOrgSettingsBranding_LogoUpload } from "./PageOrgSettingsBranding_LogoUpload";

/**
 * Branding — what a recipient sees before they know anything else about you.
 *
 * ═══ WHY THIS EXISTS ═══
 *
 * Before CG-050 every signing page and every email looked identical regardless
 * of who sent the document. A counterparty opening a contract could not tell at a
 * glance whether it came from the firm they were expecting — which is both a
 * trust problem and the single most common paid-tier differentiator in this
 * market.
 *
 * ═══ WHERE EACH FIELD LANDS ═══
 *
 *   logo              signing page header + email header
 *   accent colour     primary actions on the signing page, accents in email
 *   sender name       the display name in the `from:` header
 *
 * ═══ THREE THINGS THIS DELIBERATELY DOES NOT TOUCH ═══
 *
 * The completion CERTIFICATE stays visually neutral. It is an evidentiary
 * document whose layout is load-bearing for the audit trail, and a tenant should
 * not be able to restyle the record of what happened.
 *
 * Account emails (`auth_confirmation`, `auth_recovery`) are never branded. They
 * concern a ContractGo account rather than a tenant, and they arrive before the
 * recipient has any relationship with the organization.
 *
 * The sender ADDRESS never changes — only the display name. The address is the
 * domain Resend verified, and moving it breaks SPF/DKIM. A per-tenant sending
 * domain is a different feature with its own verification flow.
 *
 * ═══ WHY THE SENDER NAME IS VALIDATED SO HARD ═══
 *
 * It is interpolated into an SMTP header and into email HTML, and
 * `interpolate()` in `shared--send-email` escapes nothing. A newline injects
 * headers; `<`, `>`, `"` and `,` break the `Name <addr>` grammar. The database
 * has a CHECK saying the same thing — this is the fast, legible half of it.
 */

/** Mirrors `organizations_email_sender_name_check`. */
const SENDER_NAME_FORBIDDEN = /[\r\n<>",]/;

export const Page_OrgSettingsBranding = () => {
    const { organizationId } = useParams({
        from: "/_protected/$organizationId/settings/branding",
    });
    const [form] = Form.useForm<{ email_sender_name: string }>();

    const { organization, query } = useQ_Tables_Organization({ organizationId });
    const qRole = useQ_Tables_MyRole({ organizationId });
    const { mutation } = useM_OrgSettings_OrganizationUpdate({ organizationId });

    const isOwner = qRole.role === "owner";

    const [brandColor, setBrandColor] = useState<string | null>(null);

    useEffect(() => {
        if (!organization) return;
        setBrandColor(organization.brand_color);
        form.setFieldsValue({ email_sender_name: organization.email_sender_name ?? "" });
    }, [organization, form]);

    if (query.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;

    return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {!isOwner && (
                <App_OrgOwnerOnlyAlert
                    organizationId={organizationId}
                    what="this organization's branding"
                />
            )}

            <Card title="Logo">
                <PageOrgSettingsBranding_LogoUpload
                    organizationId={organizationId}
                    logoUrl={Utils_Organization_LogoSrc(organization)}
                    disabled={!isOwner}
                />
            </Card>

            <Card title="Accent colour">
                <Space direction="vertical" size="middle">
                    <Space align="center">
                        <ColorPicker
                            disabled={!isOwner}
                            // `#RRGGBB` with no alpha: the column's CHECK is
                            // exactly that shape, and an 8-digit value would be
                            // rejected by the database after a clean-looking save.
                            format="hex"
                            disabledAlpha
                            value={brandColor ?? undefined}
                            onChangeComplete={(colour) => setBrandColor(colour.toHexString())}
                            showText
                        />
                        {brandColor && isOwner && (
                            <Button type="link" onClick={() => setBrandColor(null)}>
                                Reset to default
                            </Button>
                        )}
                    </Space>
                    <Typography.Text type="secondary">
                        Used for primary buttons on the signing page and accents in your emails. It
                        is presentation only — it never changes what a signer can do.
                    </Typography.Text>
                </Space>
            </Card>

            <Card title="Email sender name">
                <Form form={form} layout="vertical" disabled={!isOwner} style={{ maxWidth: 480 }}>
                    <Form.Item
                        name="email_sender_name"
                        label="Display name"
                        extra="Shown as the sender of every document email. The sending address itself does not change — it stays the verified ContractGo domain, which is what keeps your mail out of spam folders."
                        rules={[
                            { max: 64, message: "Keep it under 64 characters" },
                            {
                                validator: (_, value: string) =>
                                    !value || !SENDER_NAME_FORBIDDEN.test(value)
                                        ? Promise.resolve()
                                        : Promise.reject(
                                              new Error(
                                                  'A sender name cannot contain < > " , or line breaks'
                                              )
                                          ),
                            },
                        ]}
                    >
                        <Input placeholder="Acme Legal" />
                    </Form.Item>
                </Form>
            </Card>

            {isOwner && (
                <Button
                    type="primary"
                    loading={mutation.isPending}
                    onClick={async () => {
                        // Validated before submitting rather than relying on a
                        // `Form` submit, because the colour lives outside the form
                        // and all three fields save together.
                        const values = await form.validateFields();
                        const senderName = values.email_sender_name?.trim() ?? "";
                        mutation.mutate({
                            brand_color: brandColor,
                            // Empty means "no custom name", and the column's CHECK
                            // rejects a blank string — so it must go back as NULL.
                            email_sender_name: senderName === "" ? null : senderName,
                        });
                    }}
                >
                    Save changes
                </Button>
            )}
        </Space>
    );
};
