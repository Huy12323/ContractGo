import { useState } from "react";
import {
    Alert,
    Button,
    Card,
    Descriptions,
    Input,
    Result,
    Tag,
    Typography,
    Upload,
    theme,
} from "antd";
import {
    CheckCircleFilled,
    CloseCircleFilled,
    InboxOutlined,
    SafetyOutlined,
} from "@ant-design/icons";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { useM_Verify_Document, type Verify_Result } from "@/hooks/useM_Verify_Document";
import {
    utils_Verify_FileSha256,
    utils_Verify_IsSha256,
} from "@/pages/Page_Verify/utils_Verify_FileSha256";

// Public document verification — the only page in the product with no account
// behind it and no link behind it either.
//
// WHO THIS IS FOR. Someone holding a signed ContractGo PDF who wants to know it
// is the document that was actually signed: a counterparty, their lawyer, a
// regulator. They have no ContractGo account and never will.
//
// THE FILE NEVER LEAVES THE BROWSER, and the page says so twice — once before
// the drop zone and once after a result — because that is the difference between
// a tool people use on a confidential contract and one they close. The digest is
// computed with `crypto.subtle` and only the 64 hex characters are sent.
//
// TWO WAYS IN, deliberately. Dropping the PDF is what most people will do; a
// paste box is there for anyone who already ran `sha256sum`, and for the case
// where the file is somewhere the browser cannot reach it.
//
// The server answers `verified: true` or `verified: false` and nothing else —
// an unknown fingerprint, a document that never completed, and a throttled
// caller are one shape on purpose. This page therefore only distinguishes the
// one thing it can know by itself: whether what it was given is a well-formed
// fingerprint at all. Telling someone their document is unrecognised when they
// actually pasted half a hash would send them looking for the wrong problem.

