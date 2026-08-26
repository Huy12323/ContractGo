// Step 2 — the document itself, with this signer's fields editable.
//
// Thin by design: `App_DocumentFiller` owns the whole rendering surface, and
// this file owns only the step's navigation and its completeness gate. The gate
// is advisory — `signing_submit` re-validates every required field against the
// snapshot, because a client-side check is a courtesy and a server-side one is
// the rule.

import { Alert, Button, Space, Tooltip, Typography, theme } from "antd";
import { App_DocumentFiller } from "@/components/signing/App_DocumentFiller";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import type { Signing_Session } from "@/hooks/useQ_Signing_Session";

type Props = {
    session: Signing_Session;
    fieldValues: Record<string, unknown>;
    onFieldChange: (fieldId: string, value: unknown) => void;
    fieldErrors: Record<string, string>;
    roleColors: Record<string, string>;
    signaturePreview: string | null;
    onBack: () => void;
    onContinue: () => void;
};

const isMeaningful = (v: unknown): boolean =>
    v !== undefined && v !== null && v !== "" && v !== false;

export const PageSign_Filler = ({
    session,
    fieldValues,
    onFieldChange,
    fieldErrors,
    roleColors,
    signaturePreview,
    onBack,
    onContinue,
}: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();

    // Signature and initials fields are satisfied on the NEXT step, not here —
    // counting them as missing would block the signer from reaching the place
    // where they can satisfy them.
    const missing = session.fields.filter(
        (f) =>
            f.editable &&
            f.required &&
            f.type !== "signature" &&
            f.type !== "initials" &&
            !isMeaningful(fieldValues[f.id])
    );

    return (
        <div
            style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                gap: token.marginSM,
                minHeight: 0,
            }}
        >
            {Object.keys(fieldErrors).length > 0 && (
                <Alert
                    type="error"
                    showIcon
                    message="Some required fields are still empty."
                    description="They are highlighted below."
                />
            )}

            <div style={{ flex: 1, minHeight: 0 }}>
                <App_DocumentFiller
                    pdfUrl={session.pdf_url}
                    fields={session.fields}
                    fieldValues={fieldValues}
                    onChange={onFieldChange}
                    otherFieldValues={session.other_field_values}
                    signaturePreview={signaturePreview}
                    signerRoleId={session.signer.role_id}
                    errors={fieldErrors}
                    roleColors={roleColors}
                    onBack={onBack}
                    onContinue={onContinue}
                />
            </div>

            {/* On mobile the field sheet carries the same count, the same named
                list of what is missing, and the same two actions. Rendering this
                as well would put two footers on a 390px screen and leave the
                document with what was left. */}
            {!isMobile && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexShrink: 0,
                        paddingTop: token.paddingXS,
                        borderTop: `1px solid ${token.colorBorderSecondary}`,
                    }}
                >
                    <Typography.Text type={missing.length > 0 ? "warning" : "success"}>
                        {missing.length > 0
                            ? `${missing.length} required field${missing.length === 1 ? "" : "s"} left`
                            : "All required fields complete"}
                    </Typography.Text>
                    <Space>
                        <Button onClick={onBack}>Back</Button>
                        {/* A disabled primary button with no stated reason is the
                        complaint this step actually generates: the signer sees
                        "Continue" refuse to respond and has no way to learn which
                        box is still empty. The tooltip names them. */}
                        <Tooltip
                            title={
                                missing.length > 0
                                    ? `Still to complete: ${missing.map((f) => f.label).join(", ")}`
                                    : ""
                            }
                        >
                            <Button
                                type="primary"
                                disabled={missing.length > 0}
                                onClick={onContinue}
                            >
                                Continue to sign
                            </Button>
                        </Tooltip>
                    </Space>
                </div>
            )}
        </div>
    );
};
