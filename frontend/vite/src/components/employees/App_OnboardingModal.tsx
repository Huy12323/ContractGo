import { useMemo, useState } from 'react'
import { App, Modal, Tabs, List, Typography, Button, Tag, Empty, Badge, theme } from 'antd'
import { UserAddOutlined, FileTextOutlined, BankOutlined, TeamOutlined, MailOutlined, ClockCircleOutlined, CheckCircleOutlined, DeleteOutlined } from '@ant-design/icons'
import { useQ_Tables_OrgOnboardingInvitations, type Tables_OrgOnboardingInvitations_QueryData } from '@/hooks/useQ_Tables_OrgOnboardingInvitations'
import { useM_OnboardingInvitation_Delete } from '@/hooks/useM_OnboardingInvitation_Delete'
import { App_OnboardingWizardModal } from './App_OnboardingWizardModal'
import { App_OnboardingReviewModal } from './App_OnboardingReviewModal'
import { App_ContractTemplatesManagerModal } from './App_ContractTemplatesManagerModal'

type Props = {
    open: boolean
    onClose: () => void
    organizationId: string
}

type Invitation = Tables_OrgOnboardingInvitations_QueryData[number]

const formatRelativeTime = (iso: string | null) => {
    if (!iso) return ''
    const then = new Date(iso).getTime()
    const now = Date.now()
    const diff = Math.max(0, now - then)
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return new Date(iso).toLocaleDateString()
}

const getDepartmentNames = (inv: Invitation): string[] => {
    const links = inv.rel__department__invitation ?? []
    return links
        .map((l) => l.departments?.name)
        .filter((n): n is string => !!n)
}

const getActiveContractId = (inv: Invitation): string | null => {
    const contracts = inv.contracts ?? []
    if (contracts.length === 0) return null
    // Pick the latest filled / active contract — there is normally one per invitation
    return contracts[0]?.id ?? null
}

const STATUS_TAG: Record<string, { color: string; label: string }> = {
    sent: { color: 'blue', label: 'Sent' },
    accepted: { color: 'orange', label: 'Needs Approval' },
    approved: { color: 'green', label: 'Active' },
    expired: { color: 'default', label: 'Expired' },
    revoked: { color: 'default', label: 'Revoked' },
}

