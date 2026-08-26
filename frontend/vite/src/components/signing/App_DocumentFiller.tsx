// The signer's view of the document: the source PDF with every positioned field
// overlaid, the signer's own fields editable and everyone else's locked.
//
// This is the v2 replacement for `App_ContractFiller`, which stays in place
// until its remaining v1 onboarding consumers retire. The difference is not
// cosmetic — it is what CG-001 bought:
//
//   * `App_ContractFiller` needed `columns` and `choices` props to discover what
//     a field was CALLED and what TYPE it had, because a v1 layout stored bare
//     `col_*` keys. v2 fields are self-describing, so there is no lookup, no
//     `employee_columns` dependency, and no `UNIVERSAL_FIELDS` list.
//   * "who fills this" and "is this required" were one tri-state spread across
//     three parallel key arrays. They are now `role_id` and `required`, so
//     editability is `field.editable` (computed server-side against the redeemed
//     token) rather than a client-side inference the client could lie about.
//
// The TipTap branch is gone with the kind — PDF-first is decided.
//
// One deliberate choice worth stating: the signer sees the WHOLE document,
// including fields belonging to other parties. Hiding them would mean the page
// they agree to differs from the page that gets burned.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Tag, Typography, theme } from "antd";
import { App_PdfDocument } from "@/components/pdf/App_PdfDocument";
import { App_PdfZoomControls } from "@/components/pdf/App_PdfZoomControls";
import {
    App_SigningFieldSheet,
    const_SigningFieldSheet_CollapsedHeight,
} from "@/components/signing/App_SigningFieldSheet";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { utils_Signing_IsMyField, type Signing_Field } from "@/hooks/useQ_Signing_Session";

type Props = {
    pdfUrl: string;
    fields: Signing_Field[];
    /** Values this signer has entered, keyed by field id. */
    fieldValues: Record<string, unknown>;
    onChange: (fieldId: string, value: unknown) => void;
    /** Values entered by other parties — rendered, never editable. */
    otherFieldValues?: Record<string, unknown>;
    /** Signature data URL, previewed in this signer's signature boxes. */
    signaturePreview?: string | null;
    /** Which boxes are THIS signer's. Signature boxes are never `editable` —
     *  they are captured on the sign step — so ownership is a role test. */
    signerRoleId?: string;
    /** Per-field messages, keyed by field id. Set after a rejected submit. */
    errors?: Record<string, string>;
    /** Locks everything — used once the signer has signed. */
    readOnly?: boolean;
    /** Colour per role id, for the locked-field legend. */
    roleColors?: Record<string, string>;
    /**
     * Step navigation, used only by the mobile field sheet — on a phone the sheet
     * replaces the step's own footer, because two stacked footers on a 390px
     * screen leave no document. Omitted on desktop, where `PageSign_Filler` still
     * owns its footer.
     */
    onBack?: () => void;
    onContinue?: () => void;
};

const isMeaningful = (v: unknown): boolean =>
    v !== undefined && v !== null && v !== "" && v !== false;

