import { useEffect, useMemo, useState } from 'react'
import { Modal, Input, Button, Typography, Tag, Spin, theme, Empty } from 'antd'
import { CheckCircleOutlined, MailOutlined, BankOutlined, TeamOutlined, EditOutlined, MessageOutlined, SendOutlined, CloseOutlined } from '@ant-design/icons'
import type { JSONContent } from '@tiptap/core'
import { supabase } from '@/configs/supabase/config'
import { useQ_Tables_Contract } from '@/hooks/useQ_Tables_Contract'
import { useQ_Tables_OrgOnboardingInvitations } from '@/hooks/useQ_Tables_OrgOnboardingInvitations'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useM_Contract_ApproveContent } from '@/hooks/useM_Contract_ApproveContent'
import { useM_Contract_RequestChanges } from '@/hooks/useM_Contract_RequestChanges'
import { App_ContractFiller } from './App_ContractFiller'
import type { OnboardingInvitation_HrComments } from '@/types/invitation.types'

type Props = {
    open: boolean
    onClose: () => void
    contractId: string | null
    organizationId: string
}

const formatCommentTime = (iso: string): string => {
    try { return new Date(iso).toLocaleString() } catch { return iso }
}

export const App_OnboardingReviewModal = ({ open, onClose, contractId, organizationId }: Props) => {
    const { token } = theme.useToken()

    const qContract = useQ_Tables_Contract({ contractId })
    const qInvitations = useQ_Tables_OrgOnboardingInvitations({ organizationId })
    const qColumns = useQ_Tables_EmployeeColumns({ organizationId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ organizationId })
    const mApproveContent = useM_Contract_ApproveContent()
    const mRequestChanges = useM_Contract_RequestChanges()

    const [signedUrl, setSignedUrl] = useState<string | null>(null)
    const [signedUrlError, setSignedUrlError] = useState<string | null>(null)
    const [composerOpen, setComposerOpen] = useState(false)
    const [commentBody, setCommentBody] = useState('')

    // Locate the matching invitation row from the cached org list (avoids extra query)
    const invitation = useMemo(() => {
        if (!qContract.contract) return null
        return (
            qInvitations.invitations.find((inv) => inv.id === qContract.contract!.invitation_id) ?? null
        )
    }, [qContract.contract, qInvitations.invitations])

    const hrComments = useMemo<OnboardingInvitation_HrComments>(
        () => (invitation?.hr_comments as OnboardingInvitation_HrComments | undefined) ?? [],
        [invitation?.hr_comments],
    )

    const departments = useMemo(() => {
        if (!invitation) return []
        return (invitation.rel__department__invitation ?? [])
            .map((l) => l.departments?.name)
            .filter((n): n is string => !!n)
    }, [invitation])

    const prefilledValues = useMemo(
        () => (qContract.contract?.prefilled_fields as Record<string, unknown>) ?? {},
        [qContract.contract?.prefilled_fields],
    )

    const filledValues = useMemo(
        () => (qContract.contract?.field_values as Record<string, unknown>) ?? {},
        [qContract.contract?.field_values],
    )

    const mergedValues = useMemo(
        () => ({ ...prefilledValues, ...filledValues }),
        [prefilledValues, filledValues],
    )

    const snapshotKeys = useMemo(() => {
        const snap = (invitation?.template_snapshot ?? {}) as {
            mandatory_field_keys?: string[]
            hr_field_keys?: string[]
            attachment_field_keys?: string[]
        }
        return {
            mandatoryKeys: snap.mandatory_field_keys ?? [],
            hrFieldKeys: snap.hr_field_keys ?? [],
            // `undefined` when absent (legacy snapshots) → App_ContractFiller falls
            // back to layout extraction.
            attachmentFieldKeys: snap.attachment_field_keys
                ? (snap.attachment_field_keys as string[])
                : undefined,
        }
    }, [invitation?.template_snapshot])

    // Resolve signed URL for the signature image
    useEffect(() => {
        let cancelled = false
        setSignedUrl(null)
        setSignedUrlError(null)
        const path = qContract.contract?.signature_path
        const cid = qContract.contract?.id
        if (!open || !path || !cid) return

        ;(async () => {
            const sb_FunctionsFilesR2SignReadUrl_Invoke = await supabase.functions.invoke(
                'files_r2_sign-read-url',
                { body: { resource_type: 'contract_signature', contract_id: cid } },
            )
            if (cancelled) return
            if (sb_FunctionsFilesR2SignReadUrl_Invoke.error) {
                console.error(sb_FunctionsFilesR2SignReadUrl_Invoke.error)
                setSignedUrlError('Failed to load signature')
                return
            }
            const { url } = sb_FunctionsFilesR2SignReadUrl_Invoke.data as { url: string }
            setSignedUrl(url)
        })()

        return () => {
            cancelled = true
        }
    }, [open, qContract.contract?.signature_path, qContract.contract?.id])

    // Reset composer whenever the modal opens (or contract changes)
    useEffect(() => {
        if (open) {
            setComposerOpen(false)
            setCommentBody('')
        }
    }, [open, contractId])

    const handleApproveContent = () => {
        if (!invitation) return
        mApproveContent.mutation.mutate(
            { invitation_id: invitation.id },
            { onSuccess: onClose },
        )
    }

    const handleSendChanges = () => {
        if (!invitation) return
        const trimmed = commentBody.trim()
        if (!trimmed) return
        mRequestChanges.mutation.mutate(
            { invitation_id: invitation.id, comment_body: trimmed },
            { onSuccess: onClose },
        )
    }

    const handleCancelComposer = () => {
        setComposerOpen(false)
        setCommentBody('')
    }

    const isLoading = qContract.query.isLoading || qInvitations.query.isLoading
    const isActionPending = mApproveContent.mutation.isPending || mRequestChanges.mutation.isPending
    // Approve / Request-Changes only make sense while the contract is pending HR review.
    // Once it's 'active' (approved), show the same view but hide the action buttons so
    // the modal doubles as a read-only "view past contract" surface.
    const isPendingReview = qContract.contract?.status === 'filled'

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={
                <span>
                    <EditOutlined style={{ marginRight: token.marginXS }} />
                    Review Contract
                </span>
            }
            width="85vw"
            footer={null}
            destroyOnHidden
            styles={{ body: { height: '78vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}
        >
            {isLoading || !qContract.contract ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Spin />
                </div>
            ) : (
                <>
                    {/* Header summary */}
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: token.marginSM,
                            paddingBottom: token.paddingSM,
                            borderBottom: `1px solid ${token.colorBorderSecondary}`,
                            marginBottom: token.marginSM,
                            flexShrink: 0,
                        }}
                    >
                        <Typography.Text>
                            <MailOutlined style={{ marginRight: 4 }} />
                            {invitation?.employee_email ?? '—'}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                            <BankOutlined style={{ marginRight: 4 }} />
                            {invitation?.entities?.name ?? '—'}
                        </Typography.Text>
                        {departments.length > 0 ? (
                            departments.map((name) => (
                                <Tag key={name} icon={<TeamOutlined />}>
                                    {name}
                                </Tag>
                            ))
                        ) : (
                            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                No departments
                            </Typography.Text>
                        )}
                    </div>

                    {/* Body: contract preview + sidebar */}
                    <div style={{ flex: 1, display: 'flex', gap: token.marginMD, minHeight: 0 }}>
                        {/* Left: per-field diff cards + contract preview via App_ContractFiller (review mode) */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <App_ContractFiller
                                mode="review"
                                layout={(qContract.contract.template_snapshot as JSONContent) ?? { type: 'doc', content: [] }}
                                fieldValues={mergedValues}
                                prefilledValues={prefilledValues}
                                onChange={() => {}}
                                columns={qColumns.columns}
                                choices={qChoices.choices}
                                mandatoryKeys={snapshotKeys.mandatoryKeys}
                                hrFieldKeys={snapshotKeys.hrFieldKeys}
                                attachmentFieldKeys={snapshotKeys.attachmentFieldKeys}
                                organization_id={qContract.contract.organization_id}
                                uploadContext={
                                    qContract.contract.invitation_id
                                        ? { kind: 'invitation_col', invitation_id: qContract.contract.invitation_id }
                                        : undefined
                                }
                            />
                        </div>

                        {/* Right: comments thread + signature + actions */}
                        <div
                            style={{
                                width: 340,
                                minWidth: 340,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: token.marginMD,
                                overflow: 'auto',
                            }}
                        >
                            {/* HR comment thread */}
                            <div>
                                <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXS }}>
                                    <MessageOutlined style={{ marginRight: token.marginXXS }} />
                                    HR Comments ({hrComments.length})
                                </Typography.Text>
                                {hrComments.length === 0 ? (
                                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                        No comments yet
                                    </Typography.Text>
                                ) : (
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
                                )}
                            </div>

                            {/* Signature */}
                            <div>
                                <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXS }}>
                                    Signature
                                </Typography.Text>
                                <div
                                    style={{
                                        background: token.colorBgContainer,
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        borderRadius: token.borderRadiusLG,
                                        padding: token.paddingSM,
                                        minHeight: 120,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    {signedUrlError ? (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={signedUrlError}
                                        />
                                    ) : signedUrl ? (
                                        <img
                                            src={signedUrl}
                                            alt="Signature"
                                            style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }}
                                        />
                                    ) : (
                                        <Spin size="small" />
                                    )}
                                </div>
                            </div>

                            {/* Actions — only for contracts pending HR review */}
                            {isPendingReview && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
                                <Typography.Text strong>Actions</Typography.Text>
                                {composerOpen ? (
                                    <>
                                        <Input.TextArea
                                            placeholder="Tell the employee what to change…"
                                            autoSize={{ minRows: 3, maxRows: 6 }}
                                            value={commentBody}
                                            onChange={(e) => setCommentBody(e.target.value)}
                                            disabled={isActionPending}
                                        />
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: token.marginXS }}>
                                            <Button
                                                icon={<CloseOutlined />}
                                                onClick={handleCancelComposer}
                                                disabled={isActionPending}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                type="primary"
                                                icon={<SendOutlined />}
                                                loading={mRequestChanges.mutation.isPending}
                                                disabled={!commentBody.trim()}
                                                onClick={handleSendChanges}
                                            >
                                                Send Back
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
                                        <Button
                                            type="primary"
                                            icon={<CheckCircleOutlined />}
                                            loading={mApproveContent.mutation.isPending}
                                            disabled={isActionPending}
                                            onClick={handleApproveContent}
                                            block
                                        >
                                            Approve Content
                                        </Button>
                                        <Button
                                            icon={<MessageOutlined />}
                                            disabled={isActionPending}
                                            onClick={() => setComposerOpen(true)}
                                            block
                                        >
                                            Request Changes
                                        </Button>
                                    </div>
                                )}
                            </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </Modal>
    )
}