export const App_OnboardingModal = ({ open, onClose, organizationId }: Props) => {
    const { token } = theme.useToken()
    const { modal } = App.useApp()

    const [wizardOpen, setWizardOpen] = useState(false)
    const [templatesManagerOpen, setTemplatesManagerOpen] = useState(false)
    const [reviewContractId, setReviewContractId] = useState<string | null>(null)

    const qInvitations = useQ_Tables_OrgOnboardingInvitations({ organizationId })
    const mDelete = useM_OnboardingInvitation_Delete()

    const handleDelete = (inv: Invitation) => {
        modal.confirm({
            title: 'Delete invitation?',
            content: `This will permanently delete the invitation sent to ${inv.employee_email}. The employee will no longer be able to use the link. This cannot be undone.`,
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: () => mDelete.mutation.mutateAsync({ invitation_id: inv.id }),
        })
    }

    const { sentList, needsApprovalList, activeList } = useMemo(() => {
        const sent: Invitation[] = []
        const needsApproval: Invitation[] = []
        const active: Invitation[] = []
        for (const inv of qInvitations.invitations) {
            if (inv.status === 'sent') sent.push(inv)
            else if (inv.status === 'accepted') needsApproval.push(inv)
            else if (inv.status === 'approved') active.push(inv)
        }
        return { sentList: sent, needsApprovalList: needsApproval, activeList: active }
    }, [qInvitations.invitations])

    const renderRowMeta = (inv: Invitation, extra: React.ReactNode) => {
        const depts = getDepartmentNames(inv)
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: token.marginSM, flexWrap: 'wrap' }}>
                    <Typography.Text strong>{inv.contract_templates?.name ?? '—'}</Typography.Text>
                    <Typography.Text type="secondary">
                        <MailOutlined style={{ marginRight: 4 }} />
                        {inv.employee_email}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                        <BankOutlined style={{ marginRight: 4 }} />
                        {inv.entities?.name ?? '—'}
                    </Typography.Text>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS, flexWrap: 'wrap' }}>
                    {depts.length > 0 ? (
                        depts.map((name) => (
                            <Tag key={name} icon={<TeamOutlined />} color="default">
                                {name}
                            </Tag>
                        ))
                    ) : (
                        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            No departments
                        </Typography.Text>
                    )}
                    {extra}
                </div>
            </div>
        )
    }

    const renderEmpty = (description: string) => (
        <Empty
            description={description}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ paddingBlock: token.paddingXL }}
        />
    )

    const renderNeedsApproval = () => {
        if (qInvitations.query.isLoading) return <Typography.Text type="secondary">Loading…</Typography.Text>
        if (needsApprovalList.length === 0) return renderEmpty('No contracts awaiting approval')
        return (
            <List
                bordered
                dataSource={needsApprovalList}
                renderItem={(inv) => {
                    const contractId = getActiveContractId(inv)
                    const contract = inv.contracts?.[0]
                    return (
                        <List.Item
                            style={{ cursor: contractId ? 'pointer' : 'default' }}
                            onClick={() => contractId && setReviewContractId(contractId)}
                            actions={[
                                <Button
                                    key="review"
                                    type="primary"
                                    size="small"
                                    disabled={!contractId}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        if (contractId) setReviewContractId(contractId)
                                    }}
                                >
                                    Review
                                </Button>,
                            ]}
                        >
                            {renderRowMeta(
                                inv,
                                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                    <ClockCircleOutlined style={{ marginRight: 4 }} />
                                    Filled {formatRelativeTime(contract?.signed_at ?? null)}
                                </Typography.Text>,
                            )}
                        </List.Item>
                    )
                }}
            />
        )
    }

    const renderSent = () => {
        if (qInvitations.query.isLoading) return <Typography.Text type="secondary">Loading…</Typography.Text>
        if (sentList.length === 0) return renderEmpty('No invitations awaiting employee response')
        return (
            <List
                bordered
                dataSource={sentList}
                renderItem={(inv) => (
                    <List.Item
                        actions={[
                            <Button
                                key="delete"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                loading={mDelete.mutation.isPending}
                                onClick={() => handleDelete(inv)}
                            >
                                Delete
                            </Button>,
                        ]}
                    >
                        {renderRowMeta(
                            inv,
                            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                <ClockCircleOutlined style={{ marginRight: 4 }} />
                                Sent {formatRelativeTime(inv.created_at)} · awaiting employee
                            </Typography.Text>,
                        )}
                    </List.Item>
                )}
            />
        )
    }

    const renderAll = () => {
        if (qInvitations.query.isLoading) return <Typography.Text type="secondary">Loading…</Typography.Text>
        if (qInvitations.invitations.length === 0) return renderEmpty('No invitations yet')
        return (
            <List
                bordered
                dataSource={qInvitations.invitations}
                renderItem={(inv) => {
                    const statusMeta = STATUS_TAG[inv.status] ?? { color: 'default', label: inv.status }
                    const contract = inv.contracts?.[0]
                    const contractId = getActiveContractId(inv)
                    const actions: React.ReactNode[] = []

                    if (inv.status === 'sent') {
                        actions.push(
                            <Button
                                key="delete"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                loading={mDelete.mutation.isPending}
                                onClick={() => handleDelete(inv)}
                            >
                                Delete
                            </Button>,
                        )
                    } else if (inv.status === 'accepted' && contractId) {
                        actions.push(
                            <Button
                                key="review"
                                type="primary"
                                size="small"
                                onClick={() => setReviewContractId(contractId)}
                            >
                                Review
                            </Button>,
                        )
                    }

                    return (
                        <List.Item actions={actions}>
                            {renderRowMeta(
                                inv,
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXS }}>
                                    <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
                                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                        {inv.status === 'approved' ? (
                                            <>
                                                <CheckCircleOutlined style={{ color: token.colorSuccess, marginRight: 4 }} />
                                                Approved {formatRelativeTime(contract?.approved_at ?? null)}
                                            </>
                                        ) : inv.status === 'accepted' ? (
                                            <>
                                                <ClockCircleOutlined style={{ marginRight: 4 }} />
                                                Filled {formatRelativeTime(contract?.signed_at ?? null)}
                                            </>
                                        ) : (
                                            <>
                                                <ClockCircleOutlined style={{ marginRight: 4 }} />
                                                Sent {formatRelativeTime(inv.created_at)}
                                            </>
                                        )}
                                    </Typography.Text>
                                </span>,
                            )}
                        </List.Item>
                    )
                }}
            />
        )
    }

    const renderActive = () => {
        if (qInvitations.query.isLoading) return <Typography.Text type="secondary">Loading…</Typography.Text>
        if (activeList.length === 0) return renderEmpty('No active onboardings yet')
        return (
            <List
                bordered
                dataSource={activeList}
                renderItem={(inv) => {
                    const contract = inv.contracts?.[0]
                    return (
                        <List.Item>
                            {renderRowMeta(
                                inv,
                                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                    <CheckCircleOutlined style={{ color: token.colorSuccess, marginRight: 4 }} />
                                    Approved {formatRelativeTime(contract?.approved_at ?? null)}
                                </Typography.Text>,
                            )}
                        </List.Item>
                    )
                }}
            />
        )
    }

    const tabItems = [
        {
            key: 'needsApproval',
            label: (
                <span>
                    Needs Approval{' '}
                    <Badge count={needsApprovalList.length} showZero={false} style={{ marginLeft: token.marginXXS }} />
                </span>
            ),
            children: renderNeedsApproval(),
        },
        {
            key: 'sent',
            label: (
                <span>
                    Sent{' '}
                    <Badge count={sentList.length} showZero={false} color={token.colorPrimary} style={{ marginLeft: token.marginXXS }} />
                </span>
            ),
            children: renderSent(),
        },
        {
            key: 'active',
            label: (
                <span>
                    Active{' '}
                    <Badge count={activeList.length} showZero={false} color={token.colorSuccess} style={{ marginLeft: token.marginXXS }} />
                </span>
            ),
            children: renderActive(),
        },
        {
            key: 'all',
            label: (
                <span>
                    All{' '}
                    <Badge count={qInvitations.invitations.length} showZero={false} color="default" style={{ marginLeft: token.marginXXS }} />
                </span>
            ),
            children: renderAll(),
        },
    ]

    return (
        <>
            <Modal
                open={open}
                onCancel={onClose}
                title={
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: token.marginXL }}>
                        <span>
                            <FileTextOutlined style={{ marginRight: token.marginXS }} />
                            Onboarding
                        </span>
                        <div style={{ display: 'flex', gap: token.marginXS }}>
                            <Button
                                icon={<FileTextOutlined />}
                                onClick={() => setTemplatesManagerOpen(true)}
                            >
                                Manage Templates
                            </Button>
                            <Button
                                type="primary"
                                icon={<UserAddOutlined />}
                                onClick={() => setWizardOpen(true)}
                            >
                                Onboard Employee
                            </Button>
                        </div>
                    </div>
                }
                width="80vw"
                footer={null}
                destroyOnHidden
                styles={{ body: { height: '70vh', overflow: 'auto' } }}
            >
                <Tabs
                    defaultActiveKey="needsApproval"
                    items={tabItems}
                />
            </Modal>

            <App_OnboardingWizardModal
                open={wizardOpen}
                onClose={() => setWizardOpen(false)}
                organizationId={organizationId}
            />

            <App_ContractTemplatesManagerModal
                open={templatesManagerOpen}
                onClose={() => setTemplatesManagerOpen(false)}
                organizationId={organizationId}
            />

            <App_OnboardingReviewModal
                open={!!reviewContractId}
                onClose={() => setReviewContractId(null)}
                contractId={reviewContractId}
                organizationId={organizationId}
            />
        </>
    )
}