export const App_DocumentFiller = ({
    pdfUrl,
    fields,
    fieldValues,
    onChange,
    otherFieldValues,
    signaturePreview,
    signerRoleId,
    errors,
    readOnly = false,
    roleColors,
    onBack,
    onContinue,
}: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const [scale, setScale] = useState(1.0);
    const listRef = useRef<HTMLDivElement>(null);

    const myFields = useMemo(() => fields.filter((f) => f.editable), [fields]);
    const remaining = useMemo(
        () => myFields.filter((f) => f.required && !isMeaningful(fieldValues[f.id])).length,
        [myFields, fieldValues]
    );

    // Mobile stepper position. Lives here rather than in the sheet because the
    // on-page boxes set it too — tapping a box IS how you jump to its field.
    const [activeIndex, setActiveIndex] = useState(0);
    const [sheetCollapsed, setSheetCollapsed] = useState(false);

    const scrollToField = useCallback(
        (fieldId: string, options?: { blockTop?: boolean }) => {
            const el = document.querySelector(
                `[data-sign-field="${fieldId}"]`
            ) as HTMLElement | null;
            if (!el) return;
            // `start` on mobile, not `center`: the sheet occupies the bottom of the
            // screen, so a box centred in the SCROLL PANE lands underneath it.
            // Putting it near the top of the pane keeps it in what is actually visible.
            el.scrollIntoView({
                block: options?.blockTop ? "start" : "center",
                behavior: "smooth",
            });
            el.style.transition = "box-shadow 0.3s";
            el.style.boxShadow = `0 0 0 3px ${token.colorPrimaryBorder}`;
            setTimeout(() => {
                el.style.boxShadow = "";
                el.style.transition = "";
            }, 1500);
        },
        [token.colorPrimaryBorder]
    );

    // Follow the stepper with the page. In an effect rather than in the click
    // handler so every route to a new field — Next, Previous, "next required",
    // tapping a box — scrolls, instead of only the ones that remembered to.
    const activeFieldId = isMobile ? myFields[activeIndex]?.id : undefined;
    useEffect(() => {
        if (!activeFieldId) return;
        scrollToField(activeFieldId, { blockTop: true });
    }, [activeFieldId, scrollToField]);

    // ============================================================
    // Mobile — read-only document plus the guided field sheet
    // ============================================================
    if (isMobile) {
        return (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
                <div
                    style={{
                        flex: 1,
                        minHeight: 0,
                        // The collapsed sheet is fixed to the viewport, so it covers
                        // whatever is under it. Reserving its height is what makes
                        // the last field on the last page reachable.
                        paddingBottom: const_SigningFieldSheet_CollapsedHeight,
                    }}
                >
                    <App_PdfDocument
                        fileUrl={pdfUrl}
                        scale={scale}
                        enablePinchZoom
                        onScaleChange={setScale}
                        overlayRenderer={({ pageNumber }) => (
                            <div
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    zIndex: 3,
                                    pointerEvents: "none",
                                }}
                            >
                                {fields
                                    .filter((f) => f.page === pageNumber)
                                    .map((f) => {
                                        const index = myFields.indexOf(f);
                                        return (
                                            <FieldBox
                                                key={f.id}
                                                field={f}
                                                value={
                                                    f.editable
                                                        ? fieldValues[f.id]
                                                        : otherFieldValues?.[f.id]
                                                }
                                                onChange={(v) => onChange(f.id, v)}
                                                signaturePreview={signaturePreview}
                                                isMine={
                                                    signerRoleId
                                                        ? utils_Signing_IsMyField(f, signerRoleId)
                                                        : f.editable
                                                }
                                                // The whole point: on a phone a box is a
                                                // TARGET, never an input. It is sized from
                                                // `w_pct`/`h_pct` of the page, which at this
                                                // width is far below a usable touch target,
                                                // and widening it would move where the value
                                                // is burned.
                                                readOnly
                                                roleColor={roleColors?.[f.role_id]}
                                                hasError={!!errors?.[f.id]}
                                                isActive={index >= 0 && index === activeIndex}
                                                onTap={
                                                    !readOnly && index >= 0
                                                        ? () => {
                                                              setActiveIndex(index);
                                                              setSheetCollapsed(false);
                                                          }
                                                        : undefined
                                                }
                                            />
                                        );
                                    })}
                            </div>
                        )}
                    />
                </div>

                <App_SigningFieldSheet
                    fields={myFields}
                    values={fieldValues}
                    onChange={onChange}
                    errors={errors}
                    activeIndex={activeIndex}
                    onActiveIndexChange={setActiveIndex}
                    collapsed={sheetCollapsed}
                    onCollapsedChange={setSheetCollapsed}
                    readOnly={readOnly}
                    onBack={onBack ?? (() => {})}
                    onContinue={onContinue ?? (() => {})}
                />
            </div>
        );
    }

    return (
        <div style={{ display: "flex", gap: token.marginMD, height: "100%", minHeight: 0 }}>
            {myFields.length > 0 && (
                <div
                    style={{
                        width: 260,
                        minWidth: 260,
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                    }}
                >
                    <div style={{ marginBottom: token.marginSM, flexShrink: 0 }}>
                        <Typography.Text strong>Your fields</Typography.Text>{" "}
                        {!readOnly && remaining > 0 && <Tag color="warning">{remaining} left</Tag>}
                        {!readOnly && remaining === 0 && <Tag color="success">All done</Tag>}
                    </div>
                    <div
                        ref={listRef}
                        style={{
                            flex: 1,
                            overflow: "auto",
                            display: "flex",
                            flexDirection: "column",
                            gap: token.marginXS,
                        }}
                    >
                        {myFields.map((field) => (
                            <FieldCard
                                key={field.id}
                                field={field}
                                value={fieldValues[field.id]}
                                onChange={(v) => onChange(field.id, v)}
                                error={errors?.[field.id]}
                                readOnly={readOnly}
                                onNavigate={() => scrollToField(field.id)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* `minWidth: 0` for the same reason as in `App_TemplateBuilder`: at
                `min-width: auto` this column inherits the PDF canvas's min-content
                width and the rendered page starts driving its own container. */}
            <div
                style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                    gap: token.marginXS,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        padding: `${token.paddingXXS}px ${token.paddingSM}px`,
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                        flexShrink: 0,
                    }}
                >
                    <App_PdfZoomControls scale={scale} onScaleChange={setScale} />
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                    <App_PdfDocument
                        fileUrl={pdfUrl}
                        scale={scale}
                        overlayRenderer={({ pageNumber }) => (
                            // zIndex 3 clears react-pdf's text layer (z-index 2), which
                            // would otherwise swallow clicks on the inputs below.
                            // pointer-events: none lets clicks fall through to the page;
                            // each box opts back in.
                            <div
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    zIndex: 3,
                                    pointerEvents: "none",
                                }}
                            >
                                {fields
                                    .filter((f) => f.page === pageNumber)
                                    .map((f) => (
                                        <FieldBox
                                            key={f.id}
                                            field={f}
                                            value={
                                                f.editable
                                                    ? fieldValues[f.id]
                                                    : otherFieldValues?.[f.id]
                                            }
                                            onChange={(v) => onChange(f.id, v)}
                                            signaturePreview={signaturePreview}
                                            isMine={
                                                signerRoleId
                                                    ? utils_Signing_IsMyField(f, signerRoleId)
                                                    : f.editable
                                            }
                                            readOnly={readOnly}
                                            roleColor={roleColors?.[f.role_id]}
                                            hasError={!!errors?.[f.id]}
                                        />
                                    ))}
                            </div>
                        )}
                    />
                </div>
            </div>
        </div>
    );
};

