import { useMemo, useEffect, useCallback, useState, useRef, useImperativeHandle, forwardRef } from 'react'
import { Typography, theme } from 'antd'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TableKit } from '@tiptap/extension-table'
import {
    FieldInput,
    FieldRendererContext,
    fieldInputPreviewKey,
    type FieldRendererContextValue,
    type FieldRendererContext_State,
} from './ext_TipTap_FieldInput'
import { App_ContractPreview } from './App_ContractPreview'
import { App_FieldRenderer } from './App_FieldRenderer'
import { App_FieldLegendChip } from './App_FieldLegendChip'
import { App_AttachmentStrip, type UploadContext } from './App_AttachmentStrip'
import { App_PdfDocument } from './App_PdfDocument'
import { App_PdfZoomControls } from './App_PdfZoomControls'
import type { JSONContent } from '@tiptap/core'
import type { Tables_EmployeeColumns_QueryData } from '@/hooks/useQ_Tables_EmployeeColumns'
import type { Tables_EmployeeColumnChoices_QueryData } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import type { PdfLayout, PdfLayout_PositionedField } from '@/types/contractTemplate.types'

const UNIVERSAL_FIELDS = [
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'first_name', label: 'First Name', type: 'text' },
    { key: 'last_name', label: 'Last Name', type: 'text' },
    { key: 'birthday', label: 'Birthday', type: 'date' },
] as const

type SharedProps = {
    fieldValues: Record<string, unknown>
    onChange: (fieldKey: string, value: unknown) => void
    columns: Tables_EmployeeColumns_QueryData
    choices: Tables_EmployeeColumnChoices_QueryData
    mode?: 'fill' | 'review'
    prefilledValues?: Record<string, unknown>
    mandatoryKeys?: string[]
    hrFieldKeys?: string[]
    /** 'hr' = HR can edit any field; 'employee' = HR-state fields render readonly (values locked) */
    fillerRole?: 'hr' | 'employee'
    /** Per-field error messages — shown below the input in red (ANTD danger text). Falsy values hidden. */
    errors?: Record<string, string>
    /** Scope context for file-type field uploads (used by `App_AttachmentStrip`).
     *  Pass `undefined` to render the strip readonly (composer preview, versions modal). */
    uploadContext?: UploadContext
    /** Required when any file-type fields are present — powers filesMap lookup for thumbnails. */
    organization_id?: string
    /** Keys of file-type fields that belong to this template's attachments panel.
     *  When provided, the strip uses THIS list. When omitted, falls back to extracting
     *  file-type fieldInput nodes from `layout` — legacy path for frozen invitation
     *  snapshots that predate AHR-1791. PDF kind always provides this explicitly. */
    attachmentFieldKeys?: string[]
}

// Discriminated by `kind`. Tiptap is the default — existing callsites that don't pass
// `kind` continue to work with no signature change. PDF kind requires `pdfFileUrl` and a
// `PdfLayout` array as `layout`. The composite is a pure consumer of `pdfFileUrl` —
// resolution lives at page/modal level (see Phase D of the AHR-1956 plan).
type Props = SharedProps & (
    | { kind?: 'tiptap'; layout: JSONContent; pdfFileUrl?: never }
    | { kind: 'pdf'; layout: PdfLayout; pdfFileUrl: string | null }
)

const isMeaningful = (v: unknown): boolean => v !== undefined && v !== null && v !== ''

type ExtractedField = { fieldKey: string; fieldLabel: string; fieldType: string }

/** Extracts all fieldInput nodes from TipTap JSONContent. */
export const extractFields = (content: JSONContent): ExtractedField[] => {
    const fields: ExtractedField[] = []
    const walk = (node: JSONContent) => {
        if (node.type === 'fieldInput' && node.attrs) {
            fields.push({
                fieldKey: node.attrs.fieldKey as string,
                fieldLabel: node.attrs.fieldLabel as string,
                fieldType: node.attrs.fieldType as string,
            })
        }
        if (node.content) node.content.forEach(walk)
    }
    walk(content)
    return fields
}

