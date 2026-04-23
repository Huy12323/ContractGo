import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button, Card, Spin, Typography, theme, App, Space, Tag } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, MessageOutlined, SwapOutlined } from '@ant-design/icons'
import type { JSONContent } from '@tiptap/core'
import { App_ContractFiller, extractFields } from '@/components/employees/App_ContractFiller'
import { App_SignaturePad } from '@/components/employees/App_SignaturePad'
import { useQ_PageOnboardingFiller_InvitationByToken } from '@/hooks/useQ_PageOnboardingFiller_InvitationByToken'
import { useQ_PageOnboardingFiller_InvitationPreview } from '@/hooks/useQ_PageOnboardingFiller_InvitationPreview'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useM_Onboarding_SubmitContract } from '@/hooks/useM_Onboarding_SubmitContract'
import { useQ_Me } from '@/hooks/useQ_Me'
import { Store_Auth_Actions } from '@/stores/Store_Auth'
import type { OnboardingInvitation_HrComments } from '@/types/invitation.types'

const CenteredMessage = ({ children }: { children: React.ReactNode }) => {
    const { token } = theme.useToken()
    return (
        <div style={{
            minHeight: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: token.paddingLG,
            background: 'linear-gradient(160deg, #d6e4ff 0%, #f0f5ff 30%, #fff1f0 70%, #e6f7ff 100%)',
        }}>
            <div
                style={{
                    width: '100%',
                    maxWidth: 420,
                    background: token.colorBgContainer,
                    borderRadius: token.borderRadiusLG,
                    padding: '36px 28px 28px',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
                    border: `1px solid ${token.colorBorderSecondary}`,
                    textAlign: 'center',
                }}
            >
                {children}
            </div>
        </div>
    )
}

type Props = {
    invitationToken: string
}

