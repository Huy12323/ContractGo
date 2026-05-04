import { useState, useMemo, useCallback } from 'react'
import { App, Button, Card, Empty, Input, Typography, theme } from 'antd'
import { FileTextOutlined, FilePdfOutlined, SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useQ_Tables_ContractTemplates } from '@/hooks/useQ_Tables_ContractTemplates'
import { useM_ContractTemplate_Archive } from '@/hooks/useM_ContractTemplate_Archive'
import { App_FormBuilderModal } from './App_FormBuilderModal'

type Props = {
    organizationId: string
    selectedTemplateId?: string | null
    onSelect?: (templateId: string) => void
}

export const App_ContractTemplatesManager = ({ organizationId, selectedTemplateId, onSelect }: Props) => {
    const { token } = theme.useToken()
    const { modal } = App.useApp()

    const [templateSearch, setTemplateSearch] = useState('')
    const [builderOpen, setBuilderOpen] = useState(false)
    const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
    const [hoveredTemplateId, setHoveredTemplateId] = useState<string | null>(null)

    const qTemplates = useQ_Tables_ContractTemplates({ organizationId })
    const mArchive = useM_ContractTemplate_Archive()

    const filteredTemplates = useMemo(() => {
        const q = templateSearch.trim().toLowerCase()
        if (!q) return qTemplates.templates
        return qTemplates.templates.filter((t) => t.name.toLowerCase().includes(q))
    }, [qTemplates.templates, templateSearch])

    const handleArchive = useCallback((templateId: string, templateName: string) => {
        modal.confirm({
            title: 'Archive template?',
            content: `"${templateName}" will be hidden from this list. Existing onboarding invitations that reference it will continue to work.`,
            okText: 'Archive',
            okButtonProps: { danger: true },
            onOk: () => mArchive.mutation.mutateAsync({ templateId }),
        })
    }, [modal, mArchive.mutation])

    const openBuilderCreate = useCallback(() => {
        setEditingTemplateId(null)
        setBuilderOpen(true)
    }, [])

    const openBuilderEdit = useCallback((templateId: string) => {
        setEditingTemplateId(templateId)
        setBuilderOpen(true)
    }, [])

    const handleCardClick = useCallback((templateId: string) => {
        if (onSelect) onSelect(templateId)
        else openBuilderEdit(templateId)
    }, [onSelect, openBuilderEdit])

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM, height: '100%', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS, flexShrink: 0 }}>
                <Input
                    placeholder="Search templates"
                    prefix={<SearchOutlined />}
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    allowClear
                    style={{ flex: 1 }}
                />
                <Button type="primary" icon={<PlusOutlined />} onClick={openBuilderCreate}>
                    Create
                </Button>
            </div>

            {qTemplates.query.isLoading ? (
                <Typography.Text type="secondary">Loading templates...</Typography.Text>
            ) : qTemplates.templates.length === 0 ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No contract templates yet"
                    style={{ padding: `${token.paddingXL}px 0` }}
                >
                    <Button type="primary" icon={<PlusOutlined />} onClick={openBuilderCreate}>
                        Create your first template
                    </Button>
                </Empty>
            ) : filteredTemplates.length === 0 ? (
                <Typography.Text type="secondary">No templates match &ldquo;{templateSearch}&rdquo;</Typography.Text>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS, overflow: 'auto', minHeight: 0 }}>
                    {filteredTemplates.map((t) => {
                        const isSelected = selectedTemplateId === t.id
                        const isHovered = hoveredTemplateId === t.id
                        return (
                            <Card
                                key={t.id}
                                size="small"
                                hoverable
                                onClick={() => handleCardClick(t.id)}
                                onMouseEnter={() => setHoveredTemplateId(t.id)}
                                onMouseLeave={() => setHoveredTemplateId((id) => (id === t.id ? null : id))}
                                style={{
                                    border: isSelected
                                        ? `2px solid ${token.colorPrimary}`
                                        : `1px solid ${token.colorBorderSecondary}`,
                                    cursor: 'pointer',
                                }}
                                styles={{ body: { padding: `${token.paddingSM}px ${token.paddingMD}px` } }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: token.marginSM }}>
                                    {t.type === 'pdf' ? (
                                        <FilePdfOutlined style={{ color: token.colorError }} />
                                    ) : (
                                        <FileTextOutlined style={{ color: token.colorInfo }} />
                                    )}
                                    <Typography.Text strong style={{ flex: 1 }}>{t.name}</Typography.Text>
                                    <div style={{ display: 'flex', gap: token.marginXXS, opacity: isHovered ? 1 : 0, transition: 'opacity 0.15s' }}>
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<EditOutlined />}
                                            onClick={(e) => { e.stopPropagation(); openBuilderEdit(t.id) }}
                                        />
                                        <Button
                                            type="text"
                                            size="small"
                                            danger
                                            icon={<DeleteOutlined />}
                                            onClick={(e) => { e.stopPropagation(); handleArchive(t.id, t.name) }}
                                        />
                                    </div>
                                </div>
                            </Card>
                        )
                    })}
                </div>
            )}

            <App_FormBuilderModal
                open={builderOpen}
                onClose={() => { setBuilderOpen(false); setEditingTemplateId(null) }}
                organizationId={organizationId}
                formId={editingTemplateId}
            />
        </div>
    )
}