export const Page_Verify = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const mVerify = useM_Verify_Document();

    const [hash, setHash] = useState("");
    const [fileName, setFileName] = useState<string | null>(null);
    const [hashing, setHashing] = useState(false);
    const [malformed, setMalformed] = useState(false);
    const [result, setResult] = useState<Verify_Result | null>(null);

    const reset = () => {
        setResult(null);
        setMalformed(false);
    };

    const check = async (value: string) => {
        const normalised = value.trim().toLowerCase();
        reset();
        if (!utils_Verify_IsSha256(normalised)) {
            setMalformed(true);
            return;
        }
        const outcome = await mVerify.mutation.mutateAsync(normalised).catch(() => null);
        if (outcome) setResult(outcome);
    };

    // `beforeUpload` returning false is Upload's documented way to take the file
    // and cancel the request. There is no endpoint to upload to — that is the
    // point — so this is the whole of the integration.
    const takeFile = async (file: File) => {
        reset();
        setFileName(file.name);
        setHashing(true);
        try {
            const digest = await utils_Verify_FileSha256(file);
            setHash(digest);
            await check(digest);
        } catch (err) {
            console.error(err);
            setMalformed(true);
        } finally {
            setHashing(false);
        }
        return false;
    };

    return (
        <div style={{ width: "100%", maxWidth: 720, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: token.marginLG }}>
                <SafetyOutlined style={{ fontSize: 32, color: token.colorPrimary }} />
                <Typography.Title level={3} style={{ marginTop: token.marginXS, marginBottom: 0 }}>
                    Verify a document
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ marginTop: token.marginXS }}>
                    Check that a signed document is exactly the one that was signed, and see who
                    signed it.
                </Typography.Paragraph>
            </div>

            <Card>
                <Upload.Dragger
                    accept="application/pdf,.pdf"
                    multiple={false}
                    showUploadList={false}
                    disabled={hashing || mVerify.mutation.isPending}
                    beforeUpload={takeFile}
                >
                    <p className="ant-upload-drag-icon">
                        <InboxOutlined />
                    </p>
                    <p className="ant-upload-text">
                        {isMobile ? "Choose the signed PDF" : "Drop the signed PDF here"}
                    </p>
                    <p className="ant-upload-hint">
                        Your file stays on this device. Only its fingerprint — 64 characters
                        calculated in your browser — is sent.
                    </p>
                </Upload.Dragger>

                {fileName && (
                    <Typography.Paragraph
                        type="secondary"
                        style={{ marginTop: token.marginSM, marginBottom: 0 }}
                    >
                        {hashing ? "Calculating fingerprint for " : "Checked "}
                        <Typography.Text strong>{fileName}</Typography.Text>
                    </Typography.Paragraph>
                )}

                <div style={{ marginTop: token.marginLG }}>
                    <Typography.Text type="secondary">
                        Or paste a fingerprint you already have
                    </Typography.Text>
                    <Input.Search
                        value={hash}
                        onChange={(e) => {
                            setHash(e.target.value);
                            reset();
                        }}
                        onSearch={check}
                        placeholder="64 hexadecimal characters"
                        enterButton="Verify"
                        allowClear
                        loading={mVerify.mutation.isPending || hashing}
                        style={{ marginTop: token.marginXS }}
                    />
                </div>
            </Card>

            {malformed && (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: token.marginMD }}
                    message="That is not a document fingerprint"
                    description="A fingerprint is exactly 64 characters, using only the digits 0–9 and the letters a–f. Check that the whole value was copied."
                />
            )}

            {mVerify.mutation.isError && (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginTop: token.marginMD }}
                    message="Could not complete the check"
                    description={mVerify.mutation.error?.message}
                />
            )}

            {result && !result.verified && (
                <Result
                    style={{ paddingBottom: 0 }}
                    icon={<CloseCircleFilled style={{ color: token.colorError }} />}
                    title="This document is not recognised"
                    subTitle="No completed document with this fingerprint was issued here. That usually means the file has been altered since it was signed, or it was not signed through this service."
                />
            )}

            {result?.verified && (
                <Card
                    style={{ marginTop: token.marginMD }}
                    title={
                        <span>
                            <CheckCircleFilled
                                style={{ color: token.colorSuccess, marginRight: token.marginXS }}
                            />
                            Verified
                        </span>
                    }
                >
                    <Typography.Paragraph>
                        This is the{" "}
                        <Typography.Text strong>
                            {result.matched === "certificate"
                                ? "Certificate of Completion"
                                : "signed document"}
                        </Typography.Text>{" "}
                        exactly as it was recorded. It has not been altered by so much as one
                        character since.
                    </Typography.Paragraph>

                    <Descriptions
                        column={1}
                        size="small"
                        items={[
                            { key: "title", label: "Document", children: result.document_title },
                            {
                                key: "org",
                                label: "Issued by",
                                children: result.organization_name,
                            },
                            {
                                key: "completed",
                                label: "Completed",
                                children: result.completed_at
                                    ? new Date(result.completed_at).toLocaleString()
                                    : "—",
                            },
                        ]}
                    />

                    <Typography.Title level={5} style={{ marginTop: token.marginMD }}>
                        Parties ({result.signer_count})
                    </Typography.Title>
                    {result.signers.map((signer, index) => (
                        <div
                            key={`${signer.name}-${index}`}
                            style={{
                                padding: token.paddingSM,
                                borderTop:
                                    index === 0
                                        ? undefined
                                        : `1px solid ${token.colorBorderSecondary}`,
                            }}
                        >
                            <Typography.Text strong>{signer.name}</Typography.Text>{" "}
                            {/* Masked server-side. The domain survives so a reader can
                                confirm the party is at the organisation they expect,
                                which is the actual question someone has here. */}
                            <Typography.Text type="secondary">
                                {signer.email_masked}
                            </Typography.Text>
                            <div style={{ marginTop: 4 }}>
                                <Typography.Text
                                    type="secondary"
                                    style={{ fontSize: token.fontSizeSM }}
                                >
                                    {signer.signed_at
                                        ? `Signed ${new Date(signer.signed_at).toLocaleString()}`
                                        : `Did not sign — ${signer.status}`}
                                </Typography.Text>
                                <div style={{ marginTop: 4 }}>
                                    {signer.auth_methods.map((method) => (
                                        <Tag key={method}>{method.replace(/_/g, " ")}</Tag>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}

                    <Alert
                        type="info"
                        showIcon
                        style={{ marginTop: token.marginMD }}
                        message="What this check does and does not tell you"
                        description="It confirms the file you hold is byte-for-byte the one recorded here, and names the parties. It does not express a legal opinion, and it does not verify anything about the file beyond its fingerprint."
                    />
                </Card>
            )}

            {(result || malformed) && (
                <div style={{ textAlign: "center", marginTop: token.marginMD }}>
                    <Button
                        type="link"
                        onClick={() => {
                            setHash("");
                            setFileName(null);
                            reset();
                        }}
                    >
                        Check another document
                    </Button>
                </div>
            )}
        </div>
    );
};
