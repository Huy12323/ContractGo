import { useState, useMemo, useCallback, useEffect } from 'react'
import { App, Modal, Steps, Button, Input, Typography, Descriptions, Tag, Select, theme } from 'antd'
import { SendOutlined, FileTextOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { QueryKeys } from '@/utils/query/queryKeys'
import { useQ_Tables_ContractTemplates } from '@/hooks/useQ_Tables_ContractTemplates'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useM_OnboardingInvitation_Send } from '@/hooks/useM_OnboardingInvitation_Send'
import { useM_Files_Upload } from '@/hooks/useM_Files_Upload'
import { useQ_ContractTemplate_PdfReadUrl } from '@/hooks/useQ_ContractTemplate_PdfReadUrl'
import { supabase } from '@/configs/supabase/config'
import { App_ContractFiller } from './App_ContractFiller'
import { App_ContractTemplatesManager } from './App_ContractTemplatesManager'
import type { JSONContent } from '@tiptap/core'
import type { PdfLayout } from '@/types/contractTemplate.types'

type Props = {
    open: boolean
    onClose: () => void
    organizationId: string
}

const STEPS = [
    { title: 'Email & Entity' },
    { title: 'Contract & Pre-fill' },
    { title: 'Review & Send' },
]

export const App_OnboardingWizardModal = ({ open, onClose, organizationId }: Props) => {
    const { token } = theme.useToken()

    // Step state
    const [currentStep, setCurrentStep] = useState(0)

    // Selection state
    const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
    const [prefilledFields, setPrefilledFields] = useState<Record<string, unknown>>({})
    const [employeeEmail, setEmployeeEmail] = useState('')

    // Data hooks
    const qTemplates = useQ_Tables_ContractTemplates({ entityId: selectedEntityId || '' })
    const qColumns = useQ_Tables_EmployeeColumns({ entityId: selectedEntityId || '' })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ entityId: selectedEntityId || '' })
    const qEntities = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.entities.list(), { organizationId }],
        queryFn: async () => {
            const sb_FromEntities_Select = await supabase.from('entities').select('id, name, timezone').eq('organization_id', organizationId).order('created_at', { ascending: true })
            if (sb_FromEntities_Select.error) throw sb_FromEntities_Select.error
            return sb_FromEntities_Select.data
        },
    })
    const entities = useMemo(() => qEntities.data || [], [qEntities.data])
    const selectedEntity = useMemo(() => entities.find((e) => e.id === selectedEntityId) ?? null, [entities, selectedEntityId])
    const mSend = useM_OnboardingInvitation_Send()
    const mFilesUpload = useM_Files_Upload()
    const { message } = App.useApp()
    const [sendOrchestrating, setSendOrchestrating] = useState(false)

    // Derived
    const selectedTemplate = useMemo(
        () => qTemplates.templates.find((t) => t.id === selectedTemplateId) ?? null,
        [qTemplates.templates, selectedTemplateId],
    )
    const selectedTemplateKind: 'tiptap' | 'pdf' = selectedTemplate?.type === 'pdf' ? 'pdf' : 'tiptap'

    // PDF read URL — only fires when the selected template is pdf-kind. Wizard pre-dates
    // the invitation so the live-template (admin-only) hook is correct here. The hook's
    // enabled gate keeps it dormant otherwise.
    const qSelectedTemplatePdfUrl = useQ_ContractTemplate_PdfReadUrl({
        contractTemplateId: selectedTemplateKind === 'pdf' ? (selectedTemplate?.id ?? null) : null,
        pdfFilePathKey: selectedTemplateKind === 'pdf' ? (selectedTemplate?.pdf_file_path ?? null) : null,
    })
    const prefilledCount = useMemo(
        () => Object.values(prefilledFields).filter((v) => v !== undefined && v !== '' && v !== null).length,
        [prefilledFields],
    )

    // HR-fill gate: all hr_field_keys must have a non-empty value before HR can send the invitation.
    // The in-contract chip marks these fields; the employee sees them locked read-only.
    const unfilledHrKeys = useMemo(() => {
        if (!selectedTemplate) return []
        const hrKeys = (selectedTemplate.hr_field_keys ?? []) as string[]
        return hrKeys.filter((k) => {
            const v = prefilledFields[k]
            return v === undefined || v === null || v === ''
        })
    }, [selectedTemplate, prefilledFields])

    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeEmail)
    const normalizedEmail = employeeEmail.toLowerCase().trim()

    const [debouncedEmail, setDebouncedEmail] = useState('')
    useEffect(() => {
        if (!isValidEmail) { setDebouncedEmail(''); return }
        const timer = setTimeout(() => setDebouncedEmail(normalizedEmail), 500)
        return () => clearTimeout(timer)
    }, [normalizedEmail, isValidEmail])

    const qDuplicateCheck = useQuery({
        enabled: !!debouncedEmail && !!selectedEntityId,
        queryKey: [...QueryKeys.employees.list(), 'duplicate-check', { entityId: selectedEntityId, email: debouncedEmail }],
        queryFn: async () => {
            const [sb_FromEmployees_Select, sb_FromOnboardingInvitations_Select] = await Promise.all([
                supabase.from('employees').select('id').eq('entity_id', selectedEntityId!).ilike('email', debouncedEmail).limit(1),
                supabase.from('onboarding_invitations').select('id, status').eq('entity_id', selectedEntityId!).ilike('employee_email', debouncedEmail).in('status', ['sent', 'accepted']).limit(1),
            ])
            if (sb_FromEmployees_Select.error) throw sb_FromEmployees_Select.error
            if (sb_FromOnboardingInvitations_Select.error) throw sb_FromOnboardingInvitations_Select.error
            const existingEmployee = (sb_FromEmployees_Select.data?.length ?? 0) > 0
            const pendingInvitation = sb_FromOnboardingInvitations_Select.data?.[0] ?? null
            return { existingEmployee, pendingInvitation }
        },
    })

    const duplicateError = useMemo(() => {
        if (!qDuplicateCheck.data) return null
        if (qDuplicateCheck.data.existingEmployee) return 'An employee with this email already exists in this entity.'
        if (qDuplicateCheck.data.pendingInvitation) {
            return qDuplicateCheck.data.pendingInvitation.status === 'accepted'
                ? 'A contract from this email is already pending HR approval in this entity.'
                : 'There is already a pending invitation for this email in this entity.'
        }
        return null
    }, [qDuplicateCheck.data])

    // When HR clicks Next from Step 2 with unfilled HR fields, flip this on so we start
    // showing inline per-field errors. Errors clear automatically as HR fills fields
    // (unfilledHrKeys is continuously derived from prefilledFields).
    const [triedNextFromStep2, setTriedNextFromStep2] = useState(false)

    const hrFieldErrors = useMemo(() => {
        if (!triedNextFromStep2) return {}
        const errors: Record<string, string> = {}
        for (const k of unfilledHrKeys) {
            errors[k] = 'HR must fill this field before sending the invitation.'
        }
        return errors
    }, [triedNextFromStep2, unfilledHrKeys])

    // Step validation — Next button stays enabled for HR gate (errors surface on click).
    // Email validity + mSend pending still gate Step 3 as hard requirements.
    const canProceed = useMemo(() => {
        switch (currentStep) {
            case 0: return isValidEmail && !!selectedEntityId && !duplicateError && !qDuplicateCheck.isLoading
            case 1: return !!selectedTemplateId
            case 2: return unfilledHrKeys.length === 0 && !mSend.mutation.isPending
            default: return false
        }
    }, [currentStep, isValidEmail, selectedEntityId, selectedTemplateId, unfilledHrKeys.length, mSend.mutation.isPending, duplicateError, qDuplicateCheck.isLoading])

    const handleReset = useCallback(() => {
        setCurrentStep(0)
        setSelectedEntityId(null)
        setSelectedTemplateId(null)
        setPrefilledFields({})
        setEmployeeEmail('')
        setTriedNextFromStep2(false)
    }, [])

    const handleNext = useCallback(() => {
        if (currentStep === 1 && unfilledHrKeys.length > 0) {
            // Gate HR-fill errors — reveal inline errors, stay on step.
            setTriedNextFromStep2(true)
            return
        }
        setCurrentStep((s) => s + 1)
    }, [currentStep, unfilledHrKeys.length])

    const handleClose = useCallback(() => {
        handleReset()
        onClose()
    }, [onClose, handleReset])

    const handleSend = useCallback(async () => {
        if (!selectedTemplateId || !employeeEmail || !selectedEntityId) return

        // Partition prefilled entries: Files go through the two-phase upload flow
        // below, scalar values go in the initial invitation row.
        const fileEntries: Array<[string, File]> = []
        const scalarEntries: Array<[string, unknown]> = []
        for (const [k, v] of Object.entries(prefilledFields)) {
            if (v === undefined || v === null || v === '') continue
            if (v instanceof File) fileEntries.push([k, v])
            else scalarEntries.push([k, v])
        }
        const scalarPrefilled = Object.fromEntries(scalarEntries)

        // Fast path — no attachments, single atomic send.
        if (fileEntries.length === 0) {
            mSend.mutation.mutate(
                {
                    organization_id: organizationId,
                    entity_id: selectedEntityId,
                    employee_email: employeeEmail,
                    contract_template_id: selectedTemplateId,
                    prefilled_fields: scalarPrefilled,
                },
                { onSuccess: handleClose },
            )
            return
        }

        // Orchestrated path — create invitation (no email), upload each File scoped to
        // the new invitation_id, PATCH prefilled_fields with resolved file_ids, then
        // trigger email via the phase-2 endpoint. Errors anywhere surface as a single
        // message — the invitation row may already exist; HR can re-attempt via review.
        setSendOrchestrating(true)
        try {
            const sb_FunctionsEmployeeOnboardingSendInvitation_Invoke =
                await supabase.functions.invoke('employee-onboarding_send-invitation', {
                    body: {
                        organization_id: organizationId,
                        entity_id: selectedEntityId,
                        employee_email: employeeEmail,
                        contract_template_id: selectedTemplateId,
                        prefilled_fields: scalarPrefilled,
                        skip_email: true,
                    },
                })
            if (sb_FunctionsEmployeeOnboardingSendInvitation_Invoke.error) {
                throw new Error('Failed to create invitation')
            }
            const { id: invitationId } =
                sb_FunctionsEmployeeOnboardingSendInvitation_Invoke.data as {
                    id: string
                    invitation_token: string
                }

            const resolvedEntries: Array<[string, string]> = []
            for (const [columnId, file] of fileEntries) {
                const result = await mFilesUpload.mutation.mutateAsync({
                    resource_type: 'invitation_col',
                    file,
                    invitation_id: invitationId,
                    column_id: columnId,
                })
                resolvedEntries.push([columnId, result.file_id])
            }

            const finalPrefilled = {
                ...scalarPrefilled,
                ...Object.fromEntries(resolvedEntries),
            }
            const sb_FromOnboardingInvitations_Update = await supabase
                .from('onboarding_invitations')
                .update({
                    prefilled_fields:
                        finalPrefilled as Record<string, string | number | boolean | null>,
                })
                .eq('id', invitationId)
            if (sb_FromOnboardingInvitations_Update.error) {
                throw sb_FromOnboardingInvitations_Update.error
            }

            const sb_FunctionsEmployeeOnboardingSendInvitationEmail_Invoke =
                await supabase.functions.invoke(
                    'employee-onboarding_send-invitation-email',
                    { body: { invitation_id: invitationId } },
                )
            if (sb_FunctionsEmployeeOnboardingSendInvitationEmail_Invoke.error) {
                throw new Error('Failed to send invitation email')
            }

            message.success('Onboarding invitation sent')
            handleClose()
        } catch (err) {
            console.error(err)
            message.error(err instanceof Error ? err.message : 'Failed to send invitation')
        } finally {
            setSendOrchestrating(false)
        }
    }, [
        organizationId,
        selectedEntityId,
        selectedTemplateId,
        prefilledFields,
        employeeEmail,
        mSend.mutation,
        mFilesUpload.mutation,
        handleClose,
        message,
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
                                onClick={handleNext}
                            >
                                Next
                            </Button>
                        ) : (
                            <Button
                                type="primary"
                                icon={<SendOutlined />}
                                disabled={!canProceed}
                                loading={mSend.mutation.isPending || sendOrchestrating}
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

            {/* Step 0: Email & Entity */}
            {currentStep === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginMD, maxWidth: 480 }}>
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
                    <div>
                        <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXS }}>
                            Entity *
                        </Typography.Text>
                        <Select
                            placeholder="Select entity..."
                            style={{ width: '100%' }}
                            value={selectedEntityId}
                            onChange={setSelectedEntityId}
                            loading={qEntities.isLoading}
                            options={entities.map((e) => ({ value: e.id, label: `${e.name}${e.timezone ? ` (${e.timezone})` : ''}` }))}
                        />
                    </div>
                    {duplicateError && (
                        <Typography.Text type="danger" style={{ fontSize: token.fontSizeSM }}>
                            {duplicateError}
                        </Typography.Text>
                    )}
                </div>
            )}

            {/* Step 1: Contract Template & Pre-fill */}
            {currentStep === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                    {!selectedTemplateId ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM, height: '100%', minHeight: 0 }}>
                            <Typography.Text strong>Select Contract Template *</Typography.Text>
                            <App_ContractTemplatesManager
                                organizationId={organizationId}
                                entityId={selectedEntityId || ''}
                                selectedTemplateId={selectedTemplateId}
                                onSelect={setSelectedTemplateId}
                            />
                        </div>
                    ) : selectedTemplate ? (
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: token.marginSM, marginBottom: token.marginSM, flexShrink: 0 }}>
                                <Tag color="blue">{selectedTemplate.name}</Tag>
                                <Button type="link" size="small" onClick={() => setSelectedTemplateId(null)}>Change template</Button>
                            </div>
                            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                                {selectedTemplateKind === 'pdf' ? (
                                    <App_ContractFiller
                                        kind="pdf"
                                        layout={(selectedTemplate.layout as unknown as PdfLayout) ?? []}
                                        pdfFileUrl={qSelectedTemplatePdfUrl.url ?? null}
                                        fieldValues={prefilledFields}
                                        onChange={handleFieldChange}
                                        columns={qColumns.columns}
                                        choices={qChoices.choices}
                                        mandatoryKeys={(selectedTemplate.mandatory_field_keys ?? []) as string[]}
                                        hrFieldKeys={(selectedTemplate.hr_field_keys ?? []) as string[]}
                                        attachmentFieldKeys={(selectedTemplate.attachment_field_keys ?? []) as string[]}
                                        errors={hrFieldErrors}
                                        organization_id={organizationId}
                                        uploadContext={{ kind: 'defer' }}
                                    />
                                ) : (
                                    <App_ContractFiller
                                        layout={selectedTemplate.layout as JSONContent}
                                        fieldValues={prefilledFields}
                                        onChange={handleFieldChange}
                                        columns={qColumns.columns}
                                        choices={qChoices.choices}
                                        mandatoryKeys={(selectedTemplate.mandatory_field_keys ?? []) as string[]}
                                        hrFieldKeys={(selectedTemplate.hr_field_keys ?? []) as string[]}
                                        attachmentFieldKeys={(selectedTemplate.attachment_field_keys ?? []) as string[]}
                                        errors={hrFieldErrors}
                                        organization_id={organizationId}
                                        uploadContext={{ kind: 'defer' }}
                                    />
                                )}
                            </div>
                        </div>
                    ) : (
                        <Typography.Text type="secondary">No template selected</Typography.Text>
                    )}
                </div>
            )}

            {/* Step 2: Review & Send */}
            {currentStep === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginMD }}>
                    <Descriptions
                        column={1}
                        size="small"
                        bordered
                        title="Summary"
                    >
                        <Descriptions.Item label="Employee Email">
                            {employeeEmail}
                        </Descriptions.Item>
                        <Descriptions.Item label="Entity">
                            {selectedEntity?.name ?? '—'}{selectedEntity?.timezone ? ` (${selectedEntity.timezone})` : ''}
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
        </Modal>
    )
}
