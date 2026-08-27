import { useState } from "react";
import { Alert, Checkbox, DatePicker, Form, Input, Modal, Typography, theme } from "antd";
import type { Dayjs } from "dayjs";
import { Page_OrgSettingsApiKeys_RevealPanel } from "./Page_OrgSettingsApiKeys_RevealPanel";
import type { ApiKey_Scope } from "@/hooks/useM_ApiKeys_Issue";

/**
 * Create a key, then show it once.
 *
 * TWO STATES IN ONE MODAL rather than two modals. The credential must be
 * rendered in the same surface the admin is already looking at, without a
 * dismiss-and-reopen in between — every extra step between "created" and
 * "copied" is a step where it gets lost.
 */

/**
 * ⚠ THE SCOPE LIST IS DRAWN FROM THE POSTGRES ENUM, NOT FROM STRING LITERALS.
 *
 * `ApiKey_Scope` is `Supabase_Enums<"api_keys_scopes_enum">`, so this record
 * fails to compile if a scope is added to the database and not offered here, and
 * fails again if someone types a scope that does not exist. CG-044 chose an enum
 * over `TEXT[]` for exactly this: a typo in a scope name becomes a build failure
 * instead of a silent 403 that an integrator debugs for an afternoon.
 *
 * `admin` IS ABSENT FROM THE TYPE ITSELF. Member management, ownership transfer
 * and organization deletion are never machine actions, and leaving the value out
 * of the enum makes "not grantable to a key" a schema fact rather than a review
 * convention — so there is nothing to remember to omit here.
 */
const SCOPE_COPY: Record<ApiKey_Scope, { label: string; help: string }> = {
    member: {
        label: "Read documents",
        help: "Look up a document's status, its recipients and its digests, and get a download URL. Cannot send anything.",
    },
    send_documents: {
        label: "Send documents",
        help: "Everything above, plus create and void documents and mint embedded signing links. This is the scope that can put a contract in front of a counterparty.",
    },
    manage_templates: {
        label: "Manage templates",
        help: "Read and change templates. Not needed to send documents from existing ones.",
    },
};

const SCOPE_ORDER: ApiKey_Scope[] = ["member", "send_documents", "manage_templates"];

type FormValues = {
    name: string;
    scopes: ApiKey_Scope[];
    origins: string;
    expiresAt: Dayjs | null;
};

export const Page_OrgSettingsApiKeys_CreateModal = ({
    open,
    isSubmitting,
    issuedKey,
    onCreate,
    onClose,
}: {
    open: boolean;
    isSubmitting: boolean;
    /** Non-null once the key exists — the panel below replaces the form. */
    issuedKey: string | null;
    onCreate: (values: {
        name: string;
        scopes: ApiKey_Scope[];
        allowedEmbedOrigins: string[];
        expiresAt: string | null;
    }) => void;
    onClose: () => void;
}) => {
    const { token } = theme.useToken();
    const [form] = Form.useForm<FormValues>();
    const [scopes, setScopes] = useState<ApiKey_Scope[]>(["member"]);

    const handleFinish = (values: FormValues) => {
        onCreate({
            name: values.name.trim(),
            scopes: values.scopes,
            // One per line, blanks dropped. A comma-separated field looks
            // tidier and is worse: origins contain no commas but do contain
            // colons and slashes, so a stray space after a comma becomes part
            // of the value and the match silently fails later.
            allowedEmbedOrigins: (values.origins ?? "")
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            expiresAt: values.expiresAt ? values.expiresAt.toISOString() : null,
        });
    };

    const handleClose = () => {
        form.resetFields();
        setScopes(["member"]);
        onClose();
    };

    return (
        <Modal
            open={open}
            title={issuedKey ? "Your new API key" : "Create an API key"}
            // ⚠ NO BACKDROP OR ESC DISMISS ONCE THE KEY EXISTS. A modal that
            // closes by accident has thrown away a credential that cannot be
            // recovered; the panel's own button is the only way out.
            maskClosable={!issuedKey}
            keyboard={!issuedKey}
            closable={!issuedKey}
            onCancel={handleClose}
            okText="Create key"
            confirmLoading={isSubmitting}
            onOk={issuedKey ? handleClose : () => form.submit()}
            footer={issuedKey ? null : undefined}
            destroyOnHidden
        >
            {issuedKey ? (
                <Page_OrgSettingsApiKeys_RevealPanel
                    label="API key"
                    value={issuedKey}
                    warning="This is the only time it will be shown. If you lose it, revoke this key and create another — there is no way to recover it."
                    onDone={handleClose}
                />
            ) : (
                <Form
                    form={form}
                    layout="vertical"
                    initialValues={{ name: "", scopes: ["member"], origins: "" }}
                    onFinish={handleFinish}
                    requiredMark={false}
                >
                    <Form.Item
                        name="name"
                        label="Name"
                        rules={[{ required: true, message: "Give the key a name" }]}
                        extra="Where this key will be used. It is the only thing identifying it afterwards — the key itself is never shown again."
                    >
                        <Input placeholder="Billing system" autoFocus maxLength={100} />
                    </Form.Item>

                    <Form.Item
                        name="scopes"
                        label="What it may do"
                        rules={[
                            {
                                required: true,
                                message: "Choose at least one",
                                type: "array",
                                min: 1,
                            },
                        ]}
                    >
                        <Checkbox.Group
                            style={{ width: "100%" }}
                            onChange={(v) => setScopes(v as ApiKey_Scope[])}
                        >
                            {SCOPE_ORDER.map((scope) => (
                                <div key={scope} style={{ marginBottom: token.marginXS }}>
                                    <Checkbox value={scope}>{SCOPE_COPY[scope].label}</Checkbox>
                                    <div
                                        style={{
                                            marginLeft: 24,
                                            color: token.colorTextTertiary,
                                            fontSize: token.fontSizeSM,
                                        }}
                                    >
                                        {SCOPE_COPY[scope].help}
                                    </div>
                                </div>
                            ))}
                        </Checkbox.Group>
                    </Form.Item>

                    <Form.Item
                        name="origins"
                        label="Embedded signing origins"
                        extra="One per line, e.g. https://app.example.com — scheme and host only, no path or trailing slash. Leave empty unless you are embedding the signing page."
                    >
                        <Input.TextArea
                            rows={2}
                            placeholder="https://app.example.com"
                            spellCheck={false}
                        />
                    </Form.Item>

                    {scopes.includes("send_documents") && (
                        <Alert
                            type="info"
                            showIcon
                            style={{ marginBottom: token.marginSM }}
                            message="This key can send documents"
                            description="Anyone holding it can put a legally binding contract in front of a counterparty in your organization's name. Store it the way you would store a password."
                        />
                    )}

                    <Form.Item
                        name="expiresAt"
                        label="Expires"
                        extra="Optional. A key with no expiry works until it is revoked."
                    >
                        <DatePicker style={{ width: "100%" }} showTime />
                    </Form.Item>

                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        The key is tied to your account. If your account is removed from this
                        organization, the key stops working.
                    </Typography.Text>
                </Form>
            )}
        </Modal>
    );
};