/** Extracts the field list from a PdfLayout array. The layout entries store key+type+coords
 *  but no human label; the label is resolved from columns + universals (or special-cased for
 *  signature). Output shape matches `extractFields` so the fill-card render path is identical
 *  for both kinds.
 *
 *  Universal fields (first_name, last_name, email, birthday) are always included even if HR
 *  didn't place them on the PDF — the approval flow requires first_name + last_name to create
 *  the employee row. Fields not in the layout still appear as fill cards; they just don't
 *  render as overlays on the PDF itself. */
export const extractFields_Pdf = (
    layout: PdfLayout,
    columns: Tables_EmployeeColumns_QueryData,
): ExtractedField[] => {
    const result: ExtractedField[] = layout.map((f) => {
        if (f.key === 'signature') {
            return { fieldKey: f.key, fieldLabel: 'Signature', fieldType: 'signature' }
        }
        const universal = UNIVERSAL_FIELDS.find((u) => u.key === f.key)
        if (universal) {
            return { fieldKey: f.key, fieldLabel: universal.label, fieldType: universal.type }
        }
        const col = columns.find((c) => c.id === f.key)
        return {
            fieldKey: f.key,
            fieldLabel: col?.label ?? f.key,
            fieldType: col?.type ?? f.type,
        }
    })
    const existingKeys = new Set(result.map((f) => f.fieldKey))
    for (const u of UNIVERSAL_FIELDS) {
        if (!existingKeys.has(u.key)) {
            result.push({ fieldKey: u.key, fieldLabel: u.label, fieldType: u.type })
        }
    }
    return result
}

const resolveFieldState = (fieldKey: string, hrSet: Set<string>, mandatorySet: Set<string>): FieldRendererContext_State => {
    if (hrSet.has(fieldKey)) return 'hr'
    if (mandatorySet.has(fieldKey)) return 'mandatory'
    return 'optional'
}

