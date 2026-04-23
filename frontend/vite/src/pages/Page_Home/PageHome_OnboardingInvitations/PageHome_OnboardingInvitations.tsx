import { Link } from '@tanstack/react-router'
import { Button, Typography, Tag, theme } from 'antd'
import { FileSignatureIcon } from 'lucide-react'
import type { Tables_MyOnboardingInvitations_QueryData } from '@/hooks/useQ_Tables_MyOnboardingInvitations'

type Props = {
    invitations: Tables_MyOnboardingInvitations_QueryData
}

type Invitation = Tables_MyOnboardingInvitations_QueryData[number]

type RowState =
    | { kind: 'fill'; buttonLabel: string; tag?: { text: string; color?: string } }
    | { kind: 'resubmit'; buttonLabel: string; tag: { text: string; color?: string } }
    | { kind: 'awaiting'; tag: { text: string; color?: string } }
    | { kind: 'done'; tag: { text: string; color?: string } }

// invitation.status carries the "whose turn is it" signal:
//   sent + no contract   → first fill
//   sent + contract=sent → HR sent back for changes (resubmit)
//   accepted             → employee done; HR reviewing
const resolveRowState = (invitation: Invitation): RowState => {
    const contract = invitation.contracts?.[0] ?? null
    if (invitation.status === 'sent') {
        if (contract?.status === 'sent') {
            return { kind: 'resubmit', buttonLabel: 'Resubmit', tag: { text: 'Changes requested', color: 'warning' } }
        }
        return { kind: 'fill', buttonLabel: 'Fill Contract' }
    }
    // invitation.status === 'accepted'
    if (contract?.status === 'filled') {
        return { kind: 'awaiting', tag: { text: 'Awaiting HR review', color: 'processing' } }
    }
    if (contract?.status === 'active') {
        return { kind: 'done', tag: { text: 'Approved', color: 'success' } }
    }
    return { kind: 'awaiting', tag: { text: 'Submitted' } }
}

// Hide fully-done invitations from the "pending" list
const isPending = (invitation: Invitation): boolean => {
    const state = resolveRowState(invitation)
    return state.kind !== 'done'
}

export const PageHome_OnboardingInvitations = ({ invitations }: Props) => {
    const { token } = theme.useToken()

    const visible = invitations.filter(isPending)
    if (visible.length === 0) return null

    return (
        <div style={{ marginTop: token.marginXL }}>
            <Typography.Title level={4} style={{ margin: 0, marginBottom: token.marginSM }}>
                Pending Invitations
            </Typography.Title>
            <div style={{
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusLG,
                overflow: 'hidden',
                background: token.colorBgContainer,
            }}>
                {visible.map((inv, i) => (
                    <PageHome_OnboardingInvitations_Row
                        key={inv.id}
                        invitation={inv}
                        isLast={i === visible.length - 1}
                    />
                ))}
            </div>
        </div>
    )
}

function PageHome_OnboardingInvitations_Row({
    invitation,
    isLast,
}: {
    invitation: Invitation
    isLast: boolean
}) {
    const { token } = theme.useToken()
    const state = resolveRowState(invitation)
    const showButton = state.kind === 'fill' || state.kind === 'resubmit'
    const buttonLabel = showButton ? state.buttonLabel : null

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: isLast ? 'none' : `1px solid ${token.colorBorderSecondary}`,
                gap: token.marginSM,
            }}
        >
            <div style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: token.borderRadiusSM,
                background: token.colorPrimaryBg,
            }}>
                <FileSignatureIcon size={18} color={token.colorPrimary} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text strong ellipsis style={{ display: 'block', fontSize: 14 }}>
                    {invitation.organizations?.name ?? 'Organization'}
                </Typography.Text>
                <Typography.Text type="secondary" ellipsis style={{ display: 'block', fontSize: 12 }}>
                    {invitation.contract_templates?.name ?? 'Contract'} · {invitation.entities?.name ?? ''}
                </Typography.Text>
            </div>

            {state.tag && (
                <Tag color={state.tag.color} style={{ flexShrink: 0 }}>
                    {state.tag.text}
                </Tag>
            )}

            {showButton && buttonLabel && (
                <Link
                    to="/onboarding/$invitationToken"
                    params={{ invitationToken: invitation.invitation_token }}
                    style={{ flexShrink: 0 }}
                >
                    <Button type="primary" size="small">
                        {buttonLabel}
                    </Button>
                </Link>
            )}
        </div>
    )
}
