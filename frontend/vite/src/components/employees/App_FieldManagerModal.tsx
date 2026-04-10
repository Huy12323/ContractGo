import { useState, useEffect, useMemo } from 'react'
import { Modal, Input, Select, Button, Typography, App, Empty, Spin, Tag, theme } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, MinusCircleOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/configs/supabase/config'
import { QueryKeys } from '@/utils/query/queryKeys'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useM_EmployeeColumn_Delete } from '@/hooks/useM_EmployeeColumn_Delete'
import { const_EmployeeColumnsTypeOptions } from '@/hooks/const_EmployeeColumnsTypeOptions'
import type { Enums } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  organizationId: string
}

type View = 'list' | 'create' | 'edit'

export const App_FieldManagerModal = ({ open, onClose, organizationId }: Props) => {
  const { token } = theme.useToken()
  const { message, modal: antModal } = App.useApp()
  const queryClient = useQueryClient()
  const qColumns = useQ_Tables_EmployeeColumns({ organizationId })
  const qChoices = useQ_Tables_EmployeeColumnChoices({ organizationId })

  const [view, setView] = useState<View>('list')
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [deletingColumnId, setDeletingColumnId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Form state for create/edit
  const [label, setLabel] = useState('')
  const [type, setType] = useState<Enums<'employee_column_type'>>('text')
  const [choices, setChoices] = useState<{ id?: string; label: string }[]>([])

  const mDeleteColumn = useM_EmployeeColumn_Delete({
    columnId: deletingColumnId ?? '',
    onSuccess: () => setDeletingColumnId(null),
  })

  const editingColumn = editingColumnId ? qColumns.columns.find((c) => c.id === editingColumnId) : null

  // Choices grouped by column
  const choicesByColumn = useMemo(() => {
    const map: Record<string, typeof qChoices.choices> = {}
    for (const c of qChoices.choices) {
      const key = c.employee_column_id
      if (!map[key]) map[key] = []
      map[key].push(c)
    }
    return map
  }, [qChoices.choices])

  // Reset form when switching views
  useEffect(() => {
    if (view === 'create') {
      setLabel('')
      setType('text')
      setChoices([])
      setEditingColumnId(null)
    } else if (view === 'edit' && editingColumn) {
      setLabel(editingColumn.label)
      setType(editingColumn.type)
      const existingChoices = choicesByColumn[editingColumn.id] ?? []
      setChoices(existingChoices.map((c) => ({ id: c.id, label: c.label })))
    }
  }, [view, editingColumn, choicesByColumn])

  // Reset to list when modal opens
  useEffect(() => {
    if (open) setView('list')
  }, [open])

  // Create field via edge function
  const mCreateField = useMutation({
    mutationFn: async () => {
      const sb_Functions_Invoke = await supabase.functions.invoke(
        'employee-management_create-column',
        {
          body: {
            label: label.trim(),
            type,
            organization_id: organizationId,
            ...(type === 'multi_select' ? { options: choices.map((c) => c.label).filter((l) => l.trim()) } : {}),
          },
        },
      )
      if (sb_Functions_Invoke.error) throw sb_Functions_Invoke.error
      return sb_Functions_Invoke.data
    },
    onSuccess: async () => {
      message.success('Field created')
      await queryClient.invalidateQueries({ queryKey: QueryKeys.employeeColumns.all() })
      await queryClient.invalidateQueries({ queryKey: QueryKeys.employeeColumnChoices.all() })
      setView('list')
    },
    onError: (err) => {
      console.error(err)
      message.error('Failed to create field')
    },
  })

  // Update field label via SDK
  const mUpdateField = useMutation({
    mutationFn: async () => {
      if (!editingColumnId) return

      // Update label
      const sb_FromEmployeeColumns_Update = await supabase
        .from('employee_columns')
        .update({ label: label.trim() })
        .eq('id', editingColumnId)
      if (sb_FromEmployeeColumns_Update.error) throw sb_FromEmployeeColumns_Update.error

      // Upsert choices: update existing labels, insert new
      for (let i = 0; i < choices.length; i++) {
        const choice = choices[i]
        if (!choice || !choice.label.trim()) continue
        if (choice.id) {
          await supabase.from('employee_column_choices').update({ label: choice.label.trim(), sort_order: i }).eq('id', choice.id)
        } else {
          await supabase.from('employee_column_choices').insert({
            employee_column_id: editingColumnId,
            label: choice.label.trim(),
            sort_order: i,
          })
        }
      }
    },
    onSuccess: async () => {
      message.success('Field updated')
      await queryClient.invalidateQueries({ queryKey: QueryKeys.employeeColumns.all() })
      await queryClient.invalidateQueries({ queryKey: QueryKeys.employeeColumnChoices.all() })
      setView('list')
    },
    onError: (err) => {
      console.error(err)
      message.error('Failed to update field')
    },
  })

  const handleSave = () => {
    if (!label.trim()) return
    if (view === 'create') mCreateField.mutate()
    else mUpdateField.mutate()
  }

  const handleDelete = (columnId: string, columnLabel: string) => {
    setDeletingColumnId(columnId)
    antModal.confirm({
      title: 'Delete Field',
      content: `Delete "${columnLabel}"? This will remove the column from the employees table and all associated data. This cannot be undone.`,
      okText: 'Delete',
      okType: 'danger',
      onOk: () => mDeleteColumn.mutation.mutateAsync(),
      onCancel: () => setDeletingColumnId(null),
    })
  }

  const handleEdit = (columnId: string) => {
    setEditingColumnId(columnId)
    setView('edit')
  }

  const isSaving = mCreateField.isPending || mUpdateField.isPending

  const isEdit = view === 'edit'

  const UNIVERSAL_FIELDS = [
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'first_name', label: 'First Name', type: 'text' },
    { key: 'last_name', label: 'Last Name', type: 'text' },
    { key: 'birthday', label: 'Birthday', type: 'date' },
  ] as const

  const allFields = useMemo(() => {
    const universals = UNIVERSAL_FIELDS.map((f) => ({
      id: f.key, label: f.label, type: f.type as string, isUniversal: true, choicesCount: 0,
    }))
    const customs = qColumns.columns.map((col) => ({
      id: col.id, label: col.label, type: col.type, isUniversal: false,
      choicesCount: (choicesByColumn[col.id] ?? []).length,
    }))
    return [...universals, ...customs]
  }, [qColumns.columns, choicesByColumn])

  const filteredFields = useMemo(() => {
    if (!search.trim()) return allFields
    const q = search.toLowerCase()
    return allFields.filter((f) => f.label.toLowerCase().includes(q) || f.type.toLowerCase().includes(q))
  }, [allFields, search])

  // --- List view ---
  const renderList = () => {
    if (qColumns.query.isLoading) {
      return <div style={{ display: 'flex', justifyContent: 'center', padding: token.paddingXL }}><Spin /></div>
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{
          display: 'flex', gap: token.marginXS, alignItems: 'center',
          position: 'sticky', top: 0, zIndex: 1,
          background: token.colorBgElevated,
          paddingBottom: token.marginXS,
        }}>
          <Input
            placeholder="Search fields..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            style={{ flex: 1 }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setView('create')}>
            Create Field
          </Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
        {filteredFields.length === 0 && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? 'No matching fields' : 'No fields yet'} />
        )}

        {filteredFields.map((field) => (
          <div key={field.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: `${token.paddingXS}px ${token.paddingSM}px`,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadius,
            ...(field.isUniversal ? { background: token.colorBgLayout } : {}),
          }}>
            <div>
              <Typography.Text strong style={{ fontSize: 13 }}>{field.label}</Typography.Text>
              <Tag style={{ marginLeft: token.marginXS, fontSize: 11 }}>{field.type}</Tag>
              {field.type === 'multi_select' && field.choicesCount > 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                  {field.choicesCount} choice{field.choicesCount !== 1 ? 's' : ''}
                </Typography.Text>
              )}
            </div>
            {!field.isUniversal && (
              <div style={{ display: 'flex', gap: 4 }}>
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(field.id)} />
                <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(field.id, field.label)} />
              </div>
            )}
          </div>
        ))}
        </div>
      </div>
    )
  }

  // --- Create / Edit view ---
  const renderForm = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginMD }}>
      <div>
        <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXXS }}>Label</Typography.Text>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Phone Number" />
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
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>Type cannot be changed after creation.</Typography.Text>
        )}
      </div>

      {type === 'multi_select' && (
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
                {!choice.id && (
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => setChoices((prev) => prev.filter((_, i) => i !== idx))}
                  />
                )}
              </div>
            ))}
            <Button type="dashed" block icon={<PlusOutlined />} onClick={() => setChoices((prev) => [...prev, { label: '' }])} style={{ height: 32 }}>
              Add Choice
            </Button>
          </div>
        </div>
      )}
    </div>
  )

  const title = view === 'list' ? 'Manage Fields' : view === 'create' ? 'Create Field' : `Edit: ${editingColumn?.label ?? 'Field'}`

  return (
    <Modal
      open={open}
      onCancel={view === 'list' ? onClose : () => setView('list')}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
          {view !== 'list' && (
            <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => setView('list')} style={{ marginRight: 4 }} />
          )}
          {title}
        </div>
      }
      footer={view === 'list' ? null : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: token.marginXS }}>
          <Button onClick={() => setView('list')}>Cancel</Button>
          <Button type="primary" loading={isSaving} disabled={!label.trim()} onClick={handleSave}>
            {view === 'create' ? 'Create' : 'Save'}
          </Button>
        </div>
      )}
      width="60vw"
      styles={{ body: { minHeight: 300, maxHeight: '70vh', overflow: 'auto' } }}
      destroyOnHidden
    >
      {view === 'list' ? renderList() : renderForm()}
    </Modal>
  )
}