// ============================================================
// Left-column card
// ============================================================

type CardProps = {
    field: Signing_Field;
    value: unknown;
    onChange: (value: unknown) => void;
    error?: string;
    readOnly: boolean;
    onNavigate: () => void;
};

const FieldCard = ({ field, value, onChange, error, readOnly, onNavigate }: CardProps) => {
    const { token } = theme.useToken();
    const filled = isMeaningful(value);

    return (
        <div
            onClick={onNavigate}
            style={{
                border: `1px solid ${error ? token.colorError : token.colorBorderSecondary}`,
                borderLeft: `3px solid ${
                    error
                        ? token.colorError
                        : filled
                          ? token.colorSuccess
                          : field.required
                            ? token.colorWarning
                            : token.colorBorder
                }`,
                borderRadius: token.borderRadiusSM,
                padding: token.paddingXS,
                background: token.colorBgContainer,
                cursor: "pointer",
            }}
        >
            <Typography.Text style={{ fontSize: token.fontSizeSM }}>
                {field.label}
                {field.required && <span style={{ color: token.colorError }}> *</span>}
            </Typography.Text>
            <div onClick={(e) => e.stopPropagation()} style={{ marginTop: token.marginXXS }}>
                <FieldInput field={field} value={value} onChange={onChange} readOnly={readOnly} />
            </div>
            {error && (
                <Typography.Text type="danger" style={{ fontSize: token.fontSizeSM }}>
                    {error}
                </Typography.Text>
            )}
        </div>
    );
};