export const Page_OnboardingFiller = ({ invitationToken }: Props) => {
    const { token } = theme.useToken()
    const { message } = App.useApp()
    const navigate = useNavigate()

    const qMe = useQ_Me()
    const qInvitation = useQ_PageOnboardingFiller_InvitationByToken({ invitationToken })
    const invitation = qInvitation.invitation
    const qPreview = useQ_PageOnboardingFiller_InvitationPreview({
        invitationToken,
        enabled: qInvitation.query.isFetched && !invitation,
    })
    const preview = qPreview.preview
    const organizationId = invitation?.organization_id ?? ''
    const template = invitation?.contract_templates
    // Render from the invitation's pinned snapshot (AHR-1490), not the live template.
    // Snapshot is captured at send time and never mutates, so template edits after
    // send cannot change what the invitee sees or what validation requires.
    const snapshot = invitation?.template_snapshot as
        | { layout?: JSONContent; mandatory_field_keys?: string[] }
        | null
        | undefined
    const layout = useMemo(
        () => (snapshot?.layout ?? { type: 'doc', content: [] }) as JSONContent,
        [snapshot?.layout],
    )

    const qColumns = useQ_Tables_EmployeeColumns({ organizationId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ organizationId })

    const prefilled = useMemo(
        () => (invitation?.prefilled_fields ?? {}) as Record<string, unknown>,
        [invitation?.prefilled_fields],
    )

    const mandatoryKeys = useMemo(
        () => (snapshot?.mandatory_field_keys ?? []) as string[],
        [snapshot?.mandatory_field_keys],
    )

    // Existing contract (re-submit case) — invitation.contracts is a FK-reverse array
    const existingContract = useMemo(
        () => (invitation?.contracts?.[0] ?? null),
        [invitation?.contracts],
    )

    const hrComments = useMemo(
        () => (invitation?.hr_comments ?? []) as OnboardingInvitation_HrComments,
        [invitation?.hr_comments],
    )

    const hasMeaningfulValue = (v: unknown) => v !== undefined && v !== null && v !== ''

    const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({})
    const [signature, setSignature] = useState<string | null>(null)
    const [signingOut, setSigningOut] = useState(false)
    const [hydratedContractId, setHydratedContractId] = useState<string | null>(null)
    const mSubmit = useM_Onboarding_SubmitContract()

    // If this is a sent-back contract (re-submit), hydrate fieldValues from the contract's stored values.
    // Run once per contract id so we don't clobber in-progress edits on re-renders.
    useEffect(() => {
        if (!existingContract) return
        if (existingContract.status !== 'sent') return
        if (hydratedContractId === existingContract.id) return
        setFieldValues((existingContract.field_values as Record<string, unknown>) ?? {})
        setHydratedContractId(existingContract.id)
    }, [existingContract, hydratedContractId])

    // Prefilled values act as defaults; employee edits (including empty-string clears) override.
    const mergedValues = useMemo(
        () => ({ ...prefilled, ...fieldValues }),
        [prefilled, fieldValues],
    )

    const handleFieldChange = (key: string, value: unknown) => {
        setFieldValues((prev) => ({ ...prev, [key]: value }))
    }

    const handleSwitchAccount = async () => {
        setSigningOut(true)
        try {
            // Sign out via the store action so the SIGNED_OUT handler does a single,
            // deterministic navigation to /login?redirect=<onboarding>. No race with the
            // handler because the destination is stored in module state and only ONE
            // window.location.href assignment happens (inside the handler).
            await Store_Auth_Actions.signOutAndRedirect(`/onboarding/${invitationToken}`)
        } catch (err) {
            console.error(err)
            message.error('Failed to sign out')
            setSigningOut(false)
        }
    }

    const handleSubmit = async () => {
        if (!invitation) return
        if (!signature) {
            message.error('Please provide your signature before submitting')
            return
        }

        // Mandatory-field gate — only require keys that are both in mandatory_field_keys
        // AND currently present in the layout. Stale keys (field removed from template)
        // are silently ignored, matching edge-fn behavior.
        const layoutFields = extractFields(layout)
        const layoutKeys = new Set(layoutFields.map((f) => f.fieldKey))
        const missing = mandatoryKeys
            .filter((k) => layoutKeys.has(k))
            .filter((k) => !hasMeaningfulValue(mergedValues[k]))
        if (missing.length > 0) {
            const labels = missing.map((k) => layoutFields.find((f) => f.fieldKey === k)?.fieldLabel ?? k)
            message.error(`Please fill ${missing.length} required field${missing.length > 1 ? 's' : ''}: ${labels.join(', ')}`)
            return
        }

        try {
            await mSubmit.mutation.mutateAsync({
                invitation_token: invitation.invitation_token,
                // field_values stores ONLY what the employee touched (adds + overrides).
                // Final values are derived at read time: {...prefilled_fields, ...field_values}.
                // The edge fn merges identically for mandatory validation.
                field_values: fieldValues,
                signature_base64: signature,
            })
            navigate({ to: '/' })
        } catch {
            // error feedback handled by the mutation hook
        }
    }

    const primarySettled = qInvitation.query.isFetched
    const waitingForPreview = primarySettled && !invitation && (qPreview.query.isLoading || !qPreview.query.isFetched)
    if (qInvitation.query.isLoading || qMe.query.isLoading || waitingForPreview) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
                <Spin size="large" />
            </div>
        )
    }

    if (!invitation) {
        // Primary RLS-bound query returned nothing. Fall back to the preview RPC
        // to distinguish mismatched email / consumed invitation from a truly
        // invalid token.
        if (preview?.status === 'sent') {
            return (
                <CenteredMessage>
                    <div
                        style={{
                            width: 48, height: 48, borderRadius: 10, background: token.colorWarning,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
                        }}
                    >
                        <SwapOutlined style={{ fontSize: 24, color: '#fff' }} />
                    </div>
                    <Typography.Title level={4}>Different account needed</Typography.Title>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                        This invitation was sent to <strong>{preview.employee_email}</strong>
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                        You're signed in as <strong>{qMe.profile?.email ?? 'unknown'}</strong>
                    </Typography.Text>
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                        <Button onClick={() => navigate({ to: '/' })}>
                            Go to Home
                        </Button>
                        <Button
                            type="primary"
                            icon={<SwapOutlined />}
                            loading={signingOut}
                            onClick={handleSwitchAccount}
                        >
                            Switch Account
                        </Button>
                    </div>
                </CenteredMessage>
            )
        }

        if (preview?.status === 'accepted') {
            return (
                <CenteredMessage>
                    <div
                        style={{
                            width: 48, height: 48, borderRadius: 10, background: token.colorSuccess,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
                        }}
                    >
                        <CheckCircleOutlined style={{ fontSize: 24, color: '#fff' }} />
                    </div>
                    <Typography.Title level={4} style={{ marginBottom: 4 }}>
                        Already accepted
                    </Typography.Title>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                        This invitation has already been accepted. If you believe this is an error, contact your admin.
                    </Typography.Text>
                    <Button type="primary" onClick={() => navigate({ to: '/' })}>
                        Go to Home
                    </Button>
                </CenteredMessage>
            )
        }

        if (preview?.status === 'expired' || preview?.status === 'revoked') {
            return (
                <CenteredMessage>
                    <div
                        style={{
                            width: 48, height: 48, borderRadius: 10, background: token.colorWarning,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
                        }}
                    >
                        <ClockCircleOutlined style={{ fontSize: 24, color: '#fff' }} />
                    </div>
                    <Typography.Title level={4} style={{ marginBottom: 4 }}>
                        No longer available
                    </Typography.Title>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                        This invitation is no longer valid (expired or revoked). Contact your admin to request a new invitation.
                    </Typography.Text>
                    <Button type="primary" onClick={() => navigate({ to: '/' })}>
                        Go to Home
                    </Button>
                </CenteredMessage>
            )
        }

        return (
            <CenteredMessage>
                <div
                    style={{
                        width: 48, height: 48, borderRadius: 10, background: token.colorError,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
                    }}
                >
                    <CloseCircleOutlined style={{ fontSize: 24, color: '#fff' }} />
                </div>
                <Typography.Title level={4} style={{ marginBottom: 4 }}>
                    Invitation not available
                </Typography.Title>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                    This onboarding invitation does not exist or the link is invalid.
                </Typography.Text>
                <Button type="primary" onClick={() => navigate({ to: '/' })}>
                    Go to Home
                </Button>
            </CenteredMessage>
        )
    }

    const signedInEmail = qMe.profile?.email?.toLowerCase().trim() ?? ''
    const invitationEmail = invitation.employee_email.toLowerCase().trim()
    const emailMatches = signedInEmail === invitationEmail

    if (!emailMatches) {
        // Defensive: the invitee RLS policy requires email match, so reaching
        // this branch means the caller is an admin of the org viewing the row
        // through the admin policy. Admins shouldn't fill out someone else's
        // contract — send them home.
        return (
            <CenteredMessage>
                <div
                    style={{
                        width: 48, height: 48, borderRadius: 10, background: token.colorWarning,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
                    }}
                >
                    <SwapOutlined style={{ fontSize: 24, color: '#fff' }} />
                </div>
                <Typography.Title level={4}>Different account needed</Typography.Title>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    This invitation was sent to <strong>{invitation.employee_email}</strong>
                </Typography.Text>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                    You're signed in as <strong>{qMe.profile?.email ?? 'unknown'}</strong>
                </Typography.Text>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <Button onClick={() => navigate({ to: '/' })}>
                        Go to Home
                    </Button>
                    <Button
                        type="primary"
                        icon={<SwapOutlined />}
                        loading={signingOut}
                        onClick={handleSwitchAccount}
                    >
                        Switch Account
                    </Button>
                </div>
            </CenteredMessage>
        )
    }

    const departments = invitation.rel__department__invitation ?? []
    const isSubmittedAwaitingReview = existingContract?.status === 'filled'
    const isApproved = existingContract?.status === 'active'
    const isResubmitMode = existingContract?.status === 'sent'
    const formSubmittable = !existingContract || isResubmitMode

    const formatCommentTime = (iso: string): string => {
        try { return new Date(iso).toLocaleString() } catch { return iso }
    }

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: token.paddingLG, gap: token.marginMD, overflow: 'hidden' }}>
            <Card size="small">
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Typography.Title level={4} style={{ margin: 0 }}>
                        Welcome to {invitation.organizations?.name}
                    </Typography.Title>
                    <Typography.Text type="secondary">
                        Review and sign your onboarding contract — <strong>{template?.name}</strong> ({invitation.entities?.name})
                    </Typography.Text>
                    {departments.length > 0 && (
                        <div style={{ marginTop: token.marginXS }}>
                            <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: token.marginXS }}>
                                Departments:
                            </Typography.Text>
                            {departments.map((d) => (
                                <Tag key={d.department_id}>{d.departments?.name ?? d.department_id}</Tag>
                            ))}
                        </div>
                    )}
                </Space>
            </Card>

            {/* Status banner */}
            {isSubmittedAwaitingReview && (
                <Card size="small" style={{ background: token.colorInfoBg, borderColor: token.colorInfoBorder }}>
                    <Typography.Text>
                        <strong>Submitted — awaiting HR review.</strong> You'll be notified once HR reviews your contract.
                    </Typography.Text>
                </Card>
            )}
            {isApproved && (
                <Card size="small" style={{ background: token.colorSuccessBg, borderColor: token.colorSuccessBorder }}>
                    <Typography.Text>
                        <strong>Approved.</strong> Your onboarding is complete.
                    </Typography.Text>
                </Card>
            )}
            {isResubmitMode && (
                <Card size="small" style={{ background: token.colorWarningBg, borderColor: token.colorWarningBorder }}>
                    <Typography.Text>
                        <strong>HR has requested changes.</strong> Please review the comments below, update your contract, re-sign, and resubmit.
                    </Typography.Text>
                </Card>
            )}

            {/* Secondary HR comments panel — only shown when there's no signature card to house them (submitted / approved states) */}
            {!formSubmittable && hrComments.length > 0 && (
                <Card size="small" title={<><MessageOutlined style={{ marginRight: token.marginXXS }} />HR Comments ({hrComments.length})</>}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
                        {hrComments.map((c) => (
                            <div
                                key={c.id}
                                style={{
                                    background: token.colorFillQuaternary,
                                    border: `1px solid ${token.colorBorderSecondary}`,
                                    borderRadius: token.borderRadiusSM,
                                    padding: token.paddingSM,
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                                    <Typography.Text strong style={{ fontSize: token.fontSizeSM }}>HR</Typography.Text>
                                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                        {formatCommentTime(c.created_at)}
                                    </Typography.Text>
                                </div>
                                <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: token.fontSizeSM }}>
                                    {c.body}
                                </Typography.Paragraph>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {!formSubmittable ? (
                <div style={{ flex: 1 }} />
            ) : (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: token.marginMD, overflow: 'hidden' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <App_ContractFiller
                        layout={layout}
                        fieldValues={mergedValues}
                        onChange={handleFieldChange}
                        columns={qColumns.columns}
                        choices={qChoices.choices}
                        mandatoryKeys={mandatoryKeys}
                    />
                </div>

                <Card
                    size="small"
                    style={{ width: 520, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}
                    styles={{ body: { padding: token.paddingSM, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' } }}
                >
                    <App_SignaturePad value={signature} onChange={setSignature} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: token.marginMD }}>
                        <Button
                            type="primary"
                            size="large"
                            loading={mSubmit.mutation.isPending}
                            onClick={handleSubmit}
                        >
                            {isResubmitMode ? 'Resubmit contract' : 'Submit contract'}
                        </Button>
                    </div>

                    {hrComments.length > 0 && (
                        <>
                            {/* Separator between signature + submit and the HR comment thread */}
                            <div style={{
                                marginTop: token.marginMD,
                                marginBottom: token.marginSM,
                                borderTop: `1px solid ${token.colorBorderSecondary}`,
                            }} />
                            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, marginBottom: token.marginXS }}>
                                <MessageOutlined style={{ marginRight: token.marginXXS }} />
                                HR Comments ({hrComments.length})
                            </Typography.Text>
                            {/* Scrollable comments region — fills remaining card height */}
                            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: token.marginXS, marginTop: token.marginXS }}>
                                {hrComments.map((c) => (
                                    <div
                                        key={c.id}
                                        style={{
                                            background: token.colorFillQuaternary,
                                            border: `1px solid ${token.colorBorderSecondary}`,
                                            borderRadius: token.borderRadiusSM,
                                            padding: token.paddingXS,
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                                            <Typography.Text strong style={{ fontSize: token.fontSizeSM }}>HR</Typography.Text>
                                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                                {formatCommentTime(c.created_at)}
                                            </Typography.Text>
                                        </div>
                                        <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: token.fontSizeSM }}>
                                            {c.body}
                                        </Typography.Paragraph>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </Card>
            </div>
            )}
        </div>
    )
}
