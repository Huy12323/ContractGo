import { useEffect, useMemo, useState } from 'react'
import { Modal, List, Button, Typography, Tag, Avatar, Tooltip, App, theme, Spin } from 'antd'
import { UndoOutlined } from '@ant-design/icons'
import type { JSONContent } from '@tiptap/core'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { App_ContractFiller } from '@/components/employees/App_ContractFiller'
import { useQ_Tables_ContractTemplateVersions } from '@/hooks/useQ_Tables_ContractTemplateVersions'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useQ_Tables_OrgEntities } from '@/hooks/useQ_Tables_OrgEntities'
import { useM_ContractTemplate_Restore } from '@/hooks/useM_ContractTemplate_Restore'
import { useQ_ContractTemplate_PdfReadUrl } from '@/hooks/useQ_ContractTemplate_PdfReadUrl'
import type { Enums } from '@/types/database.helpers'
import type { Json } from '@/types/database.types'
import type { PdfLayout } from '@/types/contractTemplate.types'

dayjs.extend(relativeTime)

export type App_ContractTemplateVersionsModal_OnRestored = (body: {
    /** TipTap doc when type='tiptap', PdfLayout array when type='pdf'. Consumer
     *  branches on `type` and casts accordingly. */
    layout: JSONContent | unknown
    type: Enums<'contract_template_type_enum'>
    pdf_file_path: string | null
    mandatory_field_keys: string[]
    hr_field_keys: string[]
    attachment_field_keys: string[]
}) => void

type Props = {
    open: boolean
    onClose: () => void
    templateId: string
    organizationId: string
    onRestored: App_ContractTemplateVersionsModal_OnRestored
}

// Outer shell — thin Modal wrapper. All hooks/state live in ModalBody, which
// is unmounted by `destroyOnHidden` when the Modal closes. This guarantees
// `selectedVersionId` (and any other ephemeral state) resets between opens
// without needing manual reset effects.
export const App_ContractTemplateVersionsModal = ({
    open,
    onClose,
    templateId,
    organizationId,
    onRestored,
}: Props) => {
    return (
        <Modal
            open={open}
            onCancel={onClose}
            title="Version history"
            width="80vw"
            footer={null}
            styles={{ body: { height: '70vh', overflow: 'hidden', display: 'flex', padding: 0 } }}
            destroyOnHidden
        >
            <ModalBody
                templateId={templateId}
                organizationId={organizationId}
                onClose={onClose}
                onRestored={onRestored}
            />
        </Modal>
    )
}

type BodyProps = {
    templateId: string
    organizationId: string
    onClose: () => void
    onRestored: App_ContractTemplateVersionsModal_OnRestored
}

