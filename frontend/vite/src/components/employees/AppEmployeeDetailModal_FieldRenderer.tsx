import { useRef } from 'react'
import { Input, InputNumber, DatePicker, Switch, Select, Tag, Typography, Button, theme } from 'antd'
import { PaperClipOutlined, UploadOutlined, DeleteOutlined, UndoOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { EmployeeDataTable_TableField } from '@/types/employeeTable.types'
import { useQ_Tables_OrgFiles } from '@/hooks/useQ_Tables_OrgFiles'

type Choice = { value: string; label: string }

// Tri-state marker for file-column remove flow. Stored in patch by the FieldRenderer,
// resolved into `null` (+ side-effect R2/files-row delete) by the modal save orchestrator.
export type FileDeleteMarker = { __delete: true; file_id: string }

export const isFileDeleteMarker = (v: unknown): v is FileDeleteMarker =>
  typeof v === 'object' && v !== null && (v as { __delete?: boolean }).__delete === true

type Props = {
  field: EmployeeDataTable_TableField
  value: unknown
  mode: 'view' | 'edit'
  onChange?: (next: unknown) => void
  choices?: Choice[]
  organizationId?: string
  onFilePreview?: (fileId: string) => void
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

const FileFieldView = ({
  value,
  organizationId,
  onFilePreview,
}: {
  value: unknown
  organizationId?: string
  onFilePreview?: (fileId: string) => void
}) => {
  const { token } = theme.useToken()
  const qOrgFiles = useQ_Tables_OrgFiles({ organizationId: organizationId ?? '' })

  if (isEmpty(value)) {
    return <Typography.Text style={{ color: token.colorTextTertiary }}>Null</Typography.Text>
  }
  const fileId = value as string
  const name = qOrgFiles.filesMap[fileId]?.name ?? fileId
  return (
    <Typography.Link onClick={() => onFilePreview?.(fileId)}>
      <PaperClipOutlined /> {name}
    </Typography.Link>
  )
}

const FileFieldEdit = ({
  value,
  onChange,
  organizationId,
}: {
  value: unknown
  onChange?: (next: unknown) => void
  organizationId?: string
}) => {
  const { token } = theme.useToken()
  const qOrgFiles = useQ_Tables_OrgFiles({ organizationId: organizationId ?? '' })
  const inputRef = useRef<HTMLInputElement | null>(null)

  const openPicker = () => inputRef.current?.click()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking same file
    if (file) onChange?.(file)
  }

  // State branching. Order matters — File check MUST come before string check.
  if (value instanceof File) {
    return (
      <div style={{ display: 'flex', gap: token.marginXS, alignItems: 'center' }}>
        <input ref={inputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />
        <PaperClipOutlined style={{ color: token.colorSuccess }} />
        <Typography.Text style={{ flex: 1 }} ellipsis>
          {value.name}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          (ready to upload)
        </Typography.Text>
        <Button size="small" onClick={() => onChange?.(null)}>
          Cancel
        </Button>
      </div>
    )
  }

  if (isFileDeleteMarker(value)) {
    const name = qOrgFiles.filesMap[value.file_id]?.name ?? value.file_id
    return (
      <div style={{ display: 'flex', gap: token.marginXS, alignItems: 'center' }}>
        <PaperClipOutlined style={{ color: token.colorTextTertiary }} />
        <Typography.Text delete style={{ flex: 1 }} ellipsis>
          {name}
        </Typography.Text>
        <Button
          size="small"
          icon={<UndoOutlined />}
          onClick={() => onChange?.(value.file_id)}
        >
          Undo
        </Button>
      </div>
    )
  }

  if (typeof value === 'string' && value) {
    const name = qOrgFiles.filesMap[value]?.name ?? value
    return (
      <div style={{ display: 'flex', gap: token.marginXS, alignItems: 'center' }}>
        <input ref={inputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />
        <PaperClipOutlined />
        <Typography.Text style={{ flex: 1 }} ellipsis>
          {name}
        </Typography.Text>
        <Button size="small" onClick={openPicker}>
          Replace
        </Button>
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => onChange?.({ __delete: true, file_id: value } satisfies FileDeleteMarker)}
        >
          Remove
        </Button>
      </div>
    )
  }

  // Empty → single Choose file button
  return (
    <div style={{ display: 'flex', gap: token.marginXS, alignItems: 'center' }}>
      <input ref={inputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />
      <Button icon={<UploadOutlined />} onClick={openPicker}>
        Choose file
      </Button>
    </div>
  )
}

export const AppEmployeeDetailModal_FieldRenderer = ({
  field,
  value,
  mode,
  onChange,
  choices,
  organizationId,
  onFilePreview,
}: Props) => {
  const { token } = theme.useToken()

  if (mode === 'view') {
    if (field.type === 'file') {
      return <FileFieldView value={value} organizationId={organizationId} onFilePreview={onFilePreview} />
    }
    if (isEmpty(value)) {
      return <Typography.Text style={{ color: token.colorTextTertiary }}>Null</Typography.Text>
    }
    switch (field.type) {
      case 'number':
        return <Typography.Text>{String(value)}</Typography.Text>
      case 'date':
        return <Typography.Text>{formatDate(value as string)}</Typography.Text>
      case 'boolean':
        return <Typography.Text>{value === true ? 'Yes' : 'No'}</Typography.Text>
      case 'single_select': {
        const match = (choices ?? []).find((c) => c.value === value)
        return <Tag>{match?.label ?? String(value)}</Tag>
      }
      case 'multi_select': {
        const arr = Array.isArray(value) ? (value as string[]) : []
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXXS }}>
            {arr.map((v) => {
              const match = (choices ?? []).find((c) => c.value === v)
              return <Tag key={v}>{match?.label ?? v}</Tag>
            })}
          </div>
        )
      }
      case 'text':
      default:
        return <Typography.Text>{String(value)}</Typography.Text>
    }
  }

  // edit mode
  if (field.type === 'file') {
    return <FileFieldEdit value={value} onChange={onChange} organizationId={organizationId} />
  }
  switch (field.type) {
    case 'number':
      return (
        <InputNumber
          style={{ width: '100%' }}
          value={typeof value === 'number' ? value : null}
          onChange={(v) => onChange?.(v)}
        />
      )
    case 'date':
      return (
        <DatePicker
          style={{ width: '100%' }}
          value={typeof value === 'string' && value ? dayjs(value) : null}
          onChange={(d) => onChange?.(d ? d.format('YYYY-MM-DD') : null)}
        />
      )
    case 'boolean':
      return <Switch checked={value === true} onChange={(checked) => onChange?.(checked)} />
    case 'single_select':
      return (
        <Select
          style={{ width: '100%' }}
          allowClear
          value={typeof value === 'string' && value ? value : undefined}
          options={(choices ?? []).map((c) => ({ value: c.value, label: c.label }))}
          onChange={(v) => onChange?.(v ?? null)}
        />
      )
    case 'multi_select':
      return (
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          value={Array.isArray(value) ? (value as string[]) : []}
          options={(choices ?? []).map((c) => ({ value: c.value, label: c.label }))}
          onChange={(v) => onChange?.(v)}
        />
      )
    case 'text':
    default:
      return (
        <Input
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange?.(e.target.value)}
        />
      )
  }
}
