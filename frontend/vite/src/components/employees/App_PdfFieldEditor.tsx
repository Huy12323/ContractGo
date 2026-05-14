import { useCallback, useEffect, useRef } from 'react'
import { Button, Typography, Upload, App, theme } from 'antd'
import { CloseOutlined, UploadOutlined, EditOutlined, FileSearchOutlined, AimOutlined } from '@ant-design/icons'
import { App_PdfDocument } from './App_PdfDocument'
import { App_FieldStateDropdown } from './App_FieldStateDropdown'
import { type App_FieldRenderer_State } from './App_FieldRenderer'
import { MAX_UPLOAD_SIZE_BYTES, MAX_UPLOAD_SIZE_MB } from '@/utils/const_FileUpload'
import type { PdfLayout, PdfLayout_PositionedField, Pdf_FieldType } from '@/types/contractTemplate.types'

type Props = {
    /** Resolved PDF URL (blob URL for pending file, signed R2 URL for saved file).
     *  Resolution lives in the parent modal so the sidebar thumbnail list can render
     *  from the same URL without a duplicate hook call. */
    pdfFileUrl: string | null
    /** Whether a saved or pending PDF exists. Drives the empty-state branch when no URL is
     *  resolved yet (e.g., signed URL still loading). */
    hasPdf: boolean
    pdfLayout: PdfLayout
    onPdfLayoutChange: (layout: PdfLayout) => void
    pdfScale: number
    /** Field selected from the palette and waiting to be dropped onto a page. */
    pendingFieldDrop: { key: string; label: string; type: string } | null
    onPendingFieldDropConsumed: () => void
    /** Arms a click-to-drop from inside the editor (used by "Add signature" — the signature
     *  isn't an employee column, so it has no palette entry; this is the entry point). */
    onArmFieldDrop: (field: { key: string; label: string; type: string }) => void
    /** Newly-picked PDF file held in browser memory until the user clicks Save.
     *  When non-null, the parent renders from a blob URL; modal's Save handler
     *  uploads the file to R2 and patches the template's pdf_file_path. */
    pendingPdfFile: File | null
    onPendingPdfFileChange: (file: File | null) => void
    hrSet: Set<string>
    mandatorySet: Set<string>
    onFieldStateChange: (key: string, next: 'hr' | 'mandatory' | 'optional') => void
    resolveField: (key: string) => { label: string; type: string }
    /** Lifted to the modal so the outline column can render a page list. */
    onNumPagesChange?: (numPages: number) => void
    /** Currently-selected positioned-field key. Lifted to the modal so the palette can
     *  show the selected field with a distinct style, and so navigation from the palette
     *  can set it programmatically. */
    selectedKey: string | null
    onSelectedKeyChange: (key: string | null) => void
    /** Reused from the modal — selects a field and scrolls it to the top of the PDF area.
     *  Used by the morphed "Go to signature" button when a signature is already placed. */
    onNavigateToField: (field: { key: string; label: string; type: string }) => void
}

// Map an employee_column type (or universal field type) to one of the four Pdf_FieldType
// shapes the renderer / burner know how to handle.
const mapToPdfFieldType = (type: string): Pdf_FieldType => {
    const t = type.toLowerCase()
    if (t === 'date' || t === 'birthday') return 'date'
    if (t.includes('select') || t === 'choice') return 'choice'
    if (t === 'signature') return 'signature'
    return 'text' // text / email / phone / number / unknown all fall here
}

// Default field box sizes as percentages of the page. Single-line types use a height
// approximating a one-line text input on US Letter (~26px when rendered at fit-to-width).
// Signature is taller for hand-drawn signatures.
const DEFAULT_BOX_SIZE: Record<Pdf_FieldType, { w_pct: number; h_pct: number }> = {
    text: { w_pct: 0.2, h_pct: 0.025 },
    choice: { w_pct: 0.2, h_pct: 0.025 },
    date: { w_pct: 0.2, h_pct: 0.025 },
    signature: { w_pct: 0.3, h_pct: 0.08 },
}

const MIN_PCT = 0.02
const SIGNATURE_FIELD_KEY = 'signature'

