import { useMemo } from 'react'
import { Typography, theme } from 'antd'
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

  // Snake-fill: even-indexed fields go left, odd-indexed go right.
  const [leftFields, rightFields] = useMemo(() => {
    const left: EmployeeDataTable_TableField[] = []
    const right: EmployeeDataTable_TableField[] = []
    bodyFields.forEach((f, i) => {
      if (i % 2 === 0) left.push(f)
      else right.push(f)
    })
    return [left, right]
  }, [bodyFields])

  const renderField = (field: EmployeeDataTable_TableField) => {
    const effectiveValue = field.key in patch ? patch[field.key] : (employee as Record<string, unknown>)[field.key]
    return (
      <div
        key={field.key}
        style={{
          display: 'flex',
          alignItems: editMode === 'edit' ? 'center' : 'flex-start',
          gap: token.marginSM,
          marginBottom: token.marginSM,
        }}
      >
        <div
          style={{
            flex: '0 0 160px',
            maxWidth: 160,
            display: 'flex',
            alignItems: 'center',
            gap: token.marginXS,
            color: token.colorTextSecondary,
            fontSize: token.fontSizeSM,
            paddingTop: editMode === 'edit' ? 0 : 2,
          }}
        >
          <span style={{ color: token.colorTextTertiary, display: 'inline-flex' }}>
            <FieldTypeIcon type={field.type} />
          </span>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }} ellipsis>
            {field.label}
          </Typography.Text>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <AppEmployeeDetailModal_FieldRenderer
            field={field}
            value={effectiveValue}
            mode={editMode}
            onChange={(next) => pModal.setState({ patch: { ...patch, [field.key]: next } })}
            choices={choicesByField[field.key]}
            organizationId={organizationId}
            onFilePreview={(fileId) => onFilePreview?.({ file_id: fileId, column_id: field.key })}
          />
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', padding: `${token.paddingMD}px 0`, alignItems: 'stretch' }}>
      <div style={{ flex: 1, minWidth: 0, paddingRight: token.paddingLG }}>
        {leftFields.map(renderField)}
      </div>
      <div style={{ width: 1, background: token.colorBorderSecondary, alignSelf: 'stretch' }} />
      <div style={{ flex: 1, minWidth: 0, paddingLeft: token.paddingLG }}>
        {rightFields.map(renderField)}
      </div>
    </div>
  )
}