const ModalBody = ({ templateId, organizationId, onClose, onRestored }: BodyProps) => {
    const { token } = theme.useToken()
    const { modal } = App.useApp()

    const qVersions = useQ_Tables_ContractTemplateVersions({ templateId })
    const qEntities = useQ_Tables_OrgEntities({ organizationId })
    const entityId = qEntities.entities[0]?.id ?? ""
    const qColumns = useQ_Tables_EmployeeColumns({ entityId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ entityId })
    const mRestore = useM_ContractTemplate_Restore({ templateId })

    const versions = qVersions.versions
    const latestVersionId = versions[0]?.id ?? null

    const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)

    // Default selection = latest whenever versions refresh
    useEffect(() => {
        if (!selectedVersionId && latestVersionId) setSelectedVersionId(latestVersionId)
    }, [latestVersionId, selectedVersionId])

    const selected = useMemo(
        () => versions.find((v) => v.id === selectedVersionId) ?? null,
        [versions, selectedVersionId],
    )

    const selectedKind: 'tiptap' | 'pdf' = selected?.type === 'pdf' ? 'pdf' : 'tiptap'

    const qPdfUrl = useQ_ContractTemplate_PdfReadUrl({
        contractTemplateId: selectedKind === 'pdf' ? templateId : null,
        pdfFilePathKey: selectedKind === 'pdf' ? selected?.pdf_file_path : null,
    })

    const previewLayout = useMemo(
        () => (selected?.layout ?? { type: 'doc', content: [] }) as JSONContent,
        [selected?.layout],
    )

    const previewMandatoryKeys = useMemo(
        () => (selected?.mandatory_field_keys ?? []) as string[],
        [selected?.mandatory_field_keys],
    )

    const previewHrFieldKeys = useMemo(
        () => (selected?.hr_field_keys ?? []) as string[],
        [selected?.hr_field_keys],
    )

    const previewAttachmentFieldKeys = useMemo(
        () => (selected?.attachment_field_keys ?? []) as string[],
        [selected?.attachment_field_keys],
    )

    const handleRestore = (v: (typeof versions)[number]) => {
        modal.confirm({
            title: `Restore v${v.version_number}?`,
            content:
                'This creates a new version with the content of this snapshot. Your current unsaved draft will be lost.',
            okText: 'Restore',
            cancelText: 'Cancel',
            onOk: async () => {
                const restoredMandatory = (v.mandatory_field_keys ?? []) as string[]
                const restoredHr = (v.hr_field_keys ?? []) as string[]
                const restoredAttachment = (v.attachment_field_keys ?? []) as string[]
                await mRestore.mutation.mutateAsync({
                    layout: v.layout as Json,
                    type: v.type,
                    pdf_file_path: v.pdf_file_path,
                    mandatory_field_keys: restoredMandatory,
                    hr_field_keys: restoredHr,
                    attachment_field_keys: restoredAttachment,
                    versionNumber: v.version_number,
                })
                // Sync editor + close modal
                onRestored({
                    layout: v.layout as JSONContent,
                    type: v.type,
                    pdf_file_path: v.pdf_file_path,
                    mandatory_field_keys: restoredMandatory,
                    hr_field_keys: restoredHr,
                    attachment_field_keys: restoredAttachment,
                })
                onClose()
            },
        })
    }

    const formatAuthor = (profile: (typeof versions)[number]['profiles']) => {
        if (!profile) return 'Unknown'
        return profile.full_name ?? profile.email ?? 'Unknown'
    }

    return (
        <>
            {/* Left: version list */}
            <div
                style={{
                    width: 320,
                    minWidth: 320,
                    borderRight: `1px solid ${token.colorBorderSecondary}`,
                    overflowY: 'auto',
                }}
            >
                <List
                    loading={qVersions.query.isLoading}
                    dataSource={versions}
                    locale={{ emptyText: 'No versions yet' }}
                    renderItem={(v, idx) => {
                        const isLatest = idx === 0
                        const isSelected = v.id === selectedVersionId
                        const absolute = dayjs(v.created_at).format('YYYY-MM-DD HH:mm')
                        const relative = dayjs(v.created_at).fromNow()
                        return (
                            <List.Item
                                onClick={() => setSelectedVersionId(v.id)}
                                style={{
                                    cursor: 'pointer',
                                    padding: token.paddingSM,
                                    background: isSelected ? token.colorPrimaryBg : undefined,
                                    borderLeft: isSelected
                                        ? `3px solid ${token.colorPrimary}`
                                        : '3px solid transparent',
                                }}
                            >
                                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
                                        <Typography.Text strong>{absolute}</Typography.Text>
                                        {isLatest && <Tag color="blue" style={{ marginInlineEnd: 0 }}>Latest</Tag>}
                                        {!isLatest && (
                                            <Tooltip title={`Restore this version`}>
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<UndoOutlined />}
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleRestore(v)
                                                    }}
                                                    loading={mRestore.mutation.isPending}
                                                    style={{ marginLeft: 'auto' }}
                                                >
                                                    Restore
                                                </Button>
                                            </Tooltip>
                                        )}
                                    </div>
                                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                        {relative}
                                    </Typography.Text>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
                                        <Avatar
                                            size="small"
                                            src={v.profiles?.avatar_url ?? undefined}
                                        >
                                            {formatAuthor(v.profiles).charAt(0).toUpperCase()}
                                        </Avatar>
                                        <Typography.Text style={{ fontSize: token.fontSizeSM }}>
                                            {formatAuthor(v.profiles)}
                                        </Typography.Text>
                                    </div>
                                </div>
                            </List.Item>
                        )
                    }}
                />
            </div>

            {/* Right: preview */}
            <div style={{ flex: 1, overflow: 'auto', padding: token.paddingMD }}>
                {selected ? (
                    selectedKind === 'pdf' ? (
                        <App_ContractFiller
                            key={selected.id}
                            kind="pdf"
                            mode="review"
                            layout={selected.layout as PdfLayout}
                            pdfFileUrl={qPdfUrl.url ?? null}
                            fieldValues={{}}
                            prefilledValues={{}}
                            onChange={() => {}}
                            columns={qColumns.columns}
                            choices={qChoices.choices}
                            mandatoryKeys={previewMandatoryKeys}
                            hrFieldKeys={previewHrFieldKeys}
                            attachmentFieldKeys={previewAttachmentFieldKeys}
                            organization_id={organizationId}
                        />
                    ) : (
                        <App_ContractFiller
                            key={selected.id}
                            mode="review"
                            layout={previewLayout}
                            fieldValues={{}}
                            prefilledValues={{}}
                            onChange={() => {}}
                            columns={qColumns.columns}
                            choices={qChoices.choices}
                            mandatoryKeys={previewMandatoryKeys}
                            hrFieldKeys={previewHrFieldKeys}
                            attachmentFieldKeys={previewAttachmentFieldKeys}
                            organization_id={organizationId}
                        />
                    )
                ) : qVersions.query.isLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: token.paddingXL }}>
                        <Spin />
                    </div>
                ) : (
                    <Typography.Text type="secondary">Select a version to preview</Typography.Text>
                )}
            </div>
        </>
    )
}
