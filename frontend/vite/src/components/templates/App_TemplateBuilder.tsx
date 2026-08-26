import { useEffect } from "react";
import { App, Button, Typography, Upload, theme } from "antd";
import { CloseOutlined, FileSearchOutlined, UploadOutlined } from "@ant-design/icons";
import { App_PdfDocument } from "@/components/pdf/App_PdfDocument";
import {
    App_PdfFieldBox,
    App_PdfFieldOverlay,
    App_PdfFieldResizeHandles,
    const_PdfOverlay_BoxAttr,
    const_PdfOverlay_KeepSelectionAttr,
    usePdfFieldDrag,
    utils_PdfOverlay_PlaceBox,
    type PdfOverlay_Box,
    type PdfOverlay_ResizeCorner,
} from "@/components/pdf/App_PdfFieldOverlay";
import { App_SignerRoleDropdown } from "./App_SignerRoleDropdown";
import { const_TemplateFieldTypeIcons } from "./App_TemplateFieldPalette";
import { App_RoleLegendChip } from "./App_RoleLegendChip";
import {
    const_TemplateFieldTypeMap,
    const_TemplateField_SingleLineTypes,
    utils_Templates_NewFieldId,
} from "./const_TemplateFieldTypeOptions";
import { const_TemplateRole_OrphanColor } from "./const_TemplateSignerRoleColors";
import { MAX_UPLOAD_SIZE_BYTES, MAX_UPLOAD_SIZE_MB } from "@/utils/const_FileUpload";
import type {
    SignerRole,
    TemplateField,
    TemplateField_Type,
    TemplateLayout,
} from "@/types/template.types";

// The positioned-field canvas — formerly `App_PdfFieldEditor`.
//
// The geometry half of that component was already domain-free and moved wholesale
// into `components/pdf/App_PdfFieldOverlay`. What changed here is only the
// semantic half:
//
//   • fields are keyed by `id`, not by `key`, so a template can carry three date
//     fields (v1 replaced a same-key field on drop — one placement per employee
//     column was the model);
//   • `resolveField` is gone — v2 fields inline their own label, type and options,
//     which is what lets a snapshot render after its template is deleted;
//   • the hr/mandatory/optional tri-state became a role tag (who fills) plus a
//     `required` flag edited in the properties panel (two orthogonal facts);
//   • `SIGNATURE_FIELD_KEY` and its single-instance rule are gone — signature is
//     just a field type now, and a two-party contract needs two of them.

// Everything a click can land on without meaning "deselect". The ANTD entries are
// the layers that render through a portal on <body>: a Select's dropdown is not a
// descendant of the panel that owns the Select, so no amount of marking up the
// panel itself would catch them.
const const_TemplateBuilder_KeepSelectionSelector = [
    `[${const_PdfOverlay_KeepSelectionAttr}]`,
    ".ant-select-dropdown",
    ".ant-picker-dropdown",
    ".ant-dropdown",
    ".ant-popover",
    ".ant-tooltip",
    ".ant-modal-root",
    ".ant-message",
    ".ant-notification",
].join(",");

type Props = {
    /** Resolved PDF URL — blob URL for a pending file, signed R2 URL for a saved one.
     *  Resolved by the parent so the thumbnail rail renders from the same URL. */
    pdfFileUrl: string | null;
    /** Whether a saved or pending PDF exists. Drives the empty state while a signed
     *  URL is still resolving. */
    hasPdf: boolean;
    layout: TemplateLayout;
    onLayoutChange: (layout: TemplateLayout) => void;
    /** Patches one field. Separate from `onLayoutChange` so the properties panel and
     *  the canvas write through the same path. */
    onFieldPatch: (fieldId: string, patch: Partial<TemplateField>) => void;
    signerRoles: SignerRole[];
    pdfScale: number;
    /** Field type armed in the palette, waiting for a page click. */
    pendingFieldDrop: { key: string; label: string; type: TemplateField_Type } | null;
    onPendingFieldDropConsumed: () => void;
    /** Role assigned to newly-placed fields — the rail's highlighted role, or the first. */
    activeRoleId: string;
    /** When set, other roles' fields render dimmed so one party's flow can be checked. */
    highlightedRoleId: string | null;
    /** PDF picked but not yet uploaded. Held in memory until the page saves, so no
     *  orphan R2 object is created if the work is discarded. */
    onPendingPdfFileChange: (file: File | null) => void;
    onNumPagesChange?: (numPages: number) => void;
    selectedFieldId: string | null;
    onSelectedFieldIdChange: (fieldId: string | null) => void;
};

