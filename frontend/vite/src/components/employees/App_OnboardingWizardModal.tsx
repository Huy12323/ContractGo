import { useState, useMemo, useCallback } from 'react'
import { Modal, Steps, Button, Select, Checkbox, Input, Typography, Card, Descriptions, Tag, Empty, App, theme } from 'antd'
import { SendOutlined, FileTextOutlined, TeamOutlined, BankOutlined, PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useQ_Tables_OrgEntities } from '@/hooks/useQ_Tables_OrgEntities'
import { useQ_Tables_EntityDepartments } from '@/hooks/useQ_Tables_EntityDepartments'
import { useQ_Tables_ContractTemplates } from '@/hooks/useQ_Tables_ContractTemplates'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useM_OnboardingInvitation_Send } from '@/hooks/useM_OnboardingInvitation_Send'
import { useM_ContractTemplate_Archive } from '@/hooks/useM_ContractTemplate_Archive'
import { App_ContractFiller } from './App_ContractFiller'
import { App_FormBuilderModal } from './App_FormBuilderModal'
import type { JSONContent } from '@tiptap/core'

type Props = {
    open: boolean
    onClose: () => void
    organizationId: string
}

const STEPS = [
    { title: 'Entity & Departments' },
    { title: 'Contract Template' },
    { title: 'Pre-fill Fields' },
    { title: 'Send Invitation' },
]

