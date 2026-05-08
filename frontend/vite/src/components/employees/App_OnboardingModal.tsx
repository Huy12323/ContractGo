import { useMemo, useState } from 'react'
import { App, Modal, Tabs, List, Typography, Button, Input, Tag, Empty, Badge, theme } from 'antd'
import { UserAddOutlined, FileTextOutlined, BankOutlined, TeamOutlined, MailOutlined, ClockCircleOutlined, CheckCircleOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons'
import { useQ_Tables_OrgOnboardingInvitations, type Tables_OrgOnboardingInvitations_QueryData } from '@/hooks/useQ_Tables_OrgOnboardingInvitations'
import { useM_OnboardingInvitation_Delete } from '@/hooks/useM_OnboardingInvitation_Delete'
import { App_OnboardingWizardModal } from './App_OnboardingWizardModal'
import { App_OnboardingReviewModal } from './App_OnboardingReviewModal'
import { App_OnboardingInvitationPreviewModal } from './App_OnboardingInvitationPreviewModal'
import { App_ContractTemplatesManagerModal } from './App_ContractTemplatesManagerModal'

type Props = {
    open: boolean
    onClose: () => void
    organizationId: string
    entityId: string
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

export const App_OnboardingModal = ({ open, onClose, organizationId, entityId }: Props) => {
    const { token } = theme.useToken()
    const { modal } = App.useApp()

    const [wizardOpen, setWizardOpen] = useState(false)
    const [templatesManagerOpen, setTemplatesManagerOpen] = useState(false)
    const [reviewContractId, setReviewContractId] = useState<string | null>(null)
    const [previewInvitation, setPreviewInvitation] = useState<Invitation | null>(null)
    // Shared search across tabs — preserved when switching tabs for continuity.
    const [search, setSearch] = useState('')

    const filterInvitations = (list: Invitation[], term: string) => {
        const q = term.trim().toLowerCase()
        if (!q) return list
        return list.filter((inv) => {
            if (inv.employee_email.toLowerCase().includes(q)) return true
            if (inv.contract_templates?.name?.toLowerCase().includes(q)) return true
            if (inv.entities?.name?.toLowerCase().includes(q)) return true
            return getDepartmentNames(inv).some((d) => d.toLowerCase().includes(q))
        })
    }

    // Search input rendered at the top of each tab's content. State is shared so
    // typing carries across tab switches.
    const searchBar = (
        <Input
            placeholder="Search by email, contract, entity, or department"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            allowClear
            style={{ marginBottom: token.marginSM }}
        />
    )

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
        const filtered = filterInvitations(needsApprovalList, search)
        return (
            <>
            {searchBar}
            {filtered.length === 0 ? renderEmpty(`No results for "${search}"`) : (
            <List
                bordered
                dataSource={filtered}
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
            )}
            </>
        )
    }

    const renderSent = () => {
        if (qInvitations.query.isLoading) return <Typography.Text type="secondary">Loading…</Typography.Text>
        if (sentList.length === 0) return renderEmpty('No invitations awaiting employee response')
        const filtered = filterInvitations(sentList, search)
        return (
            <>
            {searchBar}
            {filtered.length === 0 ? renderEmpty(`No results for "${search}"`) : (
            <List
                bordered
                dataSource={filtered}
                renderItem={(inv) => (
                    <List.Item
                        style={{ cursor: 'pointer' }}
                        onClick={() => setPreviewInvitation(inv)}
                        actions={[
                            <Button
                                key="delete"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                loading={mDelete.mutation.isPending}
                                onClick={(e) => { e.stopPropagation(); handleDelete(inv) }}
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
            )}
            </>
        )
    }

    const renderAll = () => {
        if (qInvitations.query.isLoading) return <Typography.Text type="secondary">Loading…</Typography.Text>
        if (qInvitations.invitations.length === 0) return renderEmpty('No invitations yet')
        const filtered = filterInvitations(qInvitations.invitations, search)
        return (
            <>
            {searchBar}
            {filtered.length === 0 ? renderEmpty(`No results for "${search}"`) : (
            <List
                bordered
                dataSource={filtered}
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
                                onClick={(e) => { e.stopPropagation(); handleDelete(inv) }}
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
                                onClick={(e) => { e.stopPropagation(); setReviewContractId(contractId) }}
                            >
                                Review
                            </Button>,
                        )
                    }

                    // Rows are clickable when there's something to preview:
                    //   sent     → invitation preview modal (no contract yet)
                    //   accepted → review modal (contract pending HR approval)
                    //   approved → review modal in view-only mode (actions hidden)
                    const handleRowClick =
                        inv.status === 'sent'
                            ? () => setPreviewInvitation(inv)
                            : (inv.status === 'accepted' || inv.status === 'approved') && contractId
                              ? () => setReviewContractId(contractId)
                              : undefined

                    return (
                        <List.Item
                            style={{ cursor: handleRowClick ? 'pointer' : 'default' }}
                            onClick={handleRowClick}
                            actions={actions}
                        >
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
            )}
            </>
        )
    }

    const renderActive = () => {
        if (qInvitations.query.isLoading) return <Typography.Text type="secondary">Loading…</Typography.Text>
        if (activeList.length === 0) return renderEmpty('No active onboardings yet')
        const filtered = filterInvitations(activeList, search)
        return (
            <>
            {searchBar}
            {filtered.length === 0 ? renderEmpty(`No results for "${search}"`) : (
            <List
                bordered
                dataSource={filtered}
                renderItem={(inv) => {
                    const contract = inv.contracts?.[0]
                    const contractId = getActiveContractId(inv)
                    return (
                        <List.Item
                            style={{ cursor: contractId ? 'pointer' : 'default' }}
                            onClick={() => contractId && setReviewContractId(contractId)}
                        >
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
            )}
            </>
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
                entityId={entityId}
            />

            <App_OnboardingReviewModal
                open={!!reviewContractId}
                onClose={() => setReviewContractId(null)}
                contractId={reviewContractId}
                organizationId={organizationId}
            />

            <App_OnboardingInvitationPreviewModal
                open={!!previewInvitation}
                onClose={() => setPreviewInvitation(null)}
                invitation={previewInvitation}
                organizationId={organizationId}
            />
        </>
    )
}
