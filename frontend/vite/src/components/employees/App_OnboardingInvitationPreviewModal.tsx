import { useMemo } from 'react'
import { Modal, Spin, Typography, Tag, Descriptions, theme } from 'antd'
import { MailOutlined, MessageOutlined } from '@ant-design/icons'
import type { JSONContent } from '@tiptap/core'
import { App_ContractFiller } from './App_ContractFiller'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useQ_Tables_Contract } from '@/hooks/useQ_Tables_Contract'
import { useQ_Invitation_PdfReadUrl } from '@/hooks/useQ_Invitation_PdfReadUrl'
import type { PdfLayout } from '@/types/contractTemplate.types'
import type { OnboardingInvitation_HrComments } from '@/types/invitation.types'

type InvitationLike = {
    id: string
    employee_email: string
    status: string
    created_at: string | null
    organization_id: string
    organizations?: { name?: string | null } | null
    entities?: { name?: string | null } | null
    contract_templates?: { name?: string | null } | null
    template_snapshot?: unknown
    prefilled_fields?: unknown
    hr_comments?: unknown
    contracts?: Array<{ id: string; status: string }> | null
    rel__department__invitation?: Array<{ departments?: { name?: string | null } | null }> | null
}

type Props = {
    open: boolean
    onClose: () => void
    invitation: InvitationLike | null
    organizationId: string
}

const formatCommentTime = (iso: string): string => {
    try { return new Date(iso).toLocaleString() } catch { return iso }
}

export const App_OnboardingInvitationPreviewModal = ({ open, onClose, invitation, organizationId }: Props) => {
    const { token } = theme.useToken()
    const qColumns = useQ_Tables_EmployeeColumns({ organizationId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ organizationId })

    const linkedContractId = invitation?.contracts?.[0]?.id ?? null
    const qContract = useQ_Tables_Contract({ contractId: linkedContractId })

    const snapshot = useMemo(() => {
        const snap = (invitation?.template_snapshot ?? {}) as {
            type?: 'tiptap' | 'pdf'
            layout?: JSONContent | PdfLayout
            pdf_file_path?: string | null
            mandatory_field_keys?: string[]
            hr_field_keys?: string[]
            attachment_field_keys?: string[]
        }
        return snap
    }, [invitation?.template_snapshot])

    const kind: 'tiptap' | 'pdf' = snapshot.type === 'pdf' ? 'pdf' : 'tiptap'

    const qPdfReadUrl = useQ_Invitation_PdfReadUrl({
        invitationId: kind === 'pdf' ? (invitation?.id ?? null) : null,
        pdfFilePathKey: kind === 'pdf' ? (snapshot.pdf_file_path ?? null) : null,
    })

    const prefilledValues = useMemo(
        () => (invitation?.prefilled_fields ?? {}) as Record<string, unknown>,
        [invitation?.prefilled_fields],
    )

    const filledValues = useMemo(
        () => (qContract.contract?.field_values ?? {}) as Record<string, unknown>,
        [qContract.contract?.field_values],
    )

    const mergedValues = useMemo(
        () => ({ ...prefilledValues, ...filledValues }),
        [prefilledValues, filledValues],
    )

    const hrComments = useMemo<OnboardingInvitation_HrComments>(
        () => (invitation?.hr_comments as OnboardingInvitation_HrComments | undefined) ?? [],
        [invitation?.hr_comments],
    )

    const departments = useMemo(
        () =>
            (invitation?.rel__department__invitation ?? [])
                .map((r) => r.departments?.name)
                .filter((n): n is string => !!n),
        [invitation?.rel__department__invitation],
    )

    const fillerProps = {
        mode: 'review' as const,
        fieldValues: mergedValues,
        onChange: () => {},
        columns: qColumns.columns,
        choices: qChoices.choices,
        mandatoryKeys: snapshot.mandatory_field_keys ?? [],
        hrFieldKeys: snapshot.hr_field_keys ?? [],
        attachmentFieldKeys:
            snapshot.attachment_field_keys ? (snapshot.attachment_field_keys as string[]) : undefined,
        organization_id: organizationId,
        uploadContext: invitation
            ? ({ kind: 'invitation_col', invitation_id: invitation.id } as const)
            : undefined,
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={
                <span>
                    <MailOutlined style={{ marginRight: token.marginXS }} />
                    Invitation preview
                </span>
            }
            width="85vw"
            footer={null}
            destroyOnHidden
            styles={{ body: { height: '78vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: token.marginSM } }}
        >
            {!invitation ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Spin />
                </div>
            ) : (
                <>
                    <Descriptions size="small" column={2} colon={false}>
                        <Descriptions.Item label="Sent to">
                            <Typography.Text strong>{invitation.employee_email}</Typography.Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="Status">
                            <Tag color="blue">{invitation.status}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="Contract">
                            {invitation.contract_templates?.name ?? '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="Entity">
                            {invitation.entities?.name ?? '—'}
                        </Descriptions.Item>
                        {departments.length > 0 && (
                            <Descriptions.Item label="Departments" span={2}>
                                {departments.map((d) => (
                                    <Tag key={d}>{d}</Tag>
                                ))}
                            </Descriptions.Item>
                        )}
                    </Descriptions>

                    <div style={{ flex: 1, display: 'flex', gap: token.marginMD, minHeight: 0 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            {kind === 'pdf' ? (
                                <App_ContractFiller
                                    kind="pdf"
                                    layout={(snapshot.layout as PdfLayout) ?? []}
                                    pdfFileUrl={qPdfReadUrl.url ?? null}
                                    {...fillerProps}
                                />
                            ) : (
                                <App_ContractFiller
                                    layout={(snapshot.layout as JSONContent) ?? { type: 'doc', content: [] }}
                                    {...fillerProps}
                                />
                            )}
                        </div>

                        {hrComments.length > 0 && (
                            <div
                                style={{
                                    width: 300,
                                    minWidth: 300,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: token.marginMD,
                                    overflow: 'auto',
                                }}
                            >
                                <div>
                                    <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXS }}>
                                        <MessageOutlined style={{ marginRight: token.marginXXS }} />
                                        HR Feedback ({hrComments.length})
                                    </Typography.Text>
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
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </Modal>
    )
}
