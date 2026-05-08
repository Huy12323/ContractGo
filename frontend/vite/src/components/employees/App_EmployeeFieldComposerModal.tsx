import { useState, useEffect } from 'react'
import { Modal, Input, Select, Button, Typography, App, theme } from 'antd'
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/configs/supabase/config'
import { QueryKeys } from '@/utils/query/queryKeys'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { const_EmployeeColumnsTypeOptions } from '@/hooks/const_EmployeeColumnsTypeOptions'
import type { Enums } from '@/types'

interface Props {
    open: boolean
    onClose: () => void
    entityId: string
    columnId?: string | null
    onCreated?: (columnId: string) => void
}

type Choice = { id?: string; label: string }

export const App_EmployeeFieldComposerModal = ({ open, onClose, entityId, columnId, onCreated }: Props) => {
    const { token } = theme.useToken()
    const { message } = App.useApp()
    const queryClient = useQueryClient()
    const qColumns = useQ_Tables_EmployeeColumns({ entityId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ entityId })

    const [label, setLabel] = useState('')
    const [type, setType] = useState<Enums<'employee_column_type'>>('text')
    const [choices, setChoices] = useState<Choice[]>([])

    const isEdit = !!columnId
    const editingColumn = columnId ? qColumns.columns.find((c) => c.id === columnId) : null

    // Hydrate form when opening / switching column
    useEffect(() => {
        if (!open) return
        if (isEdit && editingColumn) {
            setLabel(editingColumn.label)
            setType(editingColumn.type)
            const existing = qChoices.choices
                .filter((c) => c.employee_column_id === columnId)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((c) => ({ id: c.id, label: c.label }))
            setChoices(existing)
        } else {
            setLabel('')
            setType('text')
            setChoices([])
        }
    }, [open, isEdit, editingColumn, qChoices.choices, columnId])

    // Create via edge function (handles ALTER TABLE + choices insertion atomically)
    const mCreate = useMutation({
        mutationFn: async () => {
            const sb_Functions_InvokeEmployeeManagementCreateColumn = await supabase.functions.invoke(
                'employee-management_create-column',
                {
                    body: {
                        entity_id: entityId,
                        label: label.trim(),
                        type,
                        ...((type === 'single_select' || type === 'multi_select')
                            ? { choices: choices.map((c) => c.label).filter((l) => l.trim()) }
                            : {}),
                    },
                },
            )
            if (sb_Functions_InvokeEmployeeManagementCreateColumn.error) throw sb_Functions_InvokeEmployeeManagementCreateColumn.error
            const body = sb_Functions_InvokeEmployeeManagementCreateColumn.data as { data: { id: string; label: string; type: string } }
            return body.data
        },
        onSuccess: async (column) => {
            message.success('Field created')
            await queryClient.invalidateQueries({ queryKey: QueryKeys.employee_columns.all() })
            await queryClient.invalidateQueries({ queryKey: QueryKeys.employee_column_choices.all() })
            onCreated?.(column.id)
            onClose()
        },
        onError: (err) => {
            console.error(err)
            message.error('Failed to create field')
        },
    })

    // Update via SDK — label + choices diff (delete removed, update existing, insert new)
    const mUpdate = useMutation({
        mutationFn: async () => {
            if (!columnId) return

            // Update label
            const sb_FromEmployeeColumns_Update = await supabase
                .from('employee_columns')
                .update({ label: label.trim() })
                .eq('id', columnId)
            if (sb_FromEmployeeColumns_Update.error) throw sb_FromEmployeeColumns_Update.error

            // Only touch choices for select types
            if (type !== 'single_select' && type !== 'multi_select') return

            const existing = qChoices.choices.filter((c) => c.employee_column_id === columnId)
            const keepIds = new Set(choices.filter((c) => c.id).map((c) => c.id!))

            // Delete choices that were removed in the composer
            for (const ec of existing) {
                if (!keepIds.has(ec.id)) {
                    const sb_FromEmployeeColumnChoices_Delete = await supabase
                        .from('employee_column_choices')
                        .delete()
                        .eq('id', ec.id)
                    if (sb_FromEmployeeColumnChoices_Delete.error) throw sb_FromEmployeeColumnChoices_Delete.error
                }
            }

            // Upsert: update labels + sort_order for existing, insert new
            for (let i = 0; i < choices.length; i++) {
                const choice = choices[i]
                if (!choice || !choice.label.trim()) continue
                if (choice.id) {
                    const sb_FromEmployeeColumnChoices_Update = await supabase
                        .from('employee_column_choices')
                        .update({ label: choice.label.trim(), sort_order: i })
                        .eq('id', choice.id)
                    if (sb_FromEmployeeColumnChoices_Update.error) throw sb_FromEmployeeColumnChoices_Update.error
                } else {
                    const sb_FromEmployeeColumnChoices_Insert = await supabase
                        .from('employee_column_choices')
                        .insert({
                            employee_column_id: columnId,
                            entity_id: entityId,
                            label: choice.label.trim(),
                            sort_order: i,
                        })
                    if (sb_FromEmployeeColumnChoices_Insert.error) throw sb_FromEmployeeColumnChoices_Insert.error
                }
            }
        },
        onSuccess: async () => {
            message.success('Field updated')
            await queryClient.invalidateQueries({ queryKey: QueryKeys.employee_columns.all() })
            await queryClient.invalidateQueries({ queryKey: QueryKeys.employee_column_choices.all() })
            onClose()
        },
        onError: (err) => {
            console.error(err)
            message.error('Failed to update field')
        },
    })

    const handleSave = () => {
        if (!label.trim()) return
        if (isEdit) mUpdate.mutate()
        else mCreate.mutate()
    }

    const isLoading = mCreate.isPending || mUpdate.isPending
    const showChoices = type === 'single_select' || type === 'multi_select'

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={isEdit ? 'Edit field' : 'Create field'}
            okText={isEdit ? 'Save' : 'Create'}
            onOk={handleSave}
            confirmLoading={isLoading}
            okButtonProps={{ disabled: !label.trim() }}
            destroyOnHidden
            width={480}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginMD, marginTop: token.marginMD }}>
                <div>
                    <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXXS }}>Label</Typography.Text>
                    <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Phone Number" autoFocus />
                </div>

                <div>
                    <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXXS }}>Type</Typography.Text>
                    <Select
                        value={type}
                        onChange={setType}
                        options={const_EmployeeColumnsTypeOptions.options}
                        style={{ width: '100%' }}
                        disabled={isEdit}
                    />
                    {isEdit && (
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            Type cannot be changed after creation.
                        </Typography.Text>
                    )}
                </div>

                {showChoices && (
                    <div>
                        <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXXS }}>Choices</Typography.Text>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
                            {choices.map((choice, idx) => (
                                <div key={choice.id ?? `new-${idx}`} style={{ display: 'flex', gap: token.marginXS, alignItems: 'center' }}>
                                    <Input
                                        value={choice.label}
                                        onChange={(e) => setChoices((prev) => prev.map((c, i) => (i === idx ? { ...c, label: e.target.value } : c)))}
                                        placeholder={`Choice ${idx + 1}`}
                                        style={{ flex: 1 }}
                                    />
                                    <Button
                                        type="text"
                                        danger
                                        icon={<MinusCircleOutlined />}
                                        onClick={() => setChoices((prev) => prev.filter((_, i) => i !== idx))}
                                    />
                                </div>
                            ))}
                            <Button
                                type="dashed"
                                block
                                icon={<PlusOutlined />}
                                onClick={() => setChoices((prev) => [...prev, { label: '' }])}
                            >
                                Add choice
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    )
}
