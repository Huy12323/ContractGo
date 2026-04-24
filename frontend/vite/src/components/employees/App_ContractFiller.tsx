import { useMemo, useEffect, useCallback } from 'react'
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
import type { JSONContent } from '@tiptap/core'
import type { Tables_EmployeeColumns_QueryData } from '@/hooks/useQ_Tables_EmployeeColumns'
import type { Tables_EmployeeColumnChoices_QueryData } from '@/hooks/useQ_Tables_EmployeeColumnChoices'

const UNIVERSAL_FIELDS = [
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'first_name', label: 'First Name', type: 'text' },
    { key: 'last_name', label: 'Last Name', type: 'text' },
    { key: 'birthday', label: 'Birthday', type: 'date' },
] as const

type Props = {
    layout: JSONContent
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
     *  snapshots that predate AHR-1791. */
    attachmentFieldKeys?: string[]
}

const isMeaningful = (v: unknown): boolean => v !== undefined && v !== null && v !== ''

/** Extracts all fieldInput nodes from TipTap JSONContent */
export const extractFields = (content: JSONContent): Array<{ fieldKey: string; fieldLabel: string; fieldType: string }> => {
    const fields: Array<{ fieldKey: string; fieldLabel: string; fieldType: string }> = []
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

const resolveFieldState = (fieldKey: string, hrSet: Set<string>, mandatorySet: Set<string>): FieldRendererContext_State => {
    if (hrSet.has(fieldKey)) return 'hr'
    if (mandatorySet.has(fieldKey)) return 'mandatory'
    return 'optional'
}

export const App_ContractFiller = ({
    layout,
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
}: Props) => {
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

    // Inject choices map, values, onChange into editor storage (state flows via FieldRendererContext below)
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

    const fieldRendererContextValue = useMemo<FieldRendererContextValue>(
        () => ({
            hrSet,
            mandatorySet,
            mode: isReview ? 'readonly' : 'fill',
            isBuilder: false,
        }),
        [hrSet, mandatorySet, isReview],
    )

    // Extract fields from layout
    const fields = useMemo(() => extractFields(layout), [layout])

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
            if (c.type === 'multi_select') map[c.id] = choicesMap[c.id] || []
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
    // Either way, nonFileFields is whatever's left in the layout after filtering out
    // type==='file' (defensively — nothing should be 'file' in post-migration layouts).
    const { fileFields, nonFileFields } = useMemo(() => {
        const fileF: typeof fields = []
        const nonFileF: typeof fields = []

        for (const f of fields) {
            const resolvedType = fieldTypeMap[f.fieldKey] || f.fieldType
            if (resolvedType === 'file') {
                if (!attachmentFieldKeys) fileF.push(f) // legacy path
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
                    <App_ContractPreview editor={editor} />
                </div>
            </div>
        </div>
        </FieldRendererContext.Provider>
    )
}