/** Plain HTML controls rather than ANTD ones: the same component renders inside
 *  the on-page overlay, where an ANTD input's padding and border-radius would
 *  no longer match the box the sender positioned. */
const FieldInput = ({
    field,
    value,
    onChange,
    readOnly,
    style,
}: {
    field: Signing_Field;
    value: unknown;
    onChange: (value: unknown) => void;
    readOnly: boolean;
    style?: React.CSSProperties;
}) => {
    const { token } = theme.useToken();

    const baseStyle: React.CSSProperties = {
        width: "100%",
        border: `1px solid ${token.colorBorder}`,
        borderRadius: token.borderRadiusSM,
        padding: "2px 4px",
        fontSize: "inherit",
        fontFamily: "inherit",
        background: token.colorBgContainer,
        color: token.colorText,
        ...style,
    };

    if (field.type === "checkbox") {
        return (
            <input
                type="checkbox"
                disabled={readOnly}
                checked={value === true || value === "true"}
                onChange={(e) => onChange(e.target.checked)}
                style={{ ...style, cursor: readOnly ? "default" : "pointer" }}
            />
        );
    }

    if (field.type === "choice") {
        return (
            <select
                disabled={readOnly}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => onChange(e.target.value)}
                style={baseStyle}
            >
                {/* The empty option carries the label so an unfilled box on the
                    page reads as its own prompt instead of a blank rectangle. */}
                <option value="">{field.label}</option>
                {(field.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </select>
        );
    }

    return (
        <input
            type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
            disabled={readOnly}
            placeholder={field.label}
            title={field.label}
            value={
                value === undefined || value === null
                    ? ""
                    : typeof value === "string"
                      ? value
                      : String(value)
            }
            onChange={(e) => onChange(e.target.value)}
            style={baseStyle}
        />
    );
};

// ============================================================
// On-page box
// ============================================================

type BoxProps = {
    field: Signing_Field;
    value: unknown;
    onChange: (value: unknown) => void;
    signaturePreview?: string | null;
    /** This box belongs to the signer at the keyboard. */
    isMine: boolean;
    readOnly: boolean;
    roleColor?: string;
    hasError: boolean;
    /** Mobile only — this is the field the stepper is currently on. */
    isActive?: boolean;
    /** Mobile only — tapping the box selects it in the stepper. */
    onTap?: () => void;
};

const FieldBox = ({
    field,
    value,
    onChange,
    signaturePreview,
    isMine,
    readOnly,
    roleColor,
    hasError,
    isActive = false,
    onTap,
}: BoxProps) => {
    const { token } = theme.useToken();

    const baseStyle: React.CSSProperties = {
        position: "absolute",
        left: `${field.x_pct * 100}%`,
        top: `${field.y_pct * 100}%`,
        width: `${field.w_pct * 100}%`,
        height: `${field.h_pct * 100}%`,
        pointerEvents: "auto",
        boxSizing: "border-box",
    };

    /**
     * The tap target, and the reason it is a separate absolutely-positioned child
     * rather than padding on the box.
     *
     * The box's geometry IS the burn geometry — `x_pct`/`y_pct`/`w_pct`/`h_pct`
     * are what `pdfBurn` renders the value into. Growing the box to reach 44px
     * would move the value on the finished document. This overlays a bigger
     * invisible target on top of an unchanged box: `inset` pulls it outward,
     * `min-width`/`min-height` floor it at a fingertip, and the translate keeps it
     * centred on the box it belongs to. Nothing about the box itself changes.
     */
    const tapTarget = onTap ? (
        <div
            role="button"
            tabIndex={0}
            aria-label={`Fill in ${field.label}`}
            onClick={onTap}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onTap();
            }}
            style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: "calc(100% + 16px)",
                height: "calc(100% + 16px)",
                minWidth: 44,
                minHeight: 44,
                cursor: "pointer",
                // Above the box's own contents so the tap always reaches this and
                // never a disabled input underneath it.
                zIndex: 1,
            }}
        />
    ) : null;

    const activeRing: React.CSSProperties = isActive
        ? { outline: `2px solid ${token.colorPrimary}`, outlineOffset: 2 }
        : {};

    if (field.type === "signature" || field.type === "initials") {
        // Only THIS signer's signature boxes preview the mark being captured.
        // Painting it into another role's box would show the signer a document
        // that claims someone else has already signed.
        const preview = isMine ? signaturePreview : null;
        return (
            <div data-sign-field={field.id} style={baseStyle}>
                {preview ? (
                    <img
                        src={preview}
                        alt={field.label}
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                ) : (
                    <div
                        style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            border: `1px dashed ${roleColor ?? token.colorBorder}`,
                            borderRadius: token.borderRadiusSM,
                            color: token.colorTextTertiary,
                            fontStyle: "italic",
                            fontSize: "inherit",
                        }}
                    >
                        {field.label}
                    </div>
                )}
            </div>
        );
    }

    // Attachments are separate documents in the envelope, not marks on the page.
    if (field.type === "attachment") return null;

    if (!field.editable || readOnly) {
        const empty = !isMeaningful(value);
        const label =
            field.type === "choice"
                ? (field.options?.find((o) => o.value === String(value))?.label ??
                  String(value ?? ""))
                : field.type === "checkbox"
                  ? value === true || value === "true"
                      ? "X"
                      : ""
                  : String(value ?? "");
        return (
            <div
                data-sign-field={field.id}
                title={field.label}
                style={{
                    ...baseStyle,
                    ...activeRing,
                    display: "flex",
                    alignItems: "center",
                    padding: "0 4px",
                    fontSize: "inherit",
                    color: empty ? token.colorTextTertiary : token.colorText,
                    fontStyle: empty ? "italic" : "normal",
                    borderRadius: token.borderRadiusSM,
                    // A tappable box is one of MINE rendered read-only for the
                    // stepper, so it gets the signer's own affordance — a dashed
                    // ring while empty — rather than the "someone else fills this"
                    // tint below. Without it, a phone signer cannot tell their own
                    // unfilled boxes from another party's on the page.
                    border: onTap && empty ? `1px dashed ${token.colorPrimary}` : undefined,
                    outline:
                        hasError && !isActive
                            ? `2px solid ${token.colorError}`
                            : activeRing.outline,
                    // A locked field is tinted in its owner's role colour so the
                    // signer can tell "someone else fills this" from "I missed one".
                    background: onTap
                        ? empty
                            ? token.colorPrimaryBg
                            : "transparent"
                        : roleColor
                          ? `${roleColor}14`
                          : "transparent",
                }}
            >
                {empty ? field.label : label}
                {tapTarget}
            </div>
        );
    }

    return (
        <div
            data-sign-field={field.id}
            style={{
                ...baseStyle,
                display: "flex",
                alignItems: "center",
                outline: hasError ? `2px solid ${token.colorError}` : undefined,
                borderRadius: token.borderRadiusSM,
            }}
        >
            <FieldInput
                field={field}
                value={value}
                onChange={onChange}
                readOnly={false}
                style={{ height: "100%" }}
            />
        </div>
    );
};

/** Shown above the document when the signer has nothing left to do here. */
export const App_DocumentFiller_NothingToFill = () => (
    <Alert
        type="info"
        showIcon
        message="You have no fields to complete on this document — review it and sign below."
    />
);
