import { useEffect, useRef, useState } from "react";
import { Alert, Empty, Spin, Tag, Typography, theme } from "antd";
import { App_PdfDocument } from "@/components/pdf/App_PdfDocument";
import { App_PdfFieldBox, App_PdfFieldOverlay } from "@/components/pdf/App_PdfFieldOverlay";
import { App_PdfZoomControls } from "@/components/pdf/App_PdfZoomControls";
import { useQ_Envelope_DocumentUrl } from "@/hooks/useQ_Envelope_DocumentUrl";
import type { SignerRole, TemplateLayout } from "@/types/template.types";

type Props = {
    organizationId: string;
    envelopeId: string;
    /** From the envelope's own `template_snapshot`. Empty for drafts with no snapshot. */
    layout: TemplateLayout;
    roles: SignerRole[];
    /** `prefilled_values` merged under each signer's `field_values`, keyed by field key. */
    values: Record<string, unknown>;
};

const roleColor = (roles: SignerRole[], roleId: string | null | undefined, fallback: string) =>
    roles.find((r) => r.id === roleId)?.color ?? fallback;

/**
 * The envelope's document, rendered beside its details.
 *
 * WHICH PDF, AND WHY THE OVERLAY IS CONDITIONAL. The server prefers the signed
 * document once one exists and falls back to the source, and it reports which it
 * resolved. The field overlay is drawn ONLY over the source: `signing_submit`
 * burns every captured value into the signed PDF, so painting the same values
 * again on top of it would double-render the document at exactly the moment its
 * fidelity matters most.
 *
 * The overlay is inert — `isArmed={false}` leaves it `pointer-events: none`, so
 * text selection and scrolling fall straight through to the page.
 */
export const App_EnvelopeDocumentViewer = ({
    organizationId,
    envelopeId,
    layout,
    roles,
    values,
}: Props) => {
    const { token } = theme.useToken();
    const [scale, setScale] = useState(1.0);
    const qDocument = useQ_Envelope_DocumentUrl({ organizationId, envelopeId });

    // A signed URL that expired while the tab sat open fails the PDF load rather
    // than the fetch, so recovery has to hang off `onLoadError`. Once only, and
    // reset per envelope: an unconditional refetch here would spin forever
    // against a genuinely unreadable file.
    const retriedRef = useRef(false);
    useEffect(() => {
        retriedRef.current = false;
    }, [envelopeId]);

    if (qDocument.query.isPending) {
        return (
            <div
                style={{ display: "flex", flex: 1, justifyContent: "center", alignItems: "center" }}
            >
                <Spin />
            </div>
        );
    }

    if (qDocument.query.isError || !qDocument.document) {
        return (
            <Alert
                type="error"
                showIcon
                style={{ margin: token.marginSM }}
                message="Could not open the document"
                description={
                    qDocument.query.error instanceof Error
                        ? qDocument.query.error.message
                        : undefined
                }
            />
        );
    }

    const isSigned = qDocument.document.variant === "signed";
    const showOverlay = !isSigned && layout.length > 0;

    return (
        <div
            style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginSM,
                    padding: `0 0 ${token.paddingXS}px`,
                }}
            >
                <Typography.Text strong>
                    {isSigned ? "Signed document" : "Source document"}
                </Typography.Text>
                {isSigned && <Tag color="green">Final</Tag>}
                {showOverlay && (
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        {layout.length} {layout.length === 1 ? "field" : "fields"}
                    </Typography.Text>
                )}
                <div style={{ marginLeft: "auto" }}>
                    <App_PdfZoomControls scale={scale} onScaleChange={setScale} />
                </div>
            </div>

            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusLG,
                    overflow: "hidden",
                }}
            >
                <App_PdfDocument
                    fileUrl={qDocument.document.url}
                    scale={scale}
                    onLoadError={() => {
                        if (retriedRef.current) return;
                        retriedRef.current = true;
                        qDocument.query.refetch();
                    }}
                    overlayRenderer={
                        showOverlay
                            ? ({ pageNumber }) => (
                                  <App_PdfFieldOverlay pageNumber={pageNumber} isArmed={false}>
                                      {layout
                                          .filter((field) => field.page === pageNumber)
                                          .map((field) => {
                                              const value = values[field.key];
                                              return (
                                                  <App_PdfFieldBox
                                                      key={field.id}
                                                      box={field}
                                                      isSelected={false}
                                                      borderColor={roleColor(
                                                          roles,
                                                          field.role_id,
                                                          token.colorPrimary
                                                      )}
                                                  >
                                                      <Typography.Text
                                                          ellipsis
                                                          style={{ fontSize: token.fontSizeSM }}
                                                          type={
                                                              value == null
                                                                  ? "secondary"
                                                                  : undefined
                                                          }
                                                      >
                                                          {value == null
                                                              ? field.label
                                                              : String(value)}
                                                      </Typography.Text>
                                                  </App_PdfFieldBox>
                                              );
                                          })}
                                  </App_PdfFieldOverlay>
                              )
                            : undefined
                    }
                />
            </div>
        </div>
    );
};

/** Rendered instead of the viewer when an envelope has no document to show. */
export const App_EnvelopeDocumentViewer_Empty = () => (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No document yet" />
);
