import { Link } from '@tanstack/react-router'
import { Button, Typography, theme } from 'antd'
import { FileSignatureIcon } from 'lucide-react'
import type { Tables_MyOnboardingInvitations_QueryData } from '@/hooks/useQ_Tables_MyOnboardingInvitations'

type Props = {
    invitations: Tables_MyOnboardingInvitations_QueryData
}

export const PageHome_OnboardingInvitations = ({ invitations }: Props) => {
    const { token } = theme.useToken()

    if (invitations.length === 0) return null

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
                {invitations.map((inv, i) => (
                    <PageHome_OnboardingInvitations_Row
                        key={inv.id}
                        invitation={inv}
                        isLast={i === invitations.length - 1}
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
    invitation: Tables_MyOnboardingInvitations_QueryData[number]
    isLast: boolean
}) {
    const { token } = theme.useToken()

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

            <Link
                to="/onboarding/$invitationToken"
                params={{ invitationToken: invitation.invitation_token }}
                style={{ flexShrink: 0 }}
            >
                <Button type="primary" size="small">
                    Fill Contract
                </Button>
            </Link>
        </div>
    )
}
