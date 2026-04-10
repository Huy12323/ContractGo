import { useState } from 'react'
import { Button, Card, Empty, Spin, Typography, App, theme } from 'antd'
import { PlusOutlined, CopyOutlined, DeleteOutlined, FileTextOutlined } from '@ant-design/icons'
import { useQ_Tables_ContractTemplates } from '@/hooks/useQ_Tables_ContractTemplates'
import { useM_ContractTemplate_Create } from '@/hooks/useM_ContractTemplate_Create'
import { useM_ContractTemplate_Delete } from '@/hooks/useM_ContractTemplate_Delete'
import { App_FormBuilderModal } from '@/components/employees/App_FormBuilderModal'

interface Props {
  organizationId: string
}

export const App_OnboardingFormsList = ({ organizationId }: Props) => {
  const { token } = theme.useToken()
  const { modal } = App.useApp()
  const qTemplates = useQ_Tables_ContractTemplates({ organizationId })

  const [builderOpen, setBuilderOpen] = useState(false)
  const [editingFormId, setEditingFormId] = useState<string | null>(null)
  const [deletingFormId, setDeletingFormId] = useState<string | null>(null)

  const mCreate = useM_ContractTemplate_Create()
  const mDelete = useM_ContractTemplate_Delete({
    templateId: deletingFormId ?? '',
    onSuccess: () => setDeletingFormId(null),
  })

  const handleDuplicate = async (form: { id: string; name: string; layout: unknown }) => {
    await mCreate.mutation.mutateAsync({
      organization_id: organizationId,
      name: `Copy of ${form.name}`,
      layout: form.layout as import('@/types/database.types').Json,
    })
  }

  const handleDelete = (formId: string, formName: string) => {
    setDeletingFormId(formId)
    modal.confirm({
      title: 'Delete Form',
      content: `Are you sure you want to delete "${formName}"? This cannot be undone.`,
      okText: 'Delete',
      okType: 'danger',
      onOk: () => mDelete.mutation.mutateAsync(),
      onCancel: () => setDeletingFormId(null),
    })
  }

  const handleEdit = (formId: string) => {
    setEditingFormId(formId)
    setBuilderOpen(true)
  }

  const handleCreate = () => {
    setEditingFormId(null)
    setBuilderOpen(true)
  }

  if (qTemplates.query.isLoading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: token.paddingXL }}><Spin /></div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {qTemplates.templates.length} form{qTemplates.templates.length !== 1 ? 's' : ''}
        </Typography.Text>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleCreate}>
          Create Form
        </Button>
      </div>

      {qTemplates.templates.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No onboarding forms yet"
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            Create Your First Form
          </Button>
        </Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
          {qTemplates.templates.map((form) => (
              <Card
                key={form.id}
                size="small"
                hoverable
                onClick={() => handleEdit(form.id)}
                style={{ cursor: 'pointer' }}
                styles={{ body: { padding: `${token.paddingSM}px ${token.paddingMD}px` } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: token.marginSM }}>
                    <FileTextOutlined style={{ fontSize: token.fontSizeLG, color: token.colorPrimary }} />
                    <Typography.Text strong>{form.name}</Typography.Text>
                  </div>
                  <div style={{ display: 'flex', gap: token.marginXXS }}>
                    <Button type="text" size="small" icon={<CopyOutlined />} loading={mCreate.mutation.isPending} onClick={(e) => { e.stopPropagation(); handleDuplicate(form) }} />
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); handleDelete(form.id, form.name) }} />
                  </div>
                </div>
              </Card>
          ))}
        </div>
      )}

      <App_FormBuilderModal
        open={builderOpen}
        onClose={() => { setBuilderOpen(false); setEditingFormId(null) }}
        organizationId={organizationId}
        formId={editingFormId}
      />
    </div>
  )
}