// Static text labels for each field state — shown as a small badge in the corner of
// every field box (selected or not) so HR can read state at a glance.
const STATE_LABELS: Record<App_FieldRenderer_State, string> = {
    hr: 'HR-FILL',
    mandatory: 'MANDATORY',
    optional: 'OPTIONAL',
}

// Single-line field types render at a fixed height (no vertical resize). Resize handles
// for these fields appear on left/right edges only — width is the only dimension HR adjusts.
const SINGLE_LINE_TYPES = new Set<Pdf_FieldType>(['text', 'choice', 'date'])
const isSingleLineType = (t: Pdf_FieldType) => SINGLE_LINE_TYPES.has(t)

// 8-direction resize handle identifiers — n/s/e/w edges + 4 corners.
type ResizeCorner = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export const App_PdfFieldEditor = ({
    pdfFileUrl,
    hasPdf,
    pdfLayout,
    onPdfLayoutChange,
    pdfScale,
    pendingFieldDrop,
    onPendingFieldDropConsumed,
    onArmFieldDrop,
    onPendingPdfFileChange,
    hrSet,
    mandatorySet,
    onFieldStateChange,
    resolveField,
    onNumPagesChange,
    selectedKey,
    onSelectedKeyChange,
    onNavigateToField,
}: Props) => {
    const { token } = theme.useToken()
    const { message, modal } = App.useApp()
    const setSelectedKey = onSelectedKeyChange

    // Active drag/resize ref — captures pointer-down state so move handlers can compute deltas
    // without going through React state for every move event.
    const dragRef = useRef<
        | null
        | {
              key: string
              mode: 'move' | 'resize'
              corner?: ResizeCorner
              startClientX: number
              startClientY: number
              startField: PdfLayout_PositionedField
              pageRect: DOMRect
          }
    >(null)

    const updateField = useCallback(
        (key: string, patch: Partial<PdfLayout_PositionedField>) => {
            onPdfLayoutChange(pdfLayout.map((f) => (f.key === key ? { ...f, ...patch } : f)))
        },
        [pdfLayout, onPdfLayoutChange],
    )

    const removeField = (key: string) => {
        onPdfLayoutChange(pdfLayout.filter((f) => f.key !== key))
        if (selectedKey === key) setSelectedKey(null)
    }

    // Keyboard delete: when a field is selected, Delete or Backspace removes it.
    // Suppressed when focus is in an input/textarea/contenteditable so typing
    // backspace inside e.g. the form-name field doesn't accidentally delete a field.
    useEffect(() => {
        if (!selectedKey) return
        const handleKeydown = (e: KeyboardEvent) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return
            const target = e.target as HTMLElement | null
            if (target) {
                const tag = target.tagName
                if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
            }
            e.preventDefault()
            onPdfLayoutChange(pdfLayout.filter((f) => f.key !== selectedKey))
            setSelectedKey(null)
        }
        window.addEventListener('keydown', handleKeydown)
        return () => window.removeEventListener('keydown', handleKeydown)
    }, [selectedKey, pdfLayout, onPdfLayoutChange, setSelectedKey])

    // Click outside the selected field deselects. The FieldBox marks itself with
    // `data-pdf-field-box`; clicks inside (including resize handles, state dropdown
    // trigger, delete button) keep selection. ANTD popovers (state dropdown menu)
    // portal outside the box and stop propagation in their own handlers — they don't
    // bubble here.
    useEffect(() => {
        if (!selectedKey) return
        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null
            if (target?.closest('[data-pdf-field-box]')) return
            // Also keep selection if click is on the palette item that's currently
            // selected (clicking it shouldn't toggle off selection).
            if (target?.closest('[data-pdf-palette-item]')) return
            setSelectedKey(null)
        }
        document.addEventListener('click', handleClick)
        return () => document.removeEventListener('click', handleClick)
    }, [selectedKey, setSelectedKey])

    const handlePointerMove = useCallback((e: PointerEvent) => {
        const drag = dragRef.current
        if (!drag) return
        const dx = e.clientX - drag.startClientX
        const dy = e.clientY - drag.startClientY
        const dxPct = dx / drag.pageRect.width
        const dyPct = dy / drag.pageRect.height

        if (drag.mode === 'move') {
            const next_x = clamp01(drag.startField.x_pct + dxPct)
            const next_y = clamp01(drag.startField.y_pct + dyPct)
            // Re-clamp using width/height so the box can't be dragged off the right/bottom edge
            updateField(drag.key, {
                x_pct: Math.min(next_x, 1 - drag.startField.w_pct),
                y_pct: Math.min(next_y, 1 - drag.startField.h_pct),
            })
        } else {
            // 8-direction resize. Corner identifier contains 'n'/'s'/'e'/'w' tokens; each
            // axis updates independently based on which edge of the corner is being dragged.
            const corner = drag.corner ?? 'se'
            let { x_pct, y_pct, w_pct, h_pct } = drag.startField

            if (corner.includes('e')) {
                w_pct = Math.max(MIN_PCT, drag.startField.w_pct + dxPct)
            } else if (corner.includes('w')) {
                const newW = Math.max(MIN_PCT, drag.startField.w_pct - dxPct)
                x_pct = drag.startField.x_pct + (drag.startField.w_pct - newW)
                w_pct = newW
            }

            if (corner.includes('s')) {
                h_pct = Math.max(MIN_PCT, drag.startField.h_pct + dyPct)
            } else if (corner.includes('n')) {
                const newH = Math.max(MIN_PCT, drag.startField.h_pct - dyPct)
                y_pct = drag.startField.y_pct + (drag.startField.h_pct - newH)
                h_pct = newH
            }

            // Clamp position so the resized box stays inside the page
            updateField(drag.key, {
                x_pct: clamp01(x_pct),
                y_pct: clamp01(y_pct),
                w_pct: Math.min(w_pct, 1 - clamp01(x_pct)),
                h_pct: Math.min(h_pct, 1 - clamp01(y_pct)),
            })
        }
    }, [updateField])

    const handlePointerUp = useCallback(() => {
        dragRef.current = null
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
    }, [handlePointerMove])

    const startDrag = (
        e: React.PointerEvent,
        field: PdfLayout_PositionedField,
        mode: 'move' | 'resize',
        corner?: ResizeCorner,
    ) => {
        e.stopPropagation()
        e.preventDefault()
        const pageDiv = (e.currentTarget as HTMLElement).closest('[data-pdf-page-overlay]')
        if (!pageDiv) return
        dragRef.current = {
            key: field.key,
            mode,
            corner,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startField: { ...field },
            pageRect: pageDiv.getBoundingClientRect(),
        }
        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)
    }

    const handlePageClickForDrop = (e: React.PointerEvent<HTMLDivElement>, pageNumber: number) => {
        if (!pendingFieldDrop) return
        const overlayRect = e.currentTarget.getBoundingClientRect()
        const clickXPct = (e.clientX - overlayRect.left) / overlayRect.width
        const clickYPct = (e.clientY - overlayRect.top) / overlayRect.height
        const fieldType = mapToPdfFieldType(pendingFieldDrop.type)
        const defaultSize = DEFAULT_BOX_SIZE[fieldType]

        // If a field with this key already exists, remove the previous instance — fields
        // can only appear once on a PDF (mirrors TipTap kind's used-key semantics).
        const otherFields = pdfLayout.filter((f) => f.key !== pendingFieldDrop.key)
        const newField: PdfLayout_PositionedField = {
            key: pendingFieldDrop.key,
            page: pageNumber,
            x_pct: clamp01(clickXPct - defaultSize.w_pct / 2),
            y_pct: clamp01(clickYPct - defaultSize.h_pct / 2),
            w_pct: defaultSize.w_pct,
            h_pct: defaultSize.h_pct,
            type: fieldType,
        }
        // Clamp so the box stays inside the page
        newField.x_pct = Math.min(newField.x_pct, 1 - newField.w_pct)
        newField.y_pct = Math.min(newField.y_pct, 1 - newField.h_pct)

        onPdfLayoutChange([...otherFields, newField])
        onPendingFieldDropConsumed()
        setSelectedKey(pendingFieldDrop.key)
    }

    const signatureField = pdfLayout.find((f) => f.key === SIGNATURE_FIELD_KEY)
    const hasSignature = !!signatureField

    const handleSignatureButton = () => {
        if (!hasPdf) {
            message.warning('Upload a PDF first')
            return
        }
        if (hasSignature) {
            // Already placed — navigate to it (scroll + select). To re-place, the user
            // selects the existing signature on the PDF and presses Delete (or × button),
            // then re-clicks this button to add again.
            onNavigateToField({ key: SIGNATURE_FIELD_KEY, label: 'Signature', type: 'signature' })
            return
        }
        // Not yet placed — arm a click-to-drop. Reserved 'signature' key + 'signature'
        // type drives single-instance enforcement and the signature-specific render path.
        onArmFieldDrop({ key: SIGNATURE_FIELD_KEY, label: 'Signature', type: 'signature' })
    }

    const handleUpload = (file: File) => {
        // Hold the file in memory until the modal's Save handler uploads it to R2 + patches
        // the template. This avoids requiring HR to save once before they can preview the PDF
        // and also avoids orphan R2 objects if HR discards their work.
        if (file.type !== 'application/pdf') {
            message.error('Only PDF files are accepted')
            return false
        }
        // Validate size at pick time — same ceiling the upload mutation enforces. Caught
        // here so HR doesn't place a bunch of fields against an oversized PDF only to find
        // out at Save time that the upload will reject it.
        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
            message.error(`PDF exceeds ${MAX_UPLOAD_SIZE_MB}MB limit`)
            return false
        }
        onPendingPdfFileChange(file)
        return false // Tell antd Upload to skip its default xhr upload
    }

    const handleReplaceClick = () => {
        modal.confirm({
            title: 'Replace source PDF?',
            content: (
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                    Uploading a new PDF will replace the current one when you save. Field positions stay
                    where they are — review them after the new PDF loads in case the page layout has shifted.
                </Typography.Paragraph>
            ),
            okText: 'Choose new PDF',
            okButtonProps: { danger: true },
            cancelText: 'Cancel',
            onOk: () => {
                // Trigger the hidden Upload by clicking it programmatically.
                const input = document.getElementById(
                    'pdf-replace-input',
                ) as HTMLInputElement | null
                input?.click()
            },
        })
    }

    // Empty state — no saved PDF and no pending in-memory file
    if (!hasPdf) {
        return (
            <div
                style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
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
                <Typography.Text type="secondary" style={{ textAlign: 'center', maxWidth: 400 }}>
                    Upload a PDF to start placing fields. The file is held in your browser until you save —
                    on save it's stored privately in R2 and visible only to admins of this organization.
                </Typography.Text>
                <Upload accept="application/pdf" beforeUpload={handleUpload} showUploadList={false}>
                    <Button type="primary" icon={<UploadOutlined />}>
                        Upload PDF
                    </Button>
                </Upload>
            </div>
        )
    }

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, gap: token.marginSM }}>
            {/* Action bar */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: token.marginSM,
                    padding: `${token.paddingXXS}px ${token.paddingSM}px`,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    flexShrink: 0,
                }}
            >
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    {pendingFieldDrop
                        ? `Click on a page to drop "${pendingFieldDrop.label}"`
                        : `${pdfLayout.length} field${pdfLayout.length === 1 ? '' : 's'} placed`}
                </Typography.Text>