export const App_OnboardingWizardModal = ({ open, onClose, organizationId }: Props) => {
    const { token } = theme.useToken()
    const { modal } = App.useApp()

    // Step state
    const [currentStep, setCurrentStep] = useState(0)

    // Selection state
    const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
    const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([])
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
    const [prefilledFields, setPrefilledFields] = useState<Record<string, unknown>>({})
    const [employeeEmail, setEmployeeEmail] = useState('')

    // Template management state (step 2)
    const [templateSearch, setTemplateSearch] = useState('')
    const [builderOpen, setBuilderOpen] = useState(false)
    const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
    const [hoveredTemplateId, setHoveredTemplateId] = useState<string | null>(null)

    // Data hooks
    const qEntities = useQ_Tables_OrgEntities({ organizationId })
    const qDepartments = useQ_Tables_EntityDepartments({ entityId: selectedEntityId || '' })
    const qTemplates = useQ_Tables_ContractTemplates({ organizationId })
    const qColumns = useQ_Tables_EmployeeColumns({ organizationId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ organizationId })
    const mSend = useM_OnboardingInvitation_Send()
    const mArchive = useM_ContractTemplate_Archive()

    // Derived
    const selectedTemplate = useMemo(
        () => qTemplates.templates.find((t) => t.id === selectedTemplateId) ?? null,
        [qTemplates.templates, selectedTemplateId],
    )
    const selectedEntity = useMemo(
        () => qEntities.entities.find((e) => e.id === selectedEntityId) ?? null,
        [qEntities.entities, selectedEntityId],
    )
    const selectedDepartments = useMemo(
        () => qDepartments.departments.filter((d) => selectedDepartmentIds.includes(d.id)),
        [qDepartments.departments, selectedDepartmentIds],
    )
    const prefilledCount = useMemo(
        () => Object.values(prefilledFields).filter((v) => v !== undefined && v !== '' && v !== null).length,
        [prefilledFields],
    )

    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeEmail)

    // Step validation
    const canProceed = useMemo(() => {
        switch (currentStep) {
            case 0: return !!selectedEntityId
            case 1: return !!selectedTemplateId
            case 2: return true // pre-fill is optional
            case 3: return isValidEmail && !mSend.mutation.isPending
            default: return false
        }
    }, [currentStep, selectedEntityId, selectedTemplateId, isValidEmail, mSend.mutation.isPending])

    const handleReset = useCallback(() => {
        setCurrentStep(0)
        setSelectedEntityId(null)
        setSelectedDepartmentIds([])
        setSelectedTemplateId(null)
        setPrefilledFields({})
        setEmployeeEmail('')
    }, [])

    const handleClose = useCallback(() => {
        handleReset()
        onClose()
    }, [onClose, handleReset])

    const handleSend = useCallback(() => {
        if (!selectedEntityId || !selectedTemplateId || !employeeEmail) return

        // Drop empty/null/undefined entries — unfilled fields should not count as pre-filled
        const cleanedPrefilled = Object.fromEntries(
            Object.entries(prefilledFields).filter(
                ([, v]) => v !== undefined && v !== null && v !== '',
            ),
        )

        mSend.mutation.mutate(
            {
                organization_id: organizationId,
                employee_email: employeeEmail,
                entity_id: selectedEntityId,
                contract_template_id: selectedTemplateId,
                department_ids: selectedDepartmentIds,
                prefilled_fields: cleanedPrefilled,
            },
            { onSuccess: handleClose },
        )
    }, [
        organizationId, selectedEntityId, selectedTemplateId, selectedDepartmentIds,
        prefilledFields, employeeEmail, mSend.mutation, handleClose,
    ])

    const handleFieldChange = useCallback((key: string, value: unknown) => {
        setPrefilledFields((prev) => ({ ...prev, [key]: value }))
    }, [])

    // Reset departments when entity changes
    const handleEntityChange = useCallback((entityId: string) => {
        setSelectedEntityId(entityId)
        setSelectedDepartmentIds([])
    }, [])

    // Filtered template list for search input (case-insensitive name match)
    const filteredTemplates = useMemo(() => {
        const q = templateSearch.trim().toLowerCase()
        if (!q) return qTemplates.templates
        return qTemplates.templates.filter((t) => t.name.toLowerCase().includes(q))
    }, [qTemplates.templates, templateSearch])

    const handleArchiveTemplate = useCallback((templateId: string, templateName: string) => {
        modal.confirm({
            title: 'Archive template?',
            content: `"${templateName}" will be hidden from this list. Existing onboarding invitations that reference it will continue to work.`,
            okText: 'Archive',
            okButtonProps: { danger: true },
            onOk: async () => {
                await mArchive.mutation.mutateAsync({ templateId })
                if (selectedTemplateId === templateId) setSelectedTemplateId(null)
            },
        })
    }, [modal, mArchive.mutation, selectedTemplateId])

    const openBuilderCreate = useCallback(() => {
        setEditingTemplateId(null)
        setBuilderOpen(true)
    }, [])

    const openBuilderEdit = useCallback((templateId: string) => {
        setEditingTemplateId(templateId)
        setBuilderOpen(true)
    }, [])

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            title="Onboard Employee"
            width="80vw"
            destroyOnHidden
            styles={{ body: { height: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}
            footer={
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Button
                        disabled={currentStep === 0}
                        onClick={() => setCurrentStep((s) => s - 1)}
                    >
                        Back
                    </Button>
                    <div style={{ display: 'flex', gap: token.marginXS }}>
                        {currentStep < STEPS.length - 1 ? (
                            <Button
                                type="primary"
                                disabled={!canProceed}
                                onClick={() => setCurrentStep((s) => s + 1)}
                            >
                                Next
                            </Button>
                        ) : (
                            <Button
                                type="primary"
                                icon={<SendOutlined />}
                                disabled={!canProceed}
                                loading={mSend.mutation.isPending}
                                onClick={handleSend}
                            >
                                Send Invitation
                            </Button>
                        )}
                    </div>
                </div>
            }
        >
            <Steps
                current={currentStep}
                items={STEPS}
                size="small"
                style={{ marginBottom: token.marginLG, flexShrink: 0 }}
            />

            {/* Step content — fills remaining height */}
            <div style={{ flex: 1, overflow: currentStep === 2 ? 'hidden' : 'auto', minHeight: 0 }}>

            {/* Step 1: Entity + Departments */}
            {currentStep === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginMD }}>
                    <div>
                        <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXS }}>
                            Entity *
                        </Typography.Text>
                        <Select
                            placeholder="Select entity"
                            style={{ width: '100%' }}
                            value={selectedEntityId}
                            onChange={handleEntityChange}
                            options={qEntities.entities.map((e) => ({ value: e.id, label: e.name }))}
                            loading={qEntities.query.isLoading}
                        />
                    </div>
                    {selectedEntityId && (
                        <div>
                            <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXS }}>
                                Departments (optional)
                            </Typography.Text>
                            {qDepartments.query.isLoading ? (
                                <Typography.Text type="secondary">Loading departments...</Typography.Text>
                            ) : qDepartments.departments.length === 0 ? (
                                <Typography.Text type="secondary">No departments in this entity</Typography.Text>
                            ) : (
                                <Checkbox.Group
                                    value={selectedDepartmentIds}
                                    onChange={(vals) => setSelectedDepartmentIds(vals as string[])}
                                    style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}
                                >
                                    {qDepartments.departments.map((d) => (
                                        <Checkbox key={d.id} value={d.id}>
                                            {d.name}
                                        </Checkbox>
                                    ))}
                                </Checkbox.Group>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Step 2: Contract Template */}
            {currentStep === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS, flexShrink: 0 }}>
                        <Typography.Text strong style={{ flex: 1 }}>Select Contract Template *</Typography.Text>
                        <Input
                            placeholder="Search templates"
                            prefix={<SearchOutlined />}
                            value={templateSearch}
                            onChange={(e) => setTemplateSearch(e.target.value)}
                            allowClear
                            style={{ width: 260 }}
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
                            {filteredTemplates.map((t) => {
                                const isSelected = selectedTemplateId === t.id
                                const isHovered = hoveredTemplateId === t.id
                                return (
                                    <Card
                                        key={t.id}
                                        size="small"
                                        hoverable
                                        onClick={() => setSelectedTemplateId(t.id)}
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
                                            <FileTextOutlined style={{ color: token.colorPrimary }} />
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
                                                    onClick={(e) => { e.stopPropagation(); handleArchiveTemplate(t.id, t.name) }}
                                                />
                                            </div>
                                        </div>
                                    </Card>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Step 3: Pre-fill Fields */}
            {currentStep === 2 && (
                <div style={{ height: '100%' }}>
                    {selectedTemplate ? (
                        <App_ContractFiller
                            layout={selectedTemplate.layout as JSONContent}
                            fieldValues={prefilledFields}
                            onChange={handleFieldChange}
                            columns={qColumns.columns}
                            choices={qChoices.choices}
                        />
                    ) : (
                        <Typography.Text type="secondary">No template selected</Typography.Text>
                    )}
                </div>
            )}

            {/* Step 4: Email + Send */}
            {currentStep === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginMD }}>
                    <div>
                        <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXS }}>
                            Employee Email *
                        </Typography.Text>
                        <Input
                            placeholder="employee@example.com"
                            type="email"
                            value={employeeEmail}
                            onChange={(e) => setEmployeeEmail(e.target.value)}
                        />
                    </div>

                    <Descriptions
                        column={1}
                        size="small"
                        bordered
                        title="Summary"
                        style={{ marginTop: token.marginSM }}
                    >
                        <Descriptions.Item label={<><BankOutlined /> Entity</>}>
                            {selectedEntity?.name ?? '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label={<><TeamOutlined /> Departments</>}>
                            {selectedDepartments.length > 0
                                ? selectedDepartments.map((d) => <Tag key={d.id}>{d.name}</Tag>)
                                : <Typography.Text type="secondary">None</Typography.Text>}
                        </Descriptions.Item>
                        <Descriptions.Item label={<><FileTextOutlined /> Template</>}>
                            {selectedTemplate?.name ?? '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="Pre-filled Fields">
                            {prefilledCount > 0
                                ? <Tag color="blue">{prefilledCount} field{prefilledCount > 1 ? 's' : ''}</Tag>
                                : <Typography.Text type="secondary">None</Typography.Text>}
                        </Descriptions.Item>
                    </Descriptions>
                </div>
            )}

            </div>{/* end step content wrapper */}

            <App_FormBuilderModal
                open={builderOpen}
                onClose={() => { setBuilderOpen(false); setEditingTemplateId(null) }}
                organizationId={organizationId}
                formId={editingTemplateId}
            />
        </Modal>
    )
}
