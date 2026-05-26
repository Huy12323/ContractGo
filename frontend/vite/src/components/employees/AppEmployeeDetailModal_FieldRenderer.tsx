import { useRef } from 'react'
import { Input, InputNumber, DatePicker, Switch, Select, Typography, Button, Spin, theme } from 'antd'
import { DeleteOutlined, UndoOutlined, LoadingOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { EmployeeDataTable_TableField } from '@/types/employeeTable.types'
import { useQ_Tables_OrgFiles } from '@/hooks/useQ_Tables_OrgFiles'
import { useQ_Files_ReadUrl } from '@/hooks/useQ_Files_ReadUrl'
import { Utils_FileTypeIcon_Component } from '@/utils/Utils_FileTypeIcon'

type Choice = { value: string; label: string }

export type FileDeleteMarker = { __delete: true; file_id: string; folder_id: string }

export const isFileDeleteMarker = (v: unknown): v is FileDeleteMarker =>
  typeof v === 'object' && v !== null && (v as { __delete?: boolean }).__delete === true

export type FileFieldMultiPatch = {
  __multi_file: true
  folder_id: string | null
  pending_uploads: File[]
  pending_deletes: string[]
}

export const isMultiFilePatch = (v: unknown): v is FileFieldMultiPatch =>
  typeof v === 'object' && v !== null && (v as { __multi_file?: boolean }).__multi_file === true

type Props = {
  field: EmployeeDataTable_TableField
  value: unknown
  mode: 'view' | 'edit'
  onChange?: (next: unknown) => void
  choices?: Choice[]
  organizationId?: string
  onFilePreview?: (fileId: string) => void
  isSaving?: boolean
  employeeId?: string
  columnId?: string
  fileInputRef?: React.RefObject<HTMLInputElement | null>
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

const CARD_THUMB = 80

const FileCard = ({ name, contentType, fileId, employeeId, columnId, onClick, overlay }: {
  name: string
  contentType?: string
  fileId?: string
  employeeId?: string
  columnId?: string
  onClick?: () => void
  overlay?: React.ReactNode
}) => {
  const { token } = theme.useToken()
  const { Icon, primary } = Utils_FileTypeIcon_Component(contentType ?? '')
  const isImage = contentType?.startsWith('image/') ?? false
  const qThumbUrl = useQ_Files_ReadUrl({
    resource_type: 'employee_col',
    file_id: isImage && fileId ? fileId : null,
    employee_id: employeeId ?? null,
    column_id: columnId ?? null,
    use_thumbnail: true,
  })
  return (
    <div
      onClick={onClick}
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusSM,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : undefined,
        background: token.colorBgContainer,
        position: 'relative',
      }}
    >
      <div style={{ height: CARD_THUMB, display: 'flex', alignItems: 'center', justifyContent: 'center', background: token.colorFillQuaternary, overflow: 'hidden' }}>
        {isImage && qThumbUrl.url ? (
          <img src={qThumbUrl.url} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Icon style={{ fontSize: 32 }} twoToneColor={primary} />
        )}
      </div>
      <div style={{ padding: `${token.paddingXXS}px ${token.paddingXS}px` }}>
        <Typography.Text ellipsis style={{ display: 'block', fontSize: token.fontSizeSM }}>{name}</Typography.Text>
      </div>
      {overlay && <div style={{ position: 'absolute', top: 4, right: 4 }}>{overlay}</div>}
    </div>
  )
}

const FileFieldView = ({
  value,
  organizationId,
  onFilePreview,
  employeeId,
  columnId,
}: {
  value: unknown
  organizationId?: string
  onFilePreview?: (fileId: string) => void
  employeeId?: string
  columnId?: string
}) => {
  const { token } = theme.useToken()
  const qOrgFiles = useQ_Tables_OrgFiles({ organizationId: organizationId ?? '' })

  if (isEmpty(value)) {
    return <Input disabled variant="filled" value="" />
  }
  const folderId = value as string
  const files = qOrgFiles.folderFilesMap[folderId]
  if (!files || files.length === 0) {
    return <Input disabled variant="filled" value="" />
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: token.marginXS }}>
      {files.map((f) => (
        <FileCard key={f.id} name={f.name} contentType={f.content_type} fileId={f.id} employeeId={employeeId} columnId={columnId} onClick={() => onFilePreview?.(f.id)} />
      ))}
    </div>
  )
}

