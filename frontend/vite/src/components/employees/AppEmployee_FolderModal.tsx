import { useState } from 'react'
import { Modal, Typography, theme } from 'antd'
import { useQ_Files_ReadUrl } from '@/hooks/useQ_Files_ReadUrl'
import type { OrgFileRecord } from '@/hooks/useQ_Tables_OrgFiles'
import { Utils_FileTypeIcon_Component } from '@/utils/Utils_FileTypeIcon'
import { App_FilePreviewModal } from './App_FilePreviewModal'

const CARD_WIDTH = 200
const THUMB_HEIGHT = 140

const formatBytes = (n: number | null | undefined) => {
  if (!n || n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let idx = 0
  let v = n
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024
    idx++
  }
  return `${v.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

type Props = {
  open: boolean
  onClose: () => void
  files: OrgFileRecord[]
  title?: string
  employeeId: string
  columnId: string
}

export const AppEmployee_FolderModal = ({ open, onClose, files, title, employeeId, columnId }: Props) => {
  const { token } = theme.useToken()
  const [previewFileId, setPreviewFileId] = useState<string | null>(null)
  const previewFile = previewFileId ? files.find((f) => f.id === previewFileId) ?? null : null

  const qPreviewUrl = useQ_Files_ReadUrl({
    resource_type: 'employee_col',
    file_id: previewFileId,
    employee_id: employeeId,
    column_id: columnId,
  })

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        title={title ?? `Files (${files.length})`}
        width="75vw"
        centered
        footer={null}
        destroyOnHidden
        styles={{ body: { padding: token.paddingMD, maxHeight: '75vh', overflowY: 'auto' } }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_WIDTH}px, 1fr))`,
            gap: token.marginSM,
          }}
        >
          {files.map((file) => (
            <FileCard
              key={file.id}
              file={file}
              employeeId={employeeId}
              columnId={columnId}
              onClick={() => setPreviewFileId(file.id)}
            />
          ))}
        </div>
      </Modal>
      <App_FilePreviewModal
        open={previewFileId !== null}
        url={qPreviewUrl.url ?? null}
        name={previewFile?.name ?? null}
        contentType={previewFile?.content_type ?? null}
        size={previewFile?.size ?? null}
        onClose={() => setPreviewFileId(null)}
      />
    </>
  )
}

const FileCard = ({
  file,
  employeeId,
  columnId,
  onClick,
}: {
  file: OrgFileRecord
  employeeId: string
  columnId: string
  onClick: () => void
}) => {
  const { token } = theme.useToken()
  const isImage = file.content_type?.startsWith('image/') ?? false

  const qThumbUrl = useQ_Files_ReadUrl({
    resource_type: 'employee_col',
    file_id: file.thumbnail_r2_key ? file.id : null,
    employee_id: employeeId,
    column_id: columnId,
    use_thumbnail: true,
  })

  const fileIcon = Utils_FileTypeIcon_Component(file.content_type ?? '')

  return (
    <div
      onClick={onClick}
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s',
        background: token.colorBgContainer,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = token.boxShadowSecondary }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
    >
      <div
        style={{
          height: THUMB_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: token.colorFillQuaternary,
          overflow: 'hidden',
        }}
      >
        {isImage && qThumbUrl.url ? (
          <img
            src={qThumbUrl.url}
            alt={file.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <fileIcon.Icon style={{ fontSize: 48 }} twoToneColor={fileIcon.primary} />
        )}
      </div>
      <div style={{ padding: token.paddingSM }}>
        <Typography.Text ellipsis style={{ display: 'block', fontWeight: 500 }}>
          {file.name}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {formatBytes(file.size)}
        </Typography.Text>
      </div>
    </div>
  )
}