export const App_TemplateBuilder = ({
    pdfFileUrl,
    hasPdf,
    layout,
    onLayoutChange,
    onFieldPatch,
    signerRoles,
    pdfScale,
    pendingFieldDrop,
    onPendingFieldDropConsumed,
    activeRoleId,
    highlightedRoleId,
    onPendingPdfFileChange,
    onNumPagesChange,
    selectedFieldId,
    onSelectedFieldIdChange,
}: Props) => {
    const { token } = theme.useToken();
    const { message, modal } = App.useApp();

    const rolesById = Object.fromEntries(signerRoles.map((r) => [r.id, r]));
    const roleColor = (roleId: string) =>
        rolesById[roleId]?.color ?? const_TemplateRole_OrphanColor;

    const { startDrag } = usePdfFieldDrag<string>((fieldId, patch) => onFieldPatch(fieldId, patch));

    const removeField = (fieldId: string) => {
        onLayoutChange(layout.filter((f) => f.id !== fieldId));
        if (selectedFieldId === fieldId) onSelectedFieldIdChange(null);
    };

    // Keyboard delete for the selected field. Suppressed while focus is in an input
    // so backspacing inside the properties panel doesn't delete the field being edited.
    useEffect(() => {
        if (!selectedFieldId) return;
        const handleKeydown = (e: KeyboardEvent) => {
            if (e.key !== "Delete" && e.key !== "Backspace") return;
            const target = e.target as HTMLElement | null;
            if (target) {
                const tag = target.tagName;
                if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
                // Focus anywhere in the editing chrome — the Required switch, an open
                // Select, a button in the palette — is someone working ON the field,
                // not asking to destroy it. The tag check above misses those because
                // a focused ANTD Switch or Select trigger is a <button>/<div>.
                if (target.closest(const_TemplateBuilder_KeepSelectionSelector)) return;
            }
            e.preventDefault();
            onLayoutChange(layout.filter((f) => f.id !== selectedFieldId));
            onSelectedFieldIdChange(null);
        };
        window.addEventListener("keydown", handleKeydown);
        return () => window.removeEventListener("keydown", handleKeydown);
    }, [selectedFieldId, layout, onLayoutChange, onSelectedFieldIdChange]);

    // Click outside a field box deselects. Boxes mark themselves `data-pdf-field-box`
    // and the editing chrome marks itself `data-pdf-keep-selection`.
    //
    // The ANTD half is not optional. A previous version excluded only the boxes and
    // a `[data-pdf-palette-item]` attribute that is set nowhere, on the assumption
    // that ANTD popups stop propagation — they do not. Every click that reached this
    // listener from the properties panel (its inputs, its two Selects, and the
    // Select dropdowns that portal to <body> outside the panel's DOM subtree
    // entirely) cleared the selection and unmounted the panel mid-edit. Editing a
    // field's properties was effectively impossible.
    useEffect(() => {
        if (!selectedFieldId) return;
        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            if (target.closest(`[${const_PdfOverlay_BoxAttr}]`)) return;
            if (target.closest(const_TemplateBuilder_KeepSelectionSelector)) return;
            onSelectedFieldIdChange(null);
        };
        document.addEventListener("click", handleClick);
        return () => document.removeEventListener("click", handleClick);
    }, [selectedFieldId, onSelectedFieldIdChange]);

    const handlePlace = (pageNumber: number, xPct: number, yPct: number) => {
        if (!pendingFieldDrop) return;
        const typeOption = const_TemplateFieldTypeMap[pendingFieldDrop.type];
        const field: TemplateField = {
            id: utils_Templates_NewFieldId(layout.map((f) => f.id)),
            key: pendingFieldDrop.key,
            label: pendingFieldDrop.label,
            type: pendingFieldDrop.type,
            role_id: activeRoleId,
            required: true,
            ...(pendingFieldDrop.type === "choice" ? { options: [] } : {}),
            page: pageNumber,
            ...utils_PdfOverlay_PlaceBox(xPct, yPct, typeOption.defaultSize),
        };
        onLayoutChange([...layout, field]);
        onPendingFieldDropConsumed();
        onSelectedFieldIdChange(field.id);
    };

    const handleUpload = (file: File) => {
        if (file.type !== "application/pdf") {
            message.error("Only PDF files are accepted");
            return false;
        }
        // Checked at pick time against the same ceiling the upload mutation enforces,
        // so nobody places twenty fields against a PDF that will be rejected on save.
        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
            message.error(`PDF exceeds ${MAX_UPLOAD_SIZE_MB}MB limit`);
            return false;
        }
        onPendingPdfFileChange(file);
        return false; // antd Upload skips its default xhr upload
    };

    const handleReplaceClick = () => {
        modal.confirm({
            title: "Replace source PDF?",
            content: (
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                    Uploading a new PDF replaces the current one when you save. Field positions stay
                    where they are — review them after the new PDF loads in case the page layout has
                    shifted.
                </Typography.Paragraph>
            ),
            okText: "Choose new PDF",
            okButtonProps: { danger: true },
            cancelText: "Cancel",
            onOk: () => {
                const input = document.getElementById(
                    "pdf-replace-input"
                ) as HTMLInputElement | null;
                input?.click();
            },
        });
    };

    if (!hasPdf) {
        return (
            <div
                style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: token.marginSM,
                    border: `1px dashed ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusLG,
                    padding: token.paddingXL,
                }}
            >
                <FileSearchOutlined style={{ fontSize: 48, color: token.colorTextTertiary }} />
                <Typography.Title level={5} style={{ marginBottom: 0 }}>
                    No source PDF
                </Typography.Title>
                <Typography.Text type="secondary" style={{ textAlign: "center", maxWidth: 400 }}>
                    Upload a PDF to start placing fields. The file stays in your browser until you
                    save — on save it is stored privately and visible only to this organization.
                </Typography.Text>
                <Upload accept="application/pdf" beforeUpload={handleUpload} showUploadList={false}>
                    <Button type="primary" icon={<UploadOutlined />}>
                        Upload PDF
                    </Button>
                </Upload>
            </div>
        );
    }

    return (
        // `minWidth: 0` is not cosmetic: without it this flex item keeps
        // `min-width: auto`, which resolves to the min-content width of the PDF
        // canvas below and lets the rendered page dictate this column's width
        // instead of the other way round (see `App_PdfDocument`'s `contain` note).
        <div
            style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                gap: token.marginSM,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginXS,
                    padding: `${token.paddingXXS}px ${token.paddingSM}px`,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    flexShrink: 0,
                }}
            >
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    {pendingFieldDrop
                        ? `Click a page to place "${pendingFieldDrop.label}"`
                        : `${layout.length} field${layout.length === 1 ? "" : "s"} placed`}
                </Typography.Text>
                <App_RoleLegendChip signerRoles={signerRoles} layout={layout} />

                <div style={{ marginLeft: "auto", display: "flex", gap: token.marginXS }}>
                    <Upload
                        accept="application/pdf"
                        beforeUpload={handleUpload}
                        showUploadList={false}
                        id="pdf-replace-input"
                        openFileDialogOnClick={false}
                    >
                        <Button
                            size="small"
                            type="text"
                            icon={<UploadOutlined />}
                            onClick={handleReplaceClick}
                        >
                            Replace PDF
                        </Button>
                    </Upload>
                </div>
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
                {pdfFileUrl ? (
                    <App_PdfDocument
                        fileUrl={pdfFileUrl}
                        scale={pdfScale}
                        onLoadSuccess={({ numPages }) => onNumPagesChange?.(numPages)}
                        onLoadError={(err) => message.error(`Failed to load PDF: ${err.message}`)}
                        overlayRenderer={({ pageNumber }) => (
                            <App_PdfFieldOverlay
                                pageNumber={pageNumber}
                                isArmed={!!pendingFieldDrop}
                                onPlace={handlePlace}
                            >
                                {layout
                                    .filter((f) => f.page === pageNumber)
                                    .map((field) => (
                                        <TemplateFieldBox
                                            key={field.id}
                                            field={field}
                                            color={roleColor(field.role_id)}
                                            signerRoles={signerRoles}
                                            isSelected={selectedFieldId === field.id}
                                            isDimmed={
                                                !!highlightedRoleId &&
                                                field.role_id !== highlightedRoleId
                                            }
                                            onSelect={() => onSelectedFieldIdChange(field.id)}
                                            onStartMove={(e) =>
                                                startDrag(e, field.id, field, "move")
                                            }
                                            onStartResize={(e, corner) =>
                                                startDrag(e, field.id, field, "resize", corner)
                                            }
                                            onDelete={() => removeField(field.id)}
                                            onRoleChange={(roleId) =>
                                                onFieldPatch(field.id, { role_id: roleId })
                                            }
                                        />
                                    ))}
                            </App_PdfFieldOverlay>
                        )}
                    />
                ) : (
                    <div style={{ padding: token.paddingMD, textAlign: "center" }}>
                        <Typography.Text type="secondary">Loading PDF…</Typography.Text>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- One placed field on the page overlay ------------------------------------

type FieldBoxProps = {
    field: TemplateField;
    color: string;
    signerRoles: SignerRole[];
    isSelected: boolean;
    isDimmed: boolean;
    onSelect: () => void;
    onStartMove: (e: React.PointerEvent) => void;
    onStartResize: (e: React.PointerEvent, corner: PdfOverlay_ResizeCorner) => void;
    onDelete: () => void;
    onRoleChange: (roleId: string) => void;
};

const TemplateFieldBox = ({
    field,
    color,
    signerRoles,
    isSelected,
    isDimmed,
    onSelect,
    onStartMove,
    onStartResize,
    onDelete,
    onRoleChange,
}: FieldBoxProps) => {
    const { token } = theme.useToken();
    const roleName = signerRoles.find((r) => r.id === field.role_id)?.name ?? "Unassigned";

    const box: PdfOverlay_Box = field;

    return (
        <App_PdfFieldBox
            box={box}
            borderColor={color}
            isSelected={isSelected}
            style={{
                cursor: "move",
                opacity: isDimmed ? 0.35 : 1,
                // TOP-ALIGNED, not centred. A signature box is ~8% of the page tall,
                // and a vertically centred label floated in the middle of that empty
                // rectangle looking like content rather than a caption. Pinned to the
                // top edge it reads as a header strip and the body of the box stays
                // visibly empty — which is exactly what it is: room for the signer.
                alignItems: "flex-start",
                padding: 0,
            }}
            onPointerDownCapture={(e) => {
                // Select on pointer-down: startDrag's preventDefault suppresses the
                // synthetic click, so selecting on click is unreliable here.
                e.stopPropagation();
                onSelect();
                onStartMove(e);
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginXXS,
                    width: "100%",
                    minWidth: 0,
                    padding: `1px ${token.paddingXXS}px`,
                    lineHeight: 1.3,
                }}
            >
                {/* The palette's own glyph for this type. Type is otherwise invisible
                    on the canvas — "Company" and "Company signature" are the same
                    rectangle until you click one. */}
                <span
                    style={{
                        color,
                        fontSize: token.fontSizeSM,
                        display: "flex",
                        flexShrink: 0,
                        opacity: 0.8,
                    }}
                >
                    {const_TemplateFieldTypeIcons[field.type]}
                </span>

                <Typography.Text
                    ellipsis
                    style={{ fontSize: token.fontSizeSM, lineHeight: 1.3, flex: 1, minWidth: 0 }}
                >
                    {field.label}
                    {field.required && <span style={{ color: token.colorError }}> *</span>}
                </Typography.Text>

                {!isSelected && (
                    // Static role badge, always visible, so who-fills-what is scannable
                    // without clicking each box. Replaced by the dropdown when selected.
                    // A tinted chip rather than bare coloured text: at 10px the colour
                    // alone was doing all the work and washed out against the page.
                    <span
                        style={{
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: 0.3,
                            color,
                            background: `${color}1F`,
                            borderRadius: token.borderRadiusXS,
                            padding: "0 3px",
                            lineHeight: 1.5,
                            flexShrink: 0,
                            maxWidth: "50%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {roleName}
                    </span>
                )}

                {isSelected && (
                    <div
                        style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <App_SignerRoleDropdown
                            roleId={field.role_id}
                            signerRoles={signerRoles}
                            onChange={onRoleChange}
                        />
                        <Button
                            type="text"
                            size="small"
                            icon={<CloseOutlined />}
                            danger
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete();
                            }}
                        />
                    </div>
                )}
            </div>

            {isSelected && (
                <App_PdfFieldResizeHandles
                    horizontalOnly={const_TemplateField_SingleLineTypes.has(field.type)}
                    onStartResize={onStartResize}
                />
            )}
        </App_PdfFieldBox>
    );
};
