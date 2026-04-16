import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button, Card, Spin, Typography, theme, App, Space, Tag } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, SwapOutlined } from '@ant-design/icons'
import type { JSONContent } from '@tiptap/core'
import { App_ContractFiller } from '@/components/employees/App_ContractFiller'
import { App_SignaturePad } from '@/components/employees/App_SignaturePad'
import { useQ_PageOnboardingFiller_InvitationByToken } from '@/hooks/useQ_PageOnboardingFiller_InvitationByToken'
import { useQ_PageOnboardingFiller_InvitationPreview } from '@/hooks/useQ_PageOnboardingFiller_InvitationPreview'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useM_Onboarding_SubmitContract } from '@/hooks/useM_Onboarding_SubmitContract'
import { useQ_Me } from '@/hooks/useQ_Me'
import { Store_Auth_Actions } from '@/stores/Store_Auth'

const extractFieldKeys = (content: JSONContent): string[] => {
    const keys: string[] = []
    const walk = (node: JSONContent) => {
        if (node.type === 'fieldInput' && node.attrs?.fieldKey) {
            keys.push(node.attrs.fieldKey as string)
        }
        if (node.content) node.content.forEach(walk)
    }
    walk(content)
    return keys
}

const hasMeaningfulValue = (v: unknown) =>
    v !== undefined && v !== null && v !== ''

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
    const layout = useMemo(
        () => (template?.layout ?? { type: 'doc', content: [] }) as JSONContent,
        [template?.layout],
    )

    const qColumns = useQ_Tables_EmployeeColumns({ organizationId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ organizationId })

    const prefilled = useMemo(
        () => (invitation?.prefilled_fields ?? {}) as Record<string, unknown>,
        [invitation?.prefilled_fields],
    )

    // Only lock keys whose prefilled value is actually non-empty.
    // HR wizard (AHR-495) may submit empty strings for skipped fields; those should remain editable.
    const readOnlyKeys = useMemo(
        () => new Set(
            Object.entries(prefilled)
                .filter(([, v]) => hasMeaningfulValue(v))
                .map(([k]) => k),
        ),
        [prefilled],
    )

    const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({})
    const [signature, setSignature] = useState<string | null>(null)
    const [signingOut, setSigningOut] = useState(false)
    const mSubmit = useM_Onboarding_SubmitContract()

    // Merge prefilled values into field state (prefilled acts as default; employee input overrides unless locked)
    const mergedValues = useMemo(() => {
        const merged: Record<string, unknown> = { ...fieldValues }
        for (const [k, v] of Object.entries(prefilled)) {
            if (hasMeaningfulValue(v)) merged[k] = v
        }
        return merged
    }, [prefilled, fieldValues])

    const handleFieldChange = (key: string, value: unknown) => {
        if (readOnlyKeys.has(key)) return
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

        const requiredKeys = extractFieldKeys(layout).filter((k) => !readOnlyKeys.has(k))
        const missing = requiredKeys.filter((k) => !hasMeaningfulValue(mergedValues[k]))
        if (missing.length > 0) {
            message.error(`Please fill ${missing.length} remaining field${missing.length > 1 ? 's' : ''} before submitting`)
            return
        }

        try {
            await mSubmit.mutation.mutateAsync({
                invitation_token: invitation.invitation_token,
                field_values: mergedValues,
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

            <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: token.marginMD, overflow: 'hidden' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <App_ContractFiller
                        layout={layout}
                        fieldValues={mergedValues}
                        onChange={handleFieldChange}
                        columns={qColumns.columns}
                        choices={qChoices.choices}
                        readOnlyKeys={readOnlyKeys}
                    />
                </div>

                <Card size="small" style={{ width: 520, flexShrink: 0 }} styles={{ body: { padding: token.paddingSM } }}>
                    <App_SignaturePad value={signature} onChange={setSignature} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: token.marginMD }}>
                        <Button
                            type="primary"
                            size="large"
                            loading={mSubmit.mutation.isPending}
                            onClick={handleSubmit}
                        >
                            Submit contract
                        </Button>
                    </div>
                </Card>
            </div>
        </div>
    )
}