const FileFieldEdit = ({
  value,
  onChange,
  organizationId,
  isSaving,
  employeeId,
  columnId,
  inputRef,
}: {
  value: unknown
  onChange?: (next: unknown) => void
  organizationId?: string
  isSaving?: boolean
  employeeId?: string
  columnId?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
}) => {
  const { token } = theme.useToken()
  const qOrgFiles = useQ_Tables_OrgFiles({ organizationId: organizationId ?? '' })
  const fallbackRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = inputRef ?? fallbackRef

  const multi = isMultiFilePatch(value) ? value : null
  const folderId = multi?.folder_id ?? (typeof value === 'string' && value ? value : null)
  const existingFiles = folderId ? (qOrgFiles.folderFilesMap[folderId] ?? []) : []
  const pendingUploads = multi?.pending_uploads ?? []
  const pendingDeletes = new Set(multi?.pending_deletes ?? [])
  const visibleExisting = existingFiles.filter((f) => !pendingDeletes.has(f.id))
  const deletedExisting = existingFiles.filter((f) => pendingDeletes.has(f.id))

  const emitMulti = (patch: Partial<FileFieldMultiPatch>) => {
    const base: FileFieldMultiPatch = multi ?? {
      __multi_file: true,
      folder_id: folderId,
      pending_uploads: [],
      pending_deletes: [],
    }
    onChange?.({ ...base, ...patch })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length > 0) emitMulti({ pending_uploads: [...pendingUploads, ...files] })
  }

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: token.marginXS,
  }

  if (isSaving) {
    const allFiles = [...visibleExisting.map((f) => f.name), ...pendingUploads.map((f) => f.name)]
    return (
      <div style={{ ...gridStyle, opacity: 0.7 }}>
        {allFiles.map((name, i) => (
          <FileCard key={i} name={name} overlay={<Spin indicator={<LoadingOutlined spin style={{ fontSize: 12 }} />} size="small" />} />
        ))}
      </div>
    )
  }

  const hasCards = visibleExisting.length > 0 || deletedExisting.length > 0 || pendingUploads.length > 0

  return (
    <>
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />
      {hasCards ? (
        <div style={gridStyle}>
          {visibleExisting.map((f) => (
            <FileCard
              key={f.id}
              name={f.name}
              contentType={f.content_type}
              fileId={f.id}
              employeeId={employeeId}
              columnId={columnId}
              overlay={
                <Button size="small" type="text" danger icon={<DeleteOutlined />}
                  onClick={(e) => { e.stopPropagation(); emitMulti({ pending_deletes: [...(multi?.pending_deletes ?? []), f.id] }) }}
                />
              }
            />
          ))}

          {deletedExisting.map((f) => (
            <div key={f.id} style={{ opacity: 0.4 }}>
              <FileCard
                name={f.name}
                contentType={f.content_type}
                overlay={
                  <Button size="small" type="text" icon={<UndoOutlined />}
                    onClick={(e) => { e.stopPropagation(); emitMulti({ pending_deletes: (multi?.pending_deletes ?? []).filter((id) => id !== f.id) }) }}
                  />
                }
              />
            </div>
          ))}

          {pendingUploads.map((file, i) => (
            <FileCard
              key={`pending-${i}`}
              name={file.name}
              overlay={
                <Button size="small" type="text" icon={<DeleteOutlined />}
                  onClick={(e) => { e.stopPropagation(); emitMulti({ pending_uploads: pendingUploads.filter((_, j) => j !== i) }) }}
                />
              }
            />
          ))}
        </div>
      ) : (
        <Input disabled variant="filled" value="" />
      )}
    </>
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
  isSaving,
  employeeId,
  columnId,
  fileInputRef,
}: Props) => {
  if (mode === 'view') {
    if (field.type === 'file') {
      return <FileFieldView value={value} organizationId={organizationId} onFilePreview={onFilePreview} employeeId={employeeId} columnId={columnId} />
    }
    const displayValue = isEmpty(value) ? '' : String(value)
    switch (field.type) {
      case 'number':
        return <InputNumber style={{ width: '100%' }} value={typeof value === 'number' ? value : null} disabled variant="filled" />
      case 'date':
        return <DatePicker style={{ width: '100%' }} value={typeof value === 'string' && value ? dayjs(value) : null} disabled variant="filled" />
      case 'boolean':
        return <Switch checked={value === true} disabled />
      case 'single_select': {
        const match = (choices ?? []).find((c) => c.value === value)
        return <Select style={{ width: '100%' }} value={match ? value as string : undefined} options={(choices ?? []).map((c) => ({ value: c.value, label: c.label }))} disabled variant="filled" />
      }
      case 'multi_select': {
        return <Select mode="multiple" style={{ width: '100%' }} value={Array.isArray(value) ? (value as string[]) : []} options={(choices ?? []).map((c) => ({ value: c.value, label: c.label }))} disabled variant="filled" />
      }
      case 'text':
      default:
        return <Input value={displayValue} disabled variant="filled" />
    }
  }

  // edit mode
  if (field.type === 'file') {
    return <FileFieldEdit value={value} onChange={onChange} organizationId={organizationId} isSaving={isSaving} employeeId={employeeId} columnId={columnId} inputRef={fileInputRef} />
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
