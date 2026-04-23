import { useMemo, useEffect, useCallback } from 'react'
import { Typography, Input, InputNumber, DatePicker, Switch, Select, theme } from 'antd'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TableKit } from '@tiptap/extension-table'
import dayjs from 'dayjs'
import { FieldInput, FieldInputContext, fieldInputPreviewKey, type FieldInputContextValue } from './ext_TipTap_FieldInput'
import { App_ContractPreview } from './App_ContractPreview'
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

const FieldControl = ({
    fieldKey,
    fieldLabel,
    fieldType,
    value,
    onChange,
    choiceOptions,
    disabled,
}: {
    fieldKey: string
    fieldLabel: string
    fieldType: string
    value: unknown
    onChange: (key: string, val: unknown) => void
    choiceOptions: Array<{ label: string; value: string }>
    disabled?: boolean
}) => {
    const common = { size: 'small' as const, disabled }

    switch (fieldType) {
        case 'number':
            return <InputNumber {...common} placeholder={fieldLabel} style={{ width: '100%' }} value={value as number | undefined} onChange={(v) => onChange(fieldKey, v)} />
        case 'date':
            return <DatePicker {...common} placeholder={fieldLabel} style={{ width: '100%' }} value={typeof value === 'string' && value ? dayjs(value) : null} onChange={(_d, ds) => onChange(fieldKey, ds)} />
        case 'boolean':
            return <Switch size="small" disabled={disabled} checked={!!value} onChange={(v) => onChange(fieldKey, v)} />
        case 'multi_select':
            return <Select {...common} placeholder={fieldLabel} options={choiceOptions} style={{ width: '100%' }} value={value as string | undefined} onChange={(v) => onChange(fieldKey, v)} />
        default:
            return <Input {...common} placeholder={fieldLabel} style={{ width: '100%' }} value={value as string | undefined} onChange={(e) => onChange(fieldKey, e.target.value)} />
    }
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
}: Props) => {
    const { token } = theme.useToken()
    const isReview = mode === 'review'
    const mandatorySet = useMemo(() => new Set(mandatoryKeys ?? []), [mandatoryKeys])

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

    // Inject choices map, values, onChange into editor storage (mandatory state flows via FieldInputContext below)
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

    const fieldInputContextValue = useMemo<FieldInputContextValue>(
        () => ({ mandatorySet, isBuilder: false }),
        [mandatorySet],
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

    return (
        <FieldInputContext.Provider value={fieldInputContextValue}>
        <div style={{ display: 'flex', gap: token.marginMD, height: '100%' }}>
            {/* Left: field list */}
            {fields.length > 0 && (
                <div style={{
                    width: 240,
                    minWidth: 240,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}>
                    <Typography.Text strong style={{ marginBottom: token.marginSM, display: 'block', flexShrink: 0 }}>
                        {isReview ? `Fields (${fields.length})` : `Pre-fill (${fields.length})`}
                    </Typography.Text>
                    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
                        {fields.map((f) => {
                            const resolvedType = fieldTypeMap[f.fieldKey] || f.fieldType
                            const currentValue = fieldValues[f.fieldKey]
                            const prefill = prefilledValues?.[f.fieldKey]
                            const hasDiff = isReview
                                && isMeaningful(prefill)
                                && JSON.stringify(prefill) !== JSON.stringify(currentValue)
                            const isFilled = isMeaningful(currentValue)
                            const background = hasDiff
                                ? token.colorWarningBg
                                : isFilled
                                    ? token.colorSuccessBg
                                    : token.colorBgTextHover
                            const border = hasDiff
                                ? `1px solid ${token.colorWarningBorder}`
                                : isFilled
                                    ? `1px solid ${token.colorSuccessBorder}`
                                    : '1px solid transparent'
                            return (
                            <div
                                key={f.fieldKey}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 2,
                                    padding: `${token.paddingXS}px ${token.paddingSM}px`,
                                    background,
                                    border,
                                    borderRadius: token.borderRadiusSM,
                                }}
                            >
                                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                    {f.fieldLabel}
                                    {mandatorySet.has(f.fieldKey) && (
                                        <span style={{ color: token.colorError, marginLeft: 2 }}>*</span>
                                    )}
                                </Typography.Text>
                                {hasDiff ? (
                                    <>
                                        <Typography.Text type="secondary" style={{ fontSize: 10, marginTop: token.marginXXS }}>
                                            HR prefill
                                        </Typography.Text>
                                        <FieldControl
                                            fieldKey={f.fieldKey}
                                            fieldLabel={f.fieldLabel}
                                            fieldType={resolvedType}
                                            value={prefill}
                                            onChange={onChange}
                                            choiceOptions={fieldChoicesMap[f.fieldKey] || []}
                                            disabled
                                        />
                                        <Typography.Text type="secondary" style={{ fontSize: 10, marginTop: token.marginXXS }}>
                                            Employee filled
                                        </Typography.Text>
                                        <FieldControl
                                            fieldKey={f.fieldKey}
                                            fieldLabel={f.fieldLabel}
                                            fieldType={resolvedType}
                                            value={currentValue}
                                            onChange={onChange}
                                            choiceOptions={fieldChoicesMap[f.fieldKey] || []}
                                            disabled
                                        />
                                    </>
                                ) : (
                                    <FieldControl
                                        fieldKey={f.fieldKey}
                                        fieldLabel={f.fieldLabel}
                                        fieldType={resolvedType}
                                        value={currentValue}
                                        onChange={onChange}
                                        choiceOptions={fieldChoicesMap[f.fieldKey] || []}
                                        disabled={isReview}
                                    />
                                )}
                            </div>
                        )})}
                    </div>
                </div>
            )}

            {/* Right: contract preview */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
                <App_ContractPreview editor={editor} />
            </div>
        </div>
        </FieldInputContext.Provider>
    )
}