<div style={{ marginLeft: 'auto', display: 'flex', gap: token.marginXS }}>
                    <Button
                        size="small"
                        type="text"
                        icon={hasSignature ? <AimOutlined /> : <EditOutlined />}
                        onClick={handleSignatureButton}
                    >
                        {hasSignature ? 'Go to signature' : 'Add signature'}
                    </Button>
                    <Upload
                        accept="application/pdf"
                        beforeUpload={handleUpload}
                        showUploadList={false}
                        id={'pdf-replace-input'}
                        openFileDialogOnClick={false}
                    >
                        <Button size="small" type="text" icon={<UploadOutlined />} onClick={handleReplaceClick}>
                            Replace PDF
                        </Button>
                    </Upload>
                </div>
            </div>

            {/* PDF render with positioned-field overlays */}
            <div style={{ flex: 1, minHeight: 0 }}>
                {pdfFileUrl ? (
                    <App_PdfDocument
                        fileUrl={pdfFileUrl}
                        scale={pdfScale}
                        onLoadSuccess={({ numPages }) => onNumPagesChange?.(numPages)}
                        overlayRenderer={({ pageNumber }) => (
                            <div
                                data-pdf-page-overlay
                                onPointerDown={(e) => {
                                    // Use pointerdown not click — preventing default suppresses the
                                    // synthetic click event in some browsers, which made the original
                                    // onClick-based drop unreliable. Drop fires on first contact;
                                    // there's no drag intent for the drop action anyway.
                                    if (!pendingFieldDrop) return
                                    e.preventDefault()
                                    handlePageClickForDrop(e, pageNumber)
                                }}
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    // react-pdf's text layer has z-index: 2 baked into its
                                    // stylesheet; without an explicit z-index here the textLayer's
                                    // <span> children intercept clicks over the page area. Bumping
                                    // to 3 puts the overlay (and FieldBoxes inside it) on top.
                                    zIndex: 3,
                                    pointerEvents: pendingFieldDrop ? 'auto' : 'none',
                                    cursor: pendingFieldDrop ? 'crosshair' : 'default',
                                }}
                            >
                                {pdfLayout
                                    .filter((f) => f.page === pageNumber)
                                    .map((f) => {
                                        const state: App_FieldRenderer_State = hrSet.has(f.key)
                                            ? 'hr'
                                            : mandatorySet.has(f.key)
                                                ? 'mandatory'
                                                : 'optional'
                                        const stateBorder =
                                            state === 'hr'
                                                ? token.colorInfo
                                                : state === 'mandatory'
                                                    ? token.colorError
                                                    : token.colorBorder
                                        const isSelected = selectedKey === f.key
                                        const fieldMeta = f.key === SIGNATURE_FIELD_KEY
                                            ? { label: 'Signature', type: 'signature' }
                                            : resolveField(f.key)
                                        return (
                                            <FieldBox
                                                key={f.key}
                                                field={f}
                                                fieldLabel={fieldMeta.label}
                                                isSelected={isSelected}
                                                stateBorder={stateBorder}
                                                state={state}
                                                onSelect={() => setSelectedKey(f.key)}
                                                onStartMove={(e) => startDrag(e, f, 'move')}
                                                onStartResize={(e, corner) => startDrag(e, f, 'resize', corner)}
                                                onDelete={() => removeField(f.key)}
                                                onStateChange={(next) => onFieldStateChange(f.key, next)}
                                            />
                                        )
                                    })}
                            </div>
                        )}
                        onLoadError={(err) => message.error(`Failed to load PDF: ${err.message}`)}
                    />
                ) : (
                    <div style={{ padding: token.paddingMD, textAlign: 'center' }}>
                        <Typography.Text type="secondary">Loading PDF…</Typography.Text>
                    </div>
                )}
            </div>
        </div>
    )
}

