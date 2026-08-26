import { useEffect } from "react";
import { Checkbox, Form, Input, Modal, Typography, theme } from "antd";
import { Page_SettingsApiKeys_RevealPanel } from "@/pages/Page_SettingsApiKeys/Page_SettingsApiKeys_RevealPanel";
import type { Webhook_Event } from "@/hooks/useM_Webhooks_Create";
import type { Tables_WebhookEndpoints_Row } from "@/hooks/useQ_Tables_WebhookEndpoints";

/**
 * ⚠ THE EVENT LIST IS THE PUBLIC CONTRACT, DRAWN FROM THE POSTGRES ENUM.
 *
 * `Webhook_Event` is `Supabase_Enums<"webhook_endpoints_events_enum">`, so
 * adding a value to the database without offering it here is a build failure,
 * and offering one that does not exist is another. That matters more here than
 * for scopes: these strings appear in `docs/api.md` and in every consumer's
 * switch statement, so a typo would be a documented event that never fires.
 *
 * THE NAMES SAY WHETHER AN EVENT IS ABOUT A PARTY OR THE DOCUMENT.
 * `envelope.recipient_signed` is one person; `envelope.completed` is the whole
 * thing. CG-045 renamed three of these away from `envelope.viewed` /
 * `.signed` / `.declined` for exactly this reason — a consumer routing on them
 * must never have to guess the scope.
 */
const EVENT_COPY: Record<Webhook_Event, string> = {
    "envelope.sent": "A document was sent to its first recipients",
    "envelope.recipient_viewed": "One recipient opened the document",
    "envelope.recipient_signed": "One recipient signed. Not necessarily the last one",
    "envelope.recipient_declined": "One recipient refused to sign",
    "envelope.changes_requested": "The sender sent a turn back for changes",
    "envelope.completed": "Every recipient has signed. The document is final",
    "envelope.expired": "The document passed its deadline unsigned",
    "envelope.voided": "The sender withdrew the document",
};

const EVENT_ORDER: Webhook_Event[] = [
    "envelope.sent",
    "envelope.recipient_viewed",
    "envelope.recipient_signed",
    "envelope.recipient_declined",
    "envelope.changes_requested",
    "envelope.completed",
    "envelope.expired",
    "envelope.voided",
];

type FormValues = { name: string; url: string; events: Webhook_Event[] };

export const Page_SettingsWebhooks_EndpointModal = ({
    open,
    editing,
    isSubmitting,
    issuedSecret,
    onSubmit,
    onClose,
}: {
    open: boolean;
    /** Null for a create, the row for an edit. */
    editing: Tables_WebhookEndpoints_Row | null;
    isSubmitting: boolean;
    issuedSecret: string | null;
    onSubmit: (values: FormValues) => void;
    onClose: () => void;
}) => {
    const { token } = theme.useToken();
    const [form] = Form.useForm<FormValues>();

    useEffect(() => {
        if (!open) return;
        form.setFieldsValue({
            name: editing?.name ?? "",
            url: editing?.url ?? "",
            // `envelope.completed` alone by default. It is the event almost
            // every integration actually wants, and a pre-ticked list of all
            // eight would sign a new consumer up for traffic they have not
            // written a handler for.
            events: (editing?.events as Webhook_Event[]) ?? ["envelope.completed"],
        });
    }, [open, editing, form]);

    const handleClose = () => {
        form.resetFields();
        onClose();
    };

    return (
        <Modal
            open={open}
            title={
                issuedSecret ? "Your signing secret" : editing ? "Edit endpoint" : "Add an endpoint"
            }
            // No accidental dismiss while a secret is on screen — it cannot be
            // shown again, and closing by backdrop click would lose it.
            maskClosable={!issuedSecret}
            keyboard={!issuedSecret}
            closable={!issuedSecret}
            onCancel={handleClose}
            okText={editing ? "Save" : "Add endpoint"}
            confirmLoading={isSubmitting}
            onOk={() => form.submit()}
            footer={issuedSecret ? null : undefined}
            destroyOnHidden
        >
            {issuedSecret ? (
                <Page_SettingsApiKeys_RevealPanel
                    label="Signing secret"
                    value={issuedSecret}
                    warning="Your server needs this to verify that a webhook really came from us. This is the only time it will be shown — if you lose it you must rotate the secret, which stops deliveries working until your server is updated."
                    onDone={handleClose}
                />
            ) : (
                <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false}>
                    <Form.Item
                        name="name"
                        label="Name"
                        rules={[{ required: true, message: "Give the endpoint a name" }]}
                    >
                        <Input placeholder="Production CRM" autoFocus maxLength={100} />
                    </Form.Item>

                    <Form.Item
                        name="url"
                        label="URL"
                        rules={[
                            { required: true, message: "Where should we POST?" },
                            {
                                // The database enforces this with a CHECK
                                // constraint; the form checks too so the refusal
                                // is immediate and legible rather than a
                                // constraint-violation error after a round trip.
                                // The constraint is what makes it TRUE — this is
                                // only what makes it kind.
                                pattern: /^https:\/\/.+/i,
                                message:
                                    "Must start with https://. These payloads name the parties to a contract and cannot go over plain HTTP.",
                            },
                        ]}
                    >
                        <Input
                            placeholder="https://api.example.com/hooks/contractgo"
                            spellCheck={false}
                        />
                    </Form.Item>

                    <Form.Item
                        name="events"
                        label="Send these events"
                        rules={[
                            {
                                required: true,
                                message: "Choose at least one",
                                type: "array",
                                min: 1,
                            },
                        ]}
                    >
                        <Checkbox.Group style={{ width: "100%" }}>
                            {EVENT_ORDER.map((event) => (
                                <div key={event} style={{ marginBottom: token.marginXXS }}>
                                    <Checkbox value={event}>
                                        <Typography.Text code>{event}</Typography.Text>
                                    </Checkbox>
                                    <div
                                        style={{
                                            marginLeft: 24,
                                            color: token.colorTextTertiary,
                                            fontSize: token.fontSizeSM,
                                        }}
                                    >
                                        {EVENT_COPY[event]}
                                    </div>
                                </div>
                            ))}
                        </Checkbox.Group>
                    </Form.Item>

                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        Deliveries are retried for about two days if your server is unreachable.
                        Each one carries an event id — use it to ignore repeats, because a retry can
                        arrive after the first attempt eventually succeeded.
                    </Typography.Text>
                </Form>
            )}
        </Modal>
    );
};
