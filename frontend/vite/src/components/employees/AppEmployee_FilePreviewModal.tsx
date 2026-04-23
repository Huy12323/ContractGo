import { useMemo } from 'react'
import { Modal, Button, Typography, Spin, theme } from 'antd'
import { PaperClipOutlined, DownloadOutlined } from '@ant-design/icons'
import { useQ_Tables_OrgFiles } from '@/hooks/useQ_Tables_OrgFiles'
import { useQ_Files_ReadUrl } from '@/hooks/useQ_Files_ReadUrl'

type Props = {
  open: boolean
  organizationId: string
  file_id: string | null
  employee_id: string | null
  column_id: string | null
  onClose: () => void
}

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

export const AppEmployee_FilePreviewModal = ({
  open,
  organizationId,
  file_id,
  employee_id,
  column_id,
  onClose,
}: Props) => {
  const { token } = theme.useToken()
  const qOrgFiles = useQ_Tables_OrgFiles({ organizationId })
  const qReadUrl = useQ_Files_ReadUrl({ file_id, employee_id, column_id })

  const file = file_id ? qOrgFiles.filesMap[file_id] : null
  const url = qReadUrl.url
  const loading = qReadUrl.query.isLoading

  const body = useMemo(() => {
    if (!file) {
      return (
        <div style={{ padding: token.paddingLG, textAlign: 'center' }}>
          <Typography.Text type="secondary">File metadata not loaded</Typography.Text>
        </div>
      )
    }
    if (loading || !url) {
      return (
        <div style={{ padding: token.paddingLG, textAlign: 'center' }}>
          <Spin />
        </div>
      )
    }
    if (file.content_type.startsWith('image/')) {
      return (
        <div
          style={{
            height: '85vh',
            background: token.colorFillTertiary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: token.paddingSM,
          }}
        >
          <img
            src={url}
            alt={file.name}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        </div>
      )
    }
    if (file.content_type === 'application/pdf') {
      return (
        <iframe
          src={url}
          title={file.name}
          style={{ width: '100%', height: '85vh', border: 0 }}
        />
      )
    }
    return (
      <div
        style={{
          padding: token.paddingLG,
          textAlign: 'center',
          background: token.colorFillTertiary,
          borderRadius: token.borderRadius,
        }}
      >
        <PaperClipOutlined style={{ fontSize: 48, color: token.colorTextTertiary }} />
        <div style={{ marginTop: token.marginSM }}>
          <Typography.Text strong>{file.name}</Typography.Text>
        </div>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {file.content_type} {formatBytes(file.size)}
          </Typography.Text>
        </div>
        <div style={{ marginTop: token.marginSM }}>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            Preview not available for this file type — use Download below.
          </Typography.Text>
        </div>
      </div>
    )
  }, [file, loading, url, token])

  const handleDownload = () => {
    if (!url || !file) return
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={file ? file.name : 'Preview'}
      // Wide + tall modal — PDFs and full-size images benefit from a big viewport.
      // Centered so 85vh content doesn't clip the top on short screens.
      width="90vw"
      centered
      styles={{ body: { padding: 0 } }}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>
          Close
        </Button>,
        <Button
          key="download"
          type="primary"
          icon={<DownloadOutlined />}
          disabled={!url || !file}
          onClick={handleDownload}
        >
          Download
        </Button>,
      ]}
    >
      {body}
    </Modal>
  )
}
