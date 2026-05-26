import { useMemo, useRef } from 'react'
import { Typography, Button, theme } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import type { Tables_OrgEmployees_QueryData } from '@/hooks/useQ_Tables_OrgEmployees'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { EmployeeDataTable_UniversalFields, isSystemFieldKey, type EmployeeDataTable_TableField } from '@/types/employeeTable.types'
import { useProvider_App_EmployeeDetailModal } from './App_EmployeeDetailModal'
import { AppEmployeeDetailModal_FieldRenderer } from './AppEmployeeDetailModal_FieldRenderer'
import { FieldTypeIcon } from './App_EmployeeFieldTypeIcon'

type EmployeeRow = Tables_OrgEmployees_QueryData[number]
type Choice = { value: string; label: string }

type Props = {
  employee: EmployeeRow
  fields?: EmployeeDataTable_TableField[]
  choicesByField?: Record<string, Choice[]>
  entityId: string
  organizationId: string
  onFilePreview?: (ctx: { file_id: string; column_id: string }) => void
}

export const AppEmployeeDetailModal_OverviewTab = ({
  employee,
  fields: fieldsProp,
  choicesByField: choicesProp,
  entityId,
  organizationId,
  onFilePreview,
}: Props) => {
  const { token } = theme.useToken()
  const pModal = useProvider_App_EmployeeDetailModal()
  const { editMode, patch } = pModal.state

  const qColumns = useQ_Tables_EmployeeColumns({ entityId })
  const qChoices = useQ_Tables_EmployeeColumnChoices({ entityId })

  const fields = useMemo(() => {
    if (fieldsProp) return fieldsProp
    const dynamic: EmployeeDataTable_TableField[] = qColumns.columns.map((c) => ({
      key: c.id,
      label: c.label,
      type: c.type as EmployeeDataTable_TableField['type'],
    }))
    return [...EmployeeDataTable_UniversalFields, ...dynamic]
  }, [fieldsProp, qColumns.columns])

  const choicesByField = useMemo(() => {
    if (choicesProp) return choicesProp
    const map: Record<string, Choice[]> = {}
    for (const c of qChoices.choices) {
      if (!map[c.employee_column_id]) map[c.employee_column_id] = []
      map[c.employee_column_id]!.push({ value: c.value, label: c.label })
    }
    return map
  }, [choicesProp, qChoices.choices])

  const bodyFields = useMemo(
    () => fields.filter((f) => !isSystemFieldKey(f.key)),
    [fields],
  )

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const renderLabel = (field: EmployeeDataTable_TableField) => (
    <>
      <span style={{ color: token.colorTextTertiary, display: 'inline-flex' }}>
        <FieldTypeIcon type={field.type} />
      </span>
      <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }} ellipsis>
        {field.label}
      </Typography.Text>
    </>
  )

  const renderField = (field: EmployeeDataTable_TableField) => {
    const effectiveValue = field.key in patch ? patch[field.key] : (employee as Record<string, unknown>)[field.key]
    const isFile = field.type === 'file'

    return (
      <div
        key={field.key}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: token.marginSM,
          marginBottom: token.marginSM,
        }}
      >
        <div
          style={{
            flex: '0 0 140px',
            maxWidth: 140,
            display: 'flex',
            alignItems: 'center',
            gap: token.marginXS,
            color: token.colorTextSecondary,
            fontSize: token.fontSizeSM,
            paddingTop: 4,
          }}
        >
          {renderLabel(field)}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
          {isFile && editMode === 'edit' && (
            <Button
              size="small"
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => fileInputRefs.current[field.key]?.click()}
              style={{ alignSelf: 'flex-start' }}
            >
              Add files
            </Button>
          )}
          <AppEmployeeDetailModal_FieldRenderer
            field={field}
            value={effectiveValue}
            mode={editMode}
            onChange={(next) => pModal.setState({ patch: { ...patch, [field.key]: next } })}
            choices={choicesByField[field.key]}
            organizationId={organizationId}
            onFilePreview={(fileId) => onFilePreview?.({ file_id: fileId, column_id: field.key })}
            isSaving={pModal.state.isSaving}
            {...(isFile && { employeeId: employee.id, columnId: field.key, fileInputRef: { get current() { return fileInputRefs.current[field.key] ?? null }, set current(v: HTMLInputElement | null) { fileInputRefs.current[field.key] = v } } })}
          />
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: `${token.paddingMD}px 0` }}>
      {bodyFields.map(renderField)}
    </div>
  )
}
