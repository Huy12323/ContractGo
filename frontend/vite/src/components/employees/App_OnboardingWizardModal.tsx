import { useState, useMemo, useCallback } from 'react'
import { Modal, Steps, Button, Input, Typography, Descriptions, Tag, theme } from 'antd'
import { SendOutlined, FileTextOutlined } from '@ant-design/icons'
import { useQ_Tables_ContractTemplates } from '@/hooks/useQ_Tables_ContractTemplates'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useM_OnboardingInvitation_Send } from '@/hooks/useM_OnboardingInvitation_Send'
import { App_ContractFiller } from './App_ContractFiller'
import { App_ContractTemplatesManager } from './App_ContractTemplatesManager'
import type { JSONContent } from '@tiptap/core'

type Props = {
    open: boolean
    onClose: () => void
    organizationId: string
}

const STEPS = [
    { title: 'Contract Template' },
    { title: 'Pre-fill Fields' },
    { title: 'Send Invitation' },
]

export const App_OnboardingWizardModal = ({ open, onClose, organizationId }: Props) => {
    const { token } = theme.useToken()

    // Step state
    const [currentStep, setCurrentStep] = useState(0)

    // Selection state
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
    const [prefilledFields, setPrefilledFields] = useState<Record<string, unknown>>({})
    const [employeeEmail, setEmployeeEmail] = useState('')

    // Data hooks
    const qTemplates = useQ_Tables_ContractTemplates({ organizationId })
    const qColumns = useQ_Tables_EmployeeColumns({ organizationId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ organizationId })
    const mSend = useM_OnboardingInvitation_Send()

    // Derived
    const selectedTemplate = useMemo(
        () => qTemplates.templates.find((t) => t.id === selectedTemplateId) ?? null,
        [qTemplates.templates, selectedTemplateId],
    )
    const prefilledCount = useMemo(
        () => Object.values(prefilledFields).filter((v) => v !== undefined && v !== '' && v !== null).length,
        [prefilledFields],
    )

    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeEmail)

    // Step validation
    const canProceed = useMemo(() => {
        switch (currentStep) {
            case 0: return !!selectedTemplateId
            case 1: return true // pre-fill is optional
            case 2: return isValidEmail && !mSend.mutation.isPending
            default: return false
        }
    }, [currentStep, selectedTemplateId, isValidEmail, mSend.mutation.isPending])

    const handleReset = useCallback(() => {
        setCurrentStep(0)
        setSelectedTemplateId(null)
        setPrefilledFields({})
        setEmployeeEmail('')
    }, [])

    const handleClose = useCallback(() => {
        handleReset()
        onClose()
    }, [onClose, handleReset])

    const handleSend = useCallback(() => {
        if (!selectedTemplateId || !employeeEmail) return

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
                contract_template_id: selectedTemplateId,
                prefilled_fields: cleanedPrefilled,
            },
            { onSuccess: handleClose },
        )
    }, [
        organizationId, selectedTemplateId, prefilledFields,
        employeeEmail, mSend.mutation, handleClose,
    ])

    const handleFieldChange = useCallback((key: string, value: unknown) => {
        setPrefilledFields((prev) => ({ ...prev, [key]: value }))
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
            <div style={{ flex: 1, overflow: currentStep === 1 ? 'hidden' : 'auto', minHeight: 0 }}>

            {/* Step 1: Contract Template */}
            {currentStep === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM, height: '100%', minHeight: 0 }}>
                    <Typography.Text strong>Select Contract Template *</Typography.Text>
                    <App_ContractTemplatesManager
                        organizationId={organizationId}
                        selectedTemplateId={selectedTemplateId}
                        onSelect={setSelectedTemplateId}
                    />
                </div>
            )}

            {/* Step 2: Pre-fill Fields */}
            {currentStep === 1 && (
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

            {/* Step 3: Email + Send */}
            {currentStep === 2 && (
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
        </Modal>
    )
}
