import { useState, useEffect } from 'react'
import { Modal, Input, Select, Button, Typography, App, theme } from 'antd'
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/configs/supabase/config'
import { QueryKeys } from '@/utils/query/queryKeys'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { const_EmployeeColumnsTypeOptions } from '@/hooks/const_EmployeeColumnsTypeOptions'
import type { Enums } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  organizationId: string
  columnId: string | null
  onCreated?: (columnId: string) => void
}

export const App_CreateFieldModal = ({ open, onClose, organizationId, columnId, onCreated }: Props) => {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const qColumns = useQ_Tables_EmployeeColumns({ organizationId })

  const [label, setLabel] = useState('')
  const [type, setType] = useState<Enums<'employee_column_type'>>('text')
  const [options, setOptions] = useState<string[]>([])

  const isEdit = !!columnId
  const existingColumn = columnId ? qColumns.columns.find((c) => c.id === columnId) : null

  useEffect(() => {
    if (!open) return
    if (existingColumn) {
      setLabel(existingColumn.label)
      setType(existingColumn.type)
      setOptions([])
    } else {
      setLabel('')
      setType('text')
      setOptions([])
    }
  }, [open, existingColumn])

  // Create field via edge function
  const mCreateField = useMutation({
    mutationFn: async () => {
      const sb_Functions_InvokeEmployeeManagementCreateColumn = await supabase.functions.invoke(
        'employee-management_create-column',
        {
          body: {
            label: label.trim(),
            type,
            organization_id: organizationId,
            ...(type === 'multi_select' ? { options: options.filter((o) => o.trim()) } : {}),
          },
        },
      )
      if (sb_Functions_InvokeEmployeeManagementCreateColumn.error) throw sb_Functions_InvokeEmployeeManagementCreateColumn.error
      const body = sb_Functions_InvokeEmployeeManagementCreateColumn.data as { data: { id: string; label: string; type: string } }
      return body.data
    },
    onSuccess: async (column) => {
      message.success('Field created')
      await queryClient.invalidateQueries({ queryKey: QueryKeys.employeeColumns.all() })
      onCreated?.(column.id)
      onClose()
    },
    onError: (err) => {
      console.error(err)
      message.error('Failed to create field')
    },
  })

  // Update field metadata (label, options) via SDK
  const mUpdateField = useMutation({
    mutationFn: async () => {
      const sb_FromEmployeeColumns_Update = await supabase
        .from('employee_columns')
        .update({
          label: label.trim(),
          ...(type === 'multi_select' ? { options: options.filter((o) => o.trim()) } : {}),
        })
        .eq('id', columnId!)
        .select()
        .single()
      if (sb_FromEmployeeColumns_Update.error) throw sb_FromEmployeeColumns_Update.error
      return sb_FromEmployeeColumns_Update.data
    },
    onSuccess: () => {
      message.success('Field updated')
      queryClient.invalidateQueries({ queryKey: QueryKeys.employeeColumns.all() })
      onClose()
    },
    onError: (err) => {
      console.error(err)
      message.error('Failed to update field')
    },
  })

  const handleSave = () => {
    if (!label.trim()) return
    if (isEdit) mUpdateField.mutate()
    else mCreateField.mutate()
  }

  const isLoading = mCreateField.isPending || mUpdateField.isPending

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={isEdit ? 'Edit Field' : 'Create New Field'}
      onOk={handleSave}
      confirmLoading={isLoading}
      okText={isEdit ? 'Save' : 'Create'}
      okButtonProps={{ disabled: !label.trim() }}
      destroyOnHidden
      width={480}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginMD, marginTop: token.marginMD }}>
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
              {options.map((opt, idx) => (
                <div key={idx} style={{ display: 'flex', gap: token.marginXS }}>
                  <Input
                    value={opt}
                    onChange={(e) => setOptions((prev) => prev.map((o, i) => (i === idx ? e.target.value : o)))}
                    placeholder={`Choice ${idx + 1}`}
                    style={{ flex: 1 }}
                  />
                  <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))} />
                </div>
              ))}
              <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => setOptions((prev) => [...prev, ''])}>
                Add Choice
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