export const App_ContractFiller = (props: Props) => {
    const {
        fieldValues,
        onChange,
        columns,
        choices,
        mode = 'fill',
        prefilledValues,
        mandatoryKeys,
        hrFieldKeys,
        fillerRole = 'hr',
        errors,
        uploadContext,
        organization_id,
        attachmentFieldKeys,
    } = props
    const { token } = theme.useToken()
    const isReview = mode === 'review'

    const mandatorySet = useMemo(() => new Set(mandatoryKeys ?? []), [mandatoryKeys])
    const hrSet = useMemo(() => new Set(hrFieldKeys ?? []), [hrFieldKeys])

    const choicesMap = useMemo(() => {
        const map: Record<string, Array<{ label: string; value: string }>> = {}
        for (const c of choices) {
            const key = c.employee_column_id
            if (!map[key]) map[key] = []
            map[key]!.push({ label: c.label, value: c.value })
        }
        return map
    }, [choices])

    const onChangeRef = useCallback((key: string, val: unknown) => onChange(key, val), [onChange])

    const fieldRendererContextValue = useMemo<FieldRendererContextValue>(
        () => ({
            hrSet,
            mandatorySet,
            mode: isReview ? 'readonly' : 'fill',
            isBuilder: false,
        }),
        [hrSet, mandatorySet, isReview],
    )

    // Extract fields from layout — kind-aware. Tiptap walks the doc for fieldInput nodes;
    // PDF iterates the positioned-field array and resolves labels from columns + universals.
    const fields = useMemo(() => {
        if (props.kind === 'pdf') return extractFields_Pdf(props.layout, columns)
        return extractFields(props.layout)
    }, [props.kind, props.layout, columns])

    // Body subcomponent ref — exposes scrollToField so fill-card click can scroll the
    // right-pane document to the target field on either kind.
    const bodyRef = useRef<ContractFillerBodyRef>(null)
    const navigateToField = useCallback((fieldKey: string) => {
        bodyRef.current?.scrollToField(fieldKey)
    }, [])

    // Build field type + choices lookups
    const fieldTypeMap = useMemo(() => {
        const map: Record<string, string> = {}
        for (const f of UNIVERSAL_FIELDS) map[f.key] = f.type
        for (const c of columns) map[c.id] = c.type
        return map
    }, [columns])

    const fieldChoicesMap = useMemo(() => {
        const map: Record<string, Array<{ label: string; value: string }>> = {}
        for (const c of columns) {
            if (c.type === 'multi_select' || c.type === 'single_select') map[c.id] = choicesMap[c.id] || []
        }
        return map
    }, [columns, choicesMap])

    // File-type fields render in the attachment strip above the contract body, NOT as
    // fill cards in the left column. Two source paths:
    //
    //   * `attachmentFieldKeys` prop provided (post-AHR-1791 templates): use it as the
    //     authoritative file-field list. Layout is already stripped of file nodes.
    //   * `attachmentFieldKeys` omitted (legacy invitation snapshots that predate the
    //     migration): fall back to extracting file-type fieldInput nodes from layout.
    //
    // Signature fields are skipped from BOTH lists — they're a special type captured via
    // App_SignaturePad (tiptap kind) or rendered as a positioned image overlay (pdf kind),
    // never as a fill card or attachment. HR cannot pre-fill a signature.
    const { fileFields, nonFileFields } = useMemo(() => {
        const fileF: typeof fields = []
        const nonFileF: typeof fields = []

        for (const f of fields) {
            const resolvedType = fieldTypeMap[f.fieldKey] || f.fieldType
            if (resolvedType === 'file') {
                if (!attachmentFieldKeys) fileF.push(f) // legacy path
            } else if (resolvedType === 'signature' || f.fieldKey === 'signature') {
                // Signature is special — skip both lists. Captured + displayed elsewhere.
                continue
            } else {
                nonFileF.push(f)
            }
        }

        if (attachmentFieldKeys) {
            for (const key of attachmentFieldKeys) {
                const universal = UNIVERSAL_FIELDS.find((u) => u.key === key)
                if (universal) {
                    fileF.push({ fieldKey: key, fieldLabel: universal.label, fieldType: 'file' })
                } else {
                    const col = columns.find((c) => c.id === key)
                    fileF.push({ fieldKey: key, fieldLabel: col?.label ?? key, fieldType: 'file' })
                }
            }
        }

        return { fileFields: fileF, nonFileFields: nonFileF }
    }, [fields, fieldTypeMap, attachmentFieldKeys, columns])

    // Field-state map for the strip — same resolver used inline for non-file cards.
    const fieldStatesMap = useMemo(() => {
        const map: Record<string, FieldRendererContext_State> = {}
        for (const f of fileFields) map[f.fieldKey] = resolveFieldState(f.fieldKey, hrSet, mandatorySet)
        return map
    }, [fileFields, hrSet, mandatorySet])

    const stripErrors = useMemo(() => {
        if (!errors) return undefined
        const out: Record<string, string> = {}
        for (const f of fileFields) {
            const msg = errors[f.fieldKey]
            if (msg) out[f.fieldKey] = msg
        }
        return out
    }, [errors, fileFields])

    return (
        <FieldRendererContext.Provider value={fieldRendererContextValue}>
        <div style={{ display: 'flex', gap: token.marginMD, height: '100%' }}>
            {/* Left: non-file field list */}
            {nonFileFields.length > 0 && (
                <div style={{
                    width: 240,
                    minWidth: 240,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: token.marginSM,
                        flexShrink: 0,
                    }}>
                        <Typography.Text strong>
                            {isReview ? `Fields (${nonFileFields.length})` : `Pre-fill (${nonFileFields.length})`}
                        </Typography.Text>
                        <App_FieldLegendChip />
                    </div>
                    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
                        {nonFileFields.map((f) => {
                            const resolvedType = fieldTypeMap[f.fieldKey] || f.fieldType
                            const currentValue = fieldValues[f.fieldKey]
                            const prefill = prefilledValues?.[f.fieldKey]
                            const hasDiff = isReview
                                && isMeaningful(prefill)
                                && JSON.stringify(prefill) !== JSON.stringify(currentValue)
                            const fieldState = resolveFieldState(f.fieldKey, hrSet, mandatorySet)
                            const fieldChoices = fieldChoicesMap[f.fieldKey] || []
                            // Per-field mode resolution: review → readonly; employee filler → HR fields readonly; otherwise fill
                            const effectiveMode: 'fill' | 'readonly' = isReview
                                ? 'readonly'
                                : (fillerRole === 'employee' && fieldState === 'hr')
                                    ? 'readonly'
                                    : 'fill'

                            if (hasDiff) {
                                return (
                                    <div key={f.fieldKey} style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
                                        <Typography.Text type="secondary" style={{ fontSize: 10 }}>HR prefill</Typography.Text>
                                        <App_FieldRenderer
                                            fieldKey={f.fieldKey}
                                            fieldLabel={f.fieldLabel}
                                            fieldType={resolvedType}
                                            state={fieldState}
                                            mode="readonly"
                                            value={prefill}
                                            choices={fieldChoices}
                                            disabled
                                            onNavigate={() => navigateToField(f.fieldKey)}
                                        />
                                        <Typography.Text type="secondary" style={{ fontSize: 10 }}>Employee filled</Typography.Text>
                                        <App_FieldRenderer
                                            fieldKey={f.fieldKey}
                                            fieldLabel={f.fieldLabel}
                                            fieldType={resolvedType}
                                            state={fieldState}
                                            mode="readonly"
                                            value={currentValue}
                                            choices={fieldChoices}
                                            disabled
                                            onNavigate={() => navigateToField(f.fieldKey)}
                                        />
                                    </div>
                                )
                            }

                            return (
                                <App_FieldRenderer
                                    key={f.fieldKey}
                                    fieldKey={f.fieldKey}
                                    fieldLabel={f.fieldLabel}
                                    fieldType={resolvedType}
                                    state={fieldState}
                                    mode={effectiveMode}
                                    value={currentValue}
                                    onChange={(val) => onChange(f.fieldKey, val)}
                                    choices={fieldChoices}
                                    error={errors?.[f.fieldKey]}
                                    onNavigate={() => navigateToField(f.fieldKey)}
                                />
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Right: attachment strip (when file fields exist) stacked above the contract preview */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: token.marginSM, overflow: 'hidden' }}>
                {fileFields.length > 0 && (
                    <App_AttachmentStrip
                        fields={fileFields}
                        fieldValues={fieldValues}
                        onChange={onChange}
                        mode={isReview ? 'readonly' : 'fill'}
                        fillerRole={fillerRole}
                        fieldStates={fieldStatesMap}
                        uploadContext={uploadContext}
                        organization_id={organization_id ?? ''}
                        errors={stripErrors}
                    />
                )}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                    {props.kind === 'pdf' ? (
                        <ContractFillerBody_Pdf
                            ref={bodyRef}
                            pdfFileUrl={props.pdfFileUrl}
                            pdfLayout={props.layout}
                            fieldValues={fieldValues}
                            onChange={onChange}
                            isReview={isReview}
                            fillerRole={fillerRole}
                            hrSet={hrSet}
                            mandatorySet={mandatorySet}
                            columns={columns}
                            choicesMap={choicesMap}
                            fieldLabelMap={Object.fromEntries(fields.map((f) => [f.fieldKey, f.fieldLabel]))}
                        />
                    ) : (
                        <ContractFillerBody_Tiptap
                            ref={bodyRef}
                            layout={props.layout}
                            fieldValues={fieldValues}
                            onChangeRef={onChangeRef}
                            choicesMap={choicesMap}
                        />
                    )}
                </div>
            </div>
        </div>
        </FieldRendererContext.Provider>
    )
}

// --- Body subcomponents — expose `scrollToField` via ref so the shared App_ContractFiller
//     fill-cards can scroll the right-pane document to a target field on click.

export type ContractFillerBodyRef = {
    scrollToField: (fieldKey: string) => void
}

// --- Tiptap-kind body subcomponent ----------------------------------------
// Owns the TipTap editor lifecycle so it only mounts when kind='tiptap'. The shared shell
// above doesn't need to instantiate an editor for pdf-kind use.

type TiptapBodyProps = {
    layout: JSONContent
    fieldValues: Record<string, unknown>
    onChangeRef: (key: string, val: unknown) => void
    choicesMap: Record<string, Array<{ label: string; value: string }>>
}

const ContractFillerBody_Tiptap = forwardRef<ContractFillerBodyRef, TiptapBodyProps>(
    ({ layout, fieldValues, onChangeRef, choicesMap }, ref) => {
        const editor = useEditor({
            editable: false,
            content: layout,
            extensions: [
                StarterKit,
                TextAlign.configure({ types: ['heading', 'paragraph'] }),
                TableKit,
                FieldInput,
            ],
        })

        // Inject choices map, values, onChange into editor storage (state flows via FieldRendererContext above)
        useEffect(() => {
            if (!editor) return
            const storage = (editor.storage as Record<string, any>).fieldInput
            storage.choicesMap = choicesMap
            storage.values = fieldValues
            storage.onChange = onChangeRef
            // Dispatch with unique value to force decoration change → node view re-render
            const { tr } = editor.state
            tr.setMeta(fieldInputPreviewKey, Date.now())
            editor.view.dispatch(tr)
        }, [editor, choicesMap, fieldValues, onChangeRef])

        useImperativeHandle(
            ref,
            (): ContractFillerBodyRef => ({
                scrollToField: (fieldKey) => {
                    if (!editor) return
                    let foundPos: number | null = null
                    editor.state.doc.descendants((node, pos) => {
                        if (
                            node.type.name === 'fieldInput' &&
                            (node.attrs as Record<string, unknown>)?.fieldKey === fieldKey
                        ) {
                            foundPos = pos
                            return false
                        }
                        return undefined
                    })
                    if (foundPos === null) return
                    const nodeDom = editor.view.nodeDOM(foundPos)
                    const el =
                        nodeDom instanceof HTMLElement
                            ? nodeDom
                            : (nodeDom as Node | null)?.parentElement
                    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                },
            }),
            [editor],
        )

        return <App_ContractPreview editor={editor} />
    },
)
ContractFillerBody_Tiptap.displayName = 'ContractFillerBody_Tiptap'

// --- PDF-kind body subcomponent ------------------------------------------
// Renders the source PDF + positioned-field overlays. Each overlay is a per-field
// `<input>` / `<select>` (editable) or readonly text (review/HR-locked) sized to fill
// its positioned box. Values are bound to the same `fieldValues` / `onChange` that the
// fill-card sidebar uses — typing in either the card or the overlay updates both.

type PdfBodyProps = {
    pdfFileUrl: string | null
    pdfLayout: PdfLayout
    fieldValues: Record<string, unknown>
    onChange: (key: string, val: unknown) => void
    isReview: boolean
    fillerRole: 'hr' | 'employee'
    hrSet: Set<string>
    mandatorySet: Set<string>
    columns: Tables_EmployeeColumns_QueryData
    choicesMap: Record<string, Array<{ label: string; value: string }>>
    /** Resolved human label for each field key (built from columns + universals upstream).
     *  Used as the placeholder on each on-PDF input so the employee/HR doesn't have to
     *  cross-reference the left fill column to know what each box is. */
    fieldLabelMap: Record<string, string>
}

const ContractFillerBody_Pdf = forwardRef<ContractFillerBodyRef, PdfBodyProps>(({
    pdfFileUrl,
    pdfLayout,
    fieldValues,
    onChange,
    isReview,
    fillerRole,
    hrSet,
    mandatorySet,
    columns,
    choicesMap,
    fieldLabelMap,
}, ref) => {
    const { token } = theme.useToken()
    const [pdfScale, setPdfScale] = useState(1.0)

    useImperativeHandle(
        ref,
        (): ContractFillerBodyRef => ({
            scrollToField: (fieldKey) => {
                const el = document.querySelector(`[data-pdf-field="${fieldKey}"]`) as HTMLElement | null
                if (!el) return
                el.scrollIntoView({ block: 'center', behavior: 'smooth' })
                el.style.transition = 'box-shadow 0.3s'
                el.style.boxShadow = '0 0 0 3px rgba(22, 119, 255, 0.5)'
                setTimeout(() => {
                    el.style.boxShadow = ''
                    el.style.transition = ''
                }, 1500)
            },
        }),
        [pdfLayout],
    )

    if (!pdfFileUrl) {
        return (
            <div style={{ padding: token.paddingMD, textAlign: 'center' }}>
                <Typography.Text type="secondary">Loading PDF…</Typography.Text>
            </div>
        )
    }

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, gap: token.marginXS }}>
            {/* Toolbar with zoom controls — fixed above the document */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    padding: `${token.paddingXXS}px ${token.paddingSM}px`,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    flexShrink: 0,
                }}
            >
                <App_PdfZoomControls scale={pdfScale} onScaleChange={setPdfScale} />
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
                <App_PdfDocument
                    fileUrl={pdfFileUrl}
                    scale={pdfScale}
                    overlayRenderer={({ pageNumber }) => (
                        // zIndex: 3 so the overlay paints above react-pdf's text layer
                        // (which has z-index: 2 baked into its CSS) — without this, our
                        // positioned <input>s wouldn't receive clicks.
                        // pointer-events: none lets clicks fall through to the page on
                        // empty space; the FieldOverlay children opt back in to receive
                        // their own clicks.
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                zIndex: 3,
                                pointerEvents: 'none',
                            }}
                        >
                            {pdfLayout
                                .filter((f) => f.page === pageNumber)
                                .map((f) => {
                                    const state = resolveFieldState(f.key, hrSet, mandatorySet)
                                    const effectiveMode: 'fill' | 'readonly' = isReview
                                        ? 'readonly'
                                        : fillerRole === 'employee' && state === 'hr'
                                            ? 'readonly'
                                            : 'fill'
                                    const col = columns.find((c) => c.id === f.key)
                                    const choices = choicesMap[f.key] ?? []
                                    return (
                                        <PdfFieldOverlay
                                            key={f.key}
                                            field={f}
                                            fieldLabel={fieldLabelMap[f.key] ?? f.key}
                                            value={fieldValues[f.key]}
                                            onChange={(v) => onChange(f.key, v)}
                                            mode={effectiveMode}
                                            columnType={col?.type}
                                            choices={choices}
                                        />
                                    )
                                })}
                        </div>
                    )}
                />
            </div>
        </div>
    )
})
ContractFillerBody_Pdf.displayName = 'ContractFillerBody_Pdf'

