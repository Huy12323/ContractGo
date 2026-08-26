// Step 1 — what this document is, and consent before anything is filled.
//
// Consent is asked FIRST rather than at the moment of signing. Agreeing to
// transact electronically is a precondition for the whole ceremony, not a final
// confirmation of it; asking after the signer has spent five minutes filling in
// a document makes "no" expensive, which is precisely what an informed consent
// must not be. It stays editable on the signing step so the answer is never
// trapped.

import { Alert, Button, Card, Descriptions, Typography, theme } from "antd";
import { FileTextOutlined } from "@ant-design/icons";
import { App_SigningConsentGate } from "@/components/signing/App_SigningConsentGate";
import type { Signing_Session } from "@/hooks/useQ_Signing_Session";

// No account gate here, and none is needed: `Page_Sign` refuses to render ANY
// step to a visitor who is not signed in as this document's signer, so by the
// time this component exists the account question is already settled.

type Props = {
    session: Signing_Session;
    consent: boolean;
    onConsentChange: (consent: boolean) => void;
    onContinue: () => void;
};

export const PageSign_Welcome = ({ session, consent, onConsentChange, onContinue }: Props) => {
    const { token } = theme.useToken();

    const myFieldCount = session.fields.filter((f) => f.editable).length;
    const myRequiredCount = session.fields.filter((f) => f.editable && f.required).length;
    const myRole = session.signer_roles.find((r) => r.id === session.signer.role_id);
    const isResign = session.signer.status === "changes_requested";

    return (
        <div
            style={{
                maxWidth: 640,
                margin: "0 auto",
                paddingBottom: token.paddingLG,
                display: "flex",
                flexDirection: "column",
                gap: token.marginMD,
            }}
        >
            <Card>
                <div style={{ display: "flex", flexDirection: "column", gap: token.marginMD }}>
                    <div style={{ display: "flex", alignItems: "center", gap: token.marginSM }}>
                        <FileTextOutlined style={{ fontSize: 28, color: token.colorPrimary }} />
                        <div>
                            <Typography.Title level={4} style={{ margin: 0 }}>
                                {session.request.title}
                            </Typography.Title>
                            <Typography.Text type="secondary">
                                {isResign
                                    ? "You have been asked to sign this document again."
                                    : "You have been asked to sign this document."}
                            </Typography.Text>
                        </div>
                    </div>

                    {/* A signer returning through the review loop must not see the
                        screen they saw the first time. They already signed this;
                        without being told that their signature no longer counts and
                        WHY, the rational move is to close the tab — and the document
                        would then sit waiting on someone who believes they are done.

                        The sender's words are quoted verbatim: they are hashed into
                        the `sender_requested_changes` chain entry, and a paraphrase
                        would make the document's record of the request differ from
                        the request the signer actually received. */}
                    {isResign && (
                        <Alert
                            type="warning"
                            showIcon
                            message="Changes were requested — your earlier signature no longer counts"
                            description={
                                <>
                                    <Typography.Paragraph style={{ marginBottom: token.marginXS }}>
                                        You signed this document earlier. The sender has asked you
                                        to review it and sign again, so it is not complete until you
                                        do. Your earlier signature is kept on the document's audit
                                        trail.
                                    </Typography.Paragraph>
                                    <Typography.Text strong>What they asked for:</Typography.Text>
                                    <Typography.Paragraph
                                        style={{
                                            marginTop: token.marginXXS,
                                            marginBottom: 0,
                                            whiteSpace: "pre-wrap",
                                        }}
                                    >
                                        {session.signer.changes_requested_reason ||
                                            "No explanation was recorded."}
                                    </Typography.Paragraph>
                                </>
                            }
                        />
                    )}

                    <Descriptions column={1} size="small" bordered>
                        <Descriptions.Item label="Signing as">
                            {session.signer.name} ({session.signer.email})
                        </Descriptions.Item>
                        {myRole && (
                            <Descriptions.Item label="Your role">{myRole.name}</Descriptions.Item>
                        )}
                        <Descriptions.Item label="Fields to complete">
                            {myFieldCount === 0
                                ? "None — review and sign"
                                : `${myFieldCount} (${myRequiredCount} required)`}
                        </Descriptions.Item>
                    </Descriptions>

                    <App_SigningConsentGate
                        checked={consent}
                        onChange={onConsentChange}
                        signerName={session.signer.name}
                        signerEmail={session.signer.email}
                    />

                    <Button type="primary" size="large" disabled={!consent} onClick={onContinue}>
                        Review document
                    </Button>
                </div>
            </Card>
        </div>
    );
};
