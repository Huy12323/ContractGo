import { useMemo } from 'react'
import { Modal, Spin, Typography, Tag, Descriptions, theme } from 'antd'
import { MailOutlined } from '@ant-design/icons'
import type { JSONContent } from '@tiptap/core'
import { App_ContractFiller } from './App_ContractFiller'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'

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
    rel__department__invitation?: Array<{ departments?: { name?: string | null } | null }> | null
}

type Props = {
    open: boolean
    onClose: () => void
    invitation: InvitationLike | null
    organizationId: string
}

/**
 * Read-only preview of a `sent` invitation — employee hasn't filled yet, so there's
 * no contract row to render. Shows invitation metadata + template snapshot + HR
 * pre-filled values via App_ContractFiller in review mode. No actions.
 */
export const App_OnboardingInvitationPreviewModal = ({ open, onClose, invitation, organizationId }: Props) => {
    const { token } = theme.useToken()
    const qColumns = useQ_Tables_EmployeeColumns({ organizationId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ organizationId })

    const snapshot = useMemo(() => {
        const snap = (invitation?.template_snapshot ?? {}) as {
            layout?: JSONContent
            mandatory_field_keys?: string[]
            hr_field_keys?: string[]
            attachment_field_keys?: string[]
        }
        return snap
    }, [invitation?.template_snapshot])

    const layout = useMemo(
        () => (snapshot.layout ?? { type: 'doc', content: [] }) as JSONContent,
        [snapshot.layout],
    )

    const prefilledValues = useMemo(
        () => (invitation?.prefilled_fields ?? {}) as Record<string, unknown>,
        [invitation?.prefilled_fields],
    )

    const departments = useMemo(
        () =>
            (invitation?.rel__department__invitation ?? [])
                .map((r) => r.departments?.name)
                .filter((n): n is string => !!n),
        [invitation?.rel__department__invitation],
    )

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

                    <div style={{ flex: 1, minHeight: 0 }}>
                        <App_ContractFiller
                            mode="review"
                            layout={layout}
                            fieldValues={prefilledValues}
                            prefilledValues={prefilledValues}
                            onChange={() => {}}
                            columns={qColumns.columns}
                            choices={qChoices.choices}
                            mandatoryKeys={snapshot.mandatory_field_keys ?? []}
                            hrFieldKeys={snapshot.hr_field_keys ?? []}
                            attachmentFieldKeys={
                                snapshot.attachment_field_keys ? (snapshot.attachment_field_keys as string[]) : undefined
                            }
                            organization_id={organizationId}
                            uploadContext={{ kind: 'invitation_col', invitation_id: invitation.id }}
                        />
                    </div>
                </>
            )}
        </Modal>
    )
}