type PdfFieldOverlayProps = {
    field: PdfLayout_PositionedField
    /** Human label resolved from columns/universals upstream — used as placeholder text. */
    fieldLabel: string
    value: unknown
    onChange: (val: unknown) => void
    mode: 'fill' | 'readonly'
    /** Underlying employee_column type when applicable — distinguishes single_select vs
     *  multi_select since `field.type` collapses both to 'choice'. */
    columnType?: string
    choices: Array<{ label: string; value: string }>
}

const PdfFieldOverlay = ({ field, fieldLabel, value, onChange, mode, columnType, choices }: PdfFieldOverlayProps) => {
    const { token } = theme.useToken()
    const isEmpty = value === undefined || value === null || value === ''

    const baseStyle: React.CSSProperties = {
        position: 'absolute',
        left: `${field.x_pct * 100}%`,
        top: `${field.y_pct * 100}%`,
        width: `${field.w_pct * 100}%`,
        height: `${field.h_pct * 100}%`,
        pointerEvents: 'auto',
        boxSizing: 'border-box',
    }

    // Signature — image when filled, italic placeholder when empty
    if (field.type === 'signature') {
        return (
            <div data-pdf-field={field.key} style={baseStyle}>
                {typeof value === 'string' && value.length > 0 ? (
                    <img
                        src={value}
                        alt="signature"
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                ) : (
                    <SignaturePlaceholder />
                )}
            </div>
        )
    }

    // Readonly mode (review or HR-locked for employee) — show value as plain text
    if (mode === 'readonly') {
        return (
            <div
                data-pdf-field={field.key}
                style={{
                    ...baseStyle,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 4px',
                    fontSize: 'inherit',
                    color: isEmpty ? token.colorTextTertiary : token.colorText,
                    fontStyle: isEmpty ? 'italic' : 'normal',
                    background: 'transparent',
                }}
            >
                {isEmpty ? fieldLabel : displayValue(value, columnType, choices)}
            </div>
        )
    }

    // Editable: pick the input shape by underlying column type (where available) or
    // by the layout's `field.type` discriminator. Multi-select renders read-only inline
    // (the user edits via the fill card on the left) — inline multi-select would overflow.
    if (field.type === 'date') {
        return (
            <input
                data-pdf-field={field.key}
                type="date"
                placeholder={fieldLabel}
                title={fieldLabel}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(e.target.value)}
                style={inputStyle(baseStyle, token)}
            />
        )
    }
    if (field.type === 'choice') {
        if (columnType === 'multi_select') {
            // Read-only summary in the overlay; left fill card handles multi-select editing
            const arr = Array.isArray(value) ? (value as string[]) : []
            const labels = arr
                .map((v) => choices.find((c) => c.value === v)?.label ?? v)
                .join(', ')
            return (
                <div
                    data-pdf-field={field.key}
                    title={fieldLabel}
                    style={{
                        ...baseStyle,
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 4px',
                        fontSize: 'inherit',
                        color: arr.length === 0 ? token.colorTextTertiary : token.colorText,
                        fontStyle: arr.length === 0 ? 'italic' : 'normal',
                    }}
                >
                    {arr.length === 0 ? fieldLabel : labels}
                </div>
            )
        }
        // single_select — first option doubles as the placeholder so the empty box
        // shows the field's label instead of a meaningless dash.
        return (
            <select
                data-pdf-field={field.key}
                title={fieldLabel}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(e.target.value)}
                style={inputStyle(baseStyle, token)}
            >
                <option value="">{fieldLabel}</option>
                {choices.map((c) => (
                    <option key={c.value} value={c.value}>
                        {c.label}
                    </option>
                ))}
            </select>
        )
    }
    // text / email / phone / number / unknown
    return (
        <input
            data-pdf-field={field.key}
            type="text"
            placeholder={fieldLabel}
            title={fieldLabel}
            value={typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)}
            onChange={(e) => onChange(e.target.value)}
            style={inputStyle(baseStyle, token)}
        />
    )
}

const SignaturePlaceholder = () => {
    const { token } = theme.useToken()
    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px dashed ${token.colorBorder}`,
                borderRadius: token.borderRadiusSM,
                color: token.colorTextTertiary,
                fontStyle: 'italic',
                fontSize: 'inherit',
            }}
        >
            Signature
        </div>
    )
}

const inputStyle = (base: React.CSSProperties, token: ReturnType<typeof theme.useToken>['token']): React.CSSProperties => ({
    ...base,
    border: `1px solid ${token.colorBorder}`,
    borderRadius: token.borderRadiusSM,
    padding: '0 4px',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    background: token.colorBgContainer,
    color: token.colorText,
})

const displayValue = (
    value: unknown,
    columnType: string | undefined,
    choices: Array<{ label: string; value: string }>,
): string => {
    if (value === undefined || value === null || value === '') return ''
    if (columnType === 'multi_select' && Array.isArray(value)) {
        return (value as string[])
            .map((v) => choices.find((c) => c.value === v)?.label ?? v)
            .join(', ')
    }
    if (columnType === 'single_select' && typeof value === 'string') {
        return choices.find((c) => c.value === value)?.label ?? value
    }
    return String(value)
}