// --- Field box subcomponent (positioned on the page overlay) -----------------

type FieldBoxProps = {
    field: PdfLayout_PositionedField
    fieldLabel: string
    isSelected: boolean
    stateBorder: string
    state: App_FieldRenderer_State
    onSelect: () => void
    onStartMove: (e: React.PointerEvent) => void
    onStartResize: (e: React.PointerEvent, corner: ResizeCorner) => void
    onDelete: () => void
    onStateChange: (next: 'hr' | 'mandatory' | 'optional') => void
}

const FieldBox = ({
    field,
    fieldLabel,
    isSelected,
    stateBorder,
    state,
    onSelect,
    onStartMove,
    onStartResize,
    onDelete,
    onStateChange,
}: FieldBoxProps) => {
    const { token } = theme.useToken()
    // Signature fields are stateless — they don't carry HR / mandatory / optional
    // semantics. Only employees sign, and the captured signature image flows through
    // the existing TipTap-kind App_SignaturePad path. The box on the PDF is purely a
    // position marker (no state badge, no state dropdown).
    const isSignatureField = field.type === 'signature'

    const handleStyle: React.CSSProperties = {
        position: 'absolute',
        width: 10,
        height: 10,
        background: token.colorPrimary,
        border: `1px solid ${token.colorBgContainer}`,
        borderRadius: 2,
        pointerEvents: 'auto',
    }

    return (
        <div
            data-pdf-field-box
            onPointerDown={(e) => {
                // Select on pointer-down so this works regardless of whether the user
                // releases without moving (just clicks) or drags. Selecting on click
                // (the natural fit) is unreliable here because startDrag's
                // preventDefault below suppresses the synthetic click event.
                e.stopPropagation()
                onSelect()
                onStartMove(e)
            }}
            style={{
                position: 'absolute',
                left: `${field.x_pct * 100}%`,
                top: `${field.y_pct * 100}%`,
                width: `${field.w_pct * 100}%`,
                height: `${field.h_pct * 100}%`,
                border: `2px solid ${stateBorder}`,
                background: isSelected
                    ? `${token.colorPrimary}1A` // 10% opacity
                    : `${token.colorBgContainer}CC`, // 80% opacity
                borderRadius: token.borderRadiusSM,
                pointerEvents: 'auto',
                cursor: 'move',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: `0 ${token.paddingXXS}px`,
                fontSize: token.fontSizeSM,
                overflow: 'hidden',
                boxShadow: isSelected ? token.boxShadow : undefined,
            }}
        >
            <Typography.Text
                ellipsis
                style={{ fontSize: token.fontSizeSM, lineHeight: 1, flex: 1, minWidth: 0 }}
            >
                {fieldLabel}
            </Typography.Text>
            {!isSelected && !isSignatureField && (
                // Static state badge — visible at all times so HR can scan field states
                // without having to click each box. Same colors as the box border so the
                // visual stays consistent. Replaced by the interactive dropdown when selected.
                // Signature fields are stateless (always employee-signed) so no badge.
                <Typography.Text
                    style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: 0.5,
                        color: stateBorder,
                        lineHeight: 1,
                        flexShrink: 0,
                        marginLeft: token.marginXXS,
                    }}
                >
                    {STATE_LABELS[state]}
                </Typography.Text>
            )}
            {isSelected && (
                <div
                    style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    {/* Signature fields don't carry state (always employee-signed) — no dropdown. */}
                    {!isSignatureField && (
                        <App_FieldStateDropdown state={state} onChange={onStateChange} />
                    )}
                    <Button
                        type="text"
                        size="small"
                        icon={<CloseOutlined />}
                        onClick={(e) => {
                            e.stopPropagation()
                            onDelete()
                        }}
                        danger
                    />
                </div>
            )}
            {/* Resize handles — only visible when selected. Single-line types (text/choice/date)
                get only left/right edge handles so HR can resize width but not height (their
                visual height is fixed to one line). Signature gets all 4 corners for free width
                and height adjustment. */}
            {isSelected && isSingleLineType(field.type) && (
                <>
                    <div
                        onPointerDown={(e) => onStartResize(e, 'w')}
                        style={{
                            ...handleStyle,
                            top: '50%',
                            left: -5,
                            transform: 'translateY(-50%)',
                            cursor: 'ew-resize',
                        }}
                    />
                    <div
                        onPointerDown={(e) => onStartResize(e, 'e')}
                        style={{
                            ...handleStyle,
                            top: '50%',
                            right: -5,
                            transform: 'translateY(-50%)',
                            cursor: 'ew-resize',
                        }}
                    />
                </>
            )}
            {isSelected && !isSingleLineType(field.type) && (
                <>
                    <div
                        onPointerDown={(e) => onStartResize(e, 'nw')}
                        style={{ ...handleStyle, top: -5, left: -5, cursor: 'nwse-resize' }}
                    />
                    <div
                        onPointerDown={(e) => onStartResize(e, 'ne')}
                        style={{ ...handleStyle, top: -5, right: -5, cursor: 'nesw-resize' }}
                    />
                    <div
                        onPointerDown={(e) => onStartResize(e, 'sw')}
                        style={{ ...handleStyle, bottom: -5, left: -5, cursor: 'nesw-resize' }}
                    />
                    <div
                        onPointerDown={(e) => onStartResize(e, 'se')}
                        style={{ ...handleStyle, bottom: -5, right: -5, cursor: 'nwse-resize' }}
                    />
                </>
            )}
        </div>
    )
}
