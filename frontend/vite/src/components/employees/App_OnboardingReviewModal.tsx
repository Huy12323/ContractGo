import { useEffect, useMemo, useState } from 'react'
import { Modal, Input, DatePicker, Button, Typography, Tag, Spin, theme, Empty } from 'antd'
import { CheckCircleOutlined, MailOutlined, BankOutlined, TeamOutlined, EditOutlined } from '@ant-design/icons'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { TableKit } from '@tiptap/extension-table'
import type { JSONContent } from '@tiptap/core'
import { supabase } from '@/configs/supabase/config'
import { useQ_Tables_Contract } from '@/hooks/useQ_Tables_Contract'
import { useQ_Tables_OrgOnboardingInvitations } from '@/hooks/useQ_Tables_OrgOnboardingInvitations'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useM_OnboardingInvitation_Approve } from '@/hooks/useM_OnboardingInvitation_Approve'
import { FieldInput, fieldInputPreviewKey } from './ext_TipTap_FieldInput'
import { App_ContractPreview } from './App_ContractPreview'

type Props = {
    open: boolean
    onClose: () => void
    contractId: string | null
    organizationId: string
}

export const App_OnboardingReviewModal = ({ open, onClose, contractId, organizationId }: Props) => {
    const { token } = theme.useToken()

    const qContract = useQ_Tables_Contract({ contractId })
    const qInvitations = useQ_Tables_OrgOnboardingInvitations({ organizationId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ organizationId })
    const mApprove = useM_OnboardingInvitation_Approve()

    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [birthday, setBirthday] = useState<string>('')
    const [signedUrl, setSignedUrl] = useState<string | null>(null)
    const [signedUrlError, setSignedUrlError] = useState<string | null>(null)

    // Locate the matching invitation row from the cached org list (avoids extra query)
    const invitation = useMemo(() => {
        if (!qContract.contract) return null
        return (
            qInvitations.invitations.find((inv) => inv.id === qContract.contract!.invitation_id) ?? null
        )
    }, [qContract.contract, qInvitations.invitations])

    const departments = useMemo(() => {
        if (!invitation) return []
        return (invitation.rel__department__invitation ?? [])
            .map((l) => l.departments?.name)
            .filter((n): n is string => !!n)
    }, [invitation])

    // Build choicesMap for the TipTap field-input render path
    const choicesMap = useMemo(() => {
        const map: Record<string, Array<{ label: string; value: string }>> = {}
        for (const c of qChoices.choices) {
            const key = c.employee_column_id
            if (!map[key]) map[key] = []
            map[key]!.push({ label: c.label, value: c.value })
        }
        return map
    }, [qChoices.choices])

    const mergedValues = useMemo(() => {
        if (!qContract.contract) return {}
        const prefilled = (qContract.contract.prefilled_fields as Record<string, unknown>) ?? {}
        const filled = (qContract.contract.field_values as Record<string, unknown>) ?? {}
        return { ...prefilled, ...filled }
    }, [qContract.contract])

    // Auto-pull universal employee fields from the contract — HR only fills missing ones
    const readNonEmptyString = (val: unknown): string =>
        typeof val === 'string' && val.trim() !== '' ? val.trim() : ''
    const contractFirstName = readNonEmptyString(mergedValues.first_name)
    const contractLastName = readNonEmptyString(mergedValues.last_name)
    const contractBirthday = readNonEmptyString(mergedValues.birthday)

    const resolvedFirstName = contractFirstName || firstName.trim()
    const resolvedLastName = contractLastName || lastName.trim()
    const resolvedBirthday = contractBirthday || birthday

    // Read-only TipTap editor for the contract preview
    const editor = useEditor(
        {
            editable: false,
            content: (qContract.contract?.form_snapshot as JSONContent) ?? { type: 'doc', content: [] },
            extensions: [
                StarterKit,
                Underline,
                TextAlign.configure({ types: ['heading', 'paragraph'] }),
                TableKit,
                FieldInput,
            ],
        },
        [qContract.contract?.id],
    )

    // Inject merged values + choices into editor storage so FieldInput nodes render with values inline
    useEffect(() => {
        if (!editor) return
        const storage = (editor.storage as Record<string, any>).fieldInput
        storage.choicesMap = choicesMap
        storage.values = mergedValues
        storage.onChange = () => undefined
        const { tr } = editor.state
        tr.setMeta(fieldInputPreviewKey, Date.now())
        editor.view.dispatch(tr)
    }, [editor, choicesMap, mergedValues])

    // Resolve signed URL for the signature image
    useEffect(() => {
        let cancelled = false
        setSignedUrl(null)
        setSignedUrlError(null)
        const path = qContract.contract?.signature_path
        if (!open || !path) return

        ;(async () => {
            const sb_StorageOrgFiles_CreateSignedUrl = await supabase.storage
                .from('org-files')
                .createSignedUrl(path, 300)
            if (cancelled) return
            if (sb_StorageOrgFiles_CreateSignedUrl.error) {
                console.error(sb_StorageOrgFiles_CreateSignedUrl.error)
                setSignedUrlError('Failed to load signature')
                return
            }
            setSignedUrl(sb_StorageOrgFiles_CreateSignedUrl.data.signedUrl)
        })()

        return () => {
            cancelled = true
        }
    }, [open, qContract.contract?.signature_path])

    // Reset form whenever the modal opens (or contract changes)
    useEffect(() => {
        if (open) {
            setFirstName('')
            setLastName('')
            setBirthday('')
        }
    }, [open, contractId])

    const handleApprove = () => {
        if (!contractId) return
        if (!resolvedFirstName || !resolvedLastName) return
        mApprove.mutation.mutate(
            {
                contract_id: contractId,
                first_name: resolvedFirstName,
                last_name: resolvedLastName,
                birthday: resolvedBirthday || undefined,
            },
            { onSuccess: onClose },
        )
    }

    const isLoading = qContract.query.isLoading || qInvitations.query.isLoading

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
                        {/* Left: contract preview */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <App_ContractPreview editor={editor} />
                        </div>

                        {/* Right: signature + approval form */}
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

                            <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
                                <Typography.Text strong>Employee Details</Typography.Text>

                                {/* First Name */}
                                {contractFirstName ? (
                                    <div>
                                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: token.fontSizeSM }}>
                                            First Name <Tag color="blue" style={{ marginLeft: 4 }}>From contract</Tag>
                                        </Typography.Text>
                                        <Typography.Text>{contractFirstName}</Typography.Text>
                                    </div>
                                ) : (
                                    <div>
                                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: token.fontSizeSM }}>
                                            First Name *
                                        </Typography.Text>
                                        <Input
                                            placeholder="First name"
                                            value={firstName}
                                            onChange={(e) => setFirstName(e.target.value)}
                                        />
                                    </div>
                                )}

                                {/* Last Name */}
                                {contractLastName ? (
                                    <div>
                                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: token.fontSizeSM }}>
                                            Last Name <Tag color="blue" style={{ marginLeft: 4 }}>From contract</Tag>
                                        </Typography.Text>
                                        <Typography.Text>{contractLastName}</Typography.Text>
                                    </div>
                                ) : (
                                    <div>
                                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: token.fontSizeSM }}>
                                            Last Name *
                                        </Typography.Text>
                                        <Input
                                            placeholder="Last name"
                                            value={lastName}
                                            onChange={(e) => setLastName(e.target.value)}
                                        />
                                    </div>
                                )}

                                {/* Birthday */}
                                {contractBirthday ? (
                                    <div>
                                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: token.fontSizeSM }}>
                                            Birthday <Tag color="blue" style={{ marginLeft: 4 }}>From contract</Tag>
                                        </Typography.Text>
                                        <Typography.Text>{contractBirthday}</Typography.Text>
                                    </div>
                                ) : (
                                    <div>
                                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: token.fontSizeSM }}>
                                            Birthday (optional)
                                        </Typography.Text>
                                        <DatePicker
                                            style={{ width: '100%' }}
                                            onChange={(_d, ds) => setBirthday(typeof ds === 'string' ? ds : '')}
                                        />
                                    </div>
                                )}

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: token.marginXS, marginTop: token.marginSM }}>
                                    <Button onClick={onClose}>Cancel</Button>
                                    <Button
                                        type="primary"
                                        icon={<CheckCircleOutlined />}
                                        loading={mApprove.mutation.isPending}
                                        disabled={!resolvedFirstName || !resolvedLastName}
                                        onClick={handleApprove}
                                    >
                                        Approve
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </Modal>
    )
}
