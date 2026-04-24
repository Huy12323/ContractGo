import { useEffect, useRef, useState } from 'react'
import { App, Button, Spin, Tag, Typography, theme } from 'antd'
import { DeleteOutlined, ReloadOutlined, SwapOutlined, UploadOutlined } from '@ant-design/icons'
import { supabase } from '@/configs/supabase/config'
import { useM_Files_Upload, type UseM_Files_Upload_Params } from '@/hooks/useM_Files_Upload'
import { useM_Files_Delete } from '@/hooks/useM_Files_Delete'
import { useQ_Files_ReadUrl, type UseQ_Files_ReadUrl_Params } from '@/hooks/useQ_Files_ReadUrl'
import { useQ_Tables_OrgFiles } from '@/hooks/useQ_Tables_OrgFiles'
import { Utils_FileTypeIcon_Component } from '@/utils/Utils_FileTypeIcon'
import { fieldStateTagColor, fieldStateTagLabel } from './App_FieldRenderer'
import type { App_FieldRenderer_State } from './App_FieldRenderer'
import { App_FilePreviewModal } from './App_FilePreviewModal'

const formatBytes = (n: number | null | undefined) => {
    if (!n || n <= 0) return ''
    const units = ['B', 'KB', 'MB', 'GB']
    let idx = 0
    let v = n
    while (v >= 1024 && idx < units.length - 1) {
        v /= 1024
        idx++
    }
    return `${v.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

type ContractField = { fieldKey: string; fieldLabel: string; fieldType: string }
type Mode = 'fill' | 'readonly'
type FillerRole = 'hr' | 'employee'

/**
 * Scope discriminator for attachment uploads.
 * - `employee_col` — employee-detail edits, live upload with employee_id + column_id
 * - `invitation_col` — employee fill / HR review, live upload with invitation_id + column_id
 * - `defer` — HR pre-fill wizard: File is held locally in parent state until Send,
 *            which orchestrates the upload after the invitation row exists
 * `undefined` (not in the union) means fully readonly — no uploads and no thumbnail
 * fetching (thumbnails need a scope id to sign the URL).
 */
export type UploadContext =
    | { kind: 'employee_col'; employee_id: string }
    | { kind: 'invitation_col'; invitation_id: string }
    | { kind: 'defer' }

type Props = {
    fields: ContractField[]
    fieldValues: Record<string, unknown>
    onChange: (fieldKey: string, value: unknown) => void
    mode: Mode
    fillerRole: FillerRole
    fieldStates: Record<string, App_FieldRenderer_State>
    uploadContext?: UploadContext
    organization_id: string
    errors?: Record<string, string>
}

const CARD_WIDTH = 280
const THUMB_SIZE = 48

export const App_AttachmentStrip = ({
    fields,
    fieldValues,
    onChange,
    mode,
    fillerRole,
    fieldStates,
    uploadContext,
    organization_id,
    errors,
}: Props) => {
    const { token } = theme.useToken()
    const fileFields = fields.filter((f) => f.fieldType === 'file')
    if (fileFields.length === 0) return null

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
            <Typography.Text strong>Attachments ({fileFields.length})</Typography.Text>
            <div
                style={{
                    display: 'flex',
                    gap: token.marginSM,
                    overflowX: 'auto',
                    paddingBottom: token.marginXXS,
                }}
            >
                {fileFields.map((f) => (
                    <Card_Attachment
                        key={f.fieldKey}
                        field={f}
                        value={fieldValues[f.fieldKey] ?? null}
                        mode={mode}
                        fillerRole={fillerRole}
                        fieldState={fieldStates[f.fieldKey] ?? 'optional'}
                        uploadContext={uploadContext}
                        organization_id={organization_id}
                        onChange={(val) => onChange(f.fieldKey, val)}
                        error={errors?.[f.fieldKey]}
                    />
                ))}
            </div>
        </div>
    )
}

type CardProps = {
    field: ContractField
    value: unknown
    mode: Mode
    fillerRole: FillerRole
    fieldState: App_FieldRenderer_State
    uploadContext?: UploadContext
    organization_id: string
    onChange: (value: unknown) => void
    error?: string
}

const Card_Attachment = ({
    field,
    value,
    mode,
    fillerRole,
    fieldState,
    uploadContext,
    organization_id,
    onChange,
    error,
}: CardProps) => {
    const { token } = theme.useToken()
    const { message, modal } = App.useApp()
    const inputRef = useRef<HTMLInputElement | null>(null)
    const [lastFile, setLastFile] = useState<File | null>(null)
    const [previewOpen, setPreviewOpen] = useState(false)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)

    const mFilesUpload = useM_Files_Upload()
    const mFilesDelete = useM_Files_Delete()

    // Value shape: File (defer pending), string (uploaded file_id), null/undefined (empty).
    const pendingFile = value instanceof File ? value : null
    const fileId = typeof value === 'string' && value ? value : null

    // Local blob URL for defer-mode files — lets us render an inline image thumbnail
    // and open the file in a new tab from the card click, without round-tripping to R2.
    // Revoked on unmount / pendingFile change to avoid leaking.
    const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)
    useEffect(() => {
        if (!pendingFile) {
            setLocalPreviewUrl(null)
            return
        }
        const url = URL.createObjectURL(pendingFile)
        setLocalPreviewUrl(url)
        return () => {
            URL.revokeObjectURL(url)
        }
    }, [pendingFile])

    const qOrgFiles = useQ_Tables_OrgFiles({ organizationId: organization_id })
    const filesRow = fileId ? qOrgFiles.filesMap[fileId] : undefined

    // Thumbnail URL fetching only works when we have a live scope id (employee or invitation).
    // Defer mode stores the File locally — no server URL yet. Readonly mode with no context
    // still shows the fallback icon + filename, just no thumbnail.
    const thumbParams: UseQ_Files_ReadUrl_Params =
        uploadContext?.kind === 'employee_col'
            ? {
                  resource_type: 'employee_col',
                  file_id: filesRow?.thumbnail_r2_key ? fileId : null,
                  employee_id: uploadContext.employee_id,
                  column_id: field.fieldKey,
                  use_thumbnail: true,
              }
            : uploadContext?.kind === 'invitation_col'
              ? {
                    resource_type: 'invitation_col',
                    file_id: filesRow?.thumbnail_r2_key ? fileId : null,
                    invitation_id: uploadContext.invitation_id,
                    column_id: field.fieldKey,
                    use_thumbnail: true,
                }
              : {
                    // Placeholder — `file_id: null` keeps the query disabled.
                    resource_type: 'employee_col',
                    file_id: null,
                    employee_id: null,
                    column_id: field.fieldKey,
                    use_thumbnail: true,
                }
    const qThumbUrl = useQ_Files_ReadUrl(thumbParams)

    const canUpload = !!uploadContext
    const editable =
        mode === 'fill' && canUpload && !(fillerRole === 'employee' && fieldState === 'hr')

    // Branches an upload-start call by resource_type — `defer` captures the File locally.
    const startUpload = (file: File, oldFileId: string | null) => {
        setLastFile(file)
        if (!uploadContext) return // defensive — caller gated on editable

        if (uploadContext.kind === 'defer') {
            onChange(file)
            return
        }

        const params: UseM_Files_Upload_Params =
            uploadContext.kind === 'employee_col'
                ? {
                      resource_type: 'employee_col',
                      file,
                      employee_id: uploadContext.employee_id,
                      column_id: field.fieldKey,
                  }
                : {
                      resource_type: 'invitation_col',
                      file,
                      invitation_id: uploadContext.invitation_id,
                      column_id: field.fieldKey,
                  }

        mFilesUpload.mutation.mutate(params, {
            onSuccess: (result) => {
                if (oldFileId) mFilesDelete.mutation.mutate({ file_id: oldFileId })
                onChange(result.file_id)
            },
        })
    }

    const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        startUpload(file, fileId)
    }

    const handleRetry = () => {
        if (lastFile) startUpload(lastFile, fileId)
    }

    const handleRemove = () => {
        // Defer mode — File lives only in state, just clear it.
        if (pendingFile) {
            onChange(null)
            return
        }
        if (!fileId) return
        const currentId = fileId
        const name = filesRow?.name ?? 'this file'
        modal.confirm({
            title: 'Remove attachment?',
            content: `This will permanently delete "${name}".`,
            okType: 'danger',
            okText: 'Remove',
            onOk: async () => {
                await mFilesDelete.mutation.mutateAsync({ file_id: currentId })
                onChange(null)
            },
        })
    }

    const handlePreview = async () => {
        // Defer-mode: open the local blob URL inline in a modal — no server round-trip.
        if (pendingFile && localPreviewUrl) {
            setPreviewUrl(localPreviewUrl)
            setPreviewOpen(true)
            return
        }
        if (!fileId) return
        if (!uploadContext || uploadContext.kind === 'defer') {
            message.error('Preview not available in this view')
            return
        }
        const body: Record<string, unknown> = {
            resource_type: uploadContext.kind,
            file_id: fileId,
            column_id: field.fieldKey,
        }
        if (uploadContext.kind === 'employee_col') {
            body.employee_id = uploadContext.employee_id
        } else {
            body.invitation_id = uploadContext.invitation_id
        }
        const sb_FunctionsFilesR2SignReadUrl_Invoke = await supabase.functions.invoke(
            'files_r2_sign-read-url',
            { body },
        )
        if (sb_FunctionsFilesR2SignReadUrl_Invoke.error) {
            message.error('Failed to open preview')
            return
        }
        const { url } = sb_FunctionsFilesR2SignReadUrl_Invoke.data as { url: string }
        setPreviewUrl(url)
        setPreviewOpen(true)
    }

    // State machine: pending (uploading) > failed > defer-pending > ready > loading > empty.
    const isPending = mFilesUpload.mutation.isPending
    const isFailed = mFilesUpload.mutation.isError && !isPending
    const isDeferPending = !!pendingFile && !isPending && !isFailed
    const isReady = !!fileId && !!filesRow && !isPending && !isFailed
    const isLoading = !!fileId && !filesRow && !isPending && !isFailed
    const isEmpty = !pendingFile && !fileId && !isPending && !isFailed

    // A card is previewable when we either have a signed server URL (ready) or a
    // local blob URL (defer-pending) — both open in a new tab on click.
    const previewable = isReady || (isDeferPending && !!localPreviewUrl)

    const filenameText =
        pendingFile?.name ??
        filesRow?.name ??
        (isEmpty && editable ? 'Click to upload' : field.fieldLabel)

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS, width: CARD_WIDTH }}>
            <div
                style={{
                    display: 'flex',
                    gap: token.marginSM,
                    alignItems: 'center',
                    padding: token.paddingXS,
                    background: token.colorBgContainer,
                    border: `1px ${isEmpty && editable ? 'dashed' : 'solid'} ${error ? token.colorError : token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusSM,
                    cursor: isEmpty && editable ? 'pointer' : previewable ? 'pointer' : 'default',
                }}
                onClick={
                    isEmpty && editable
                        ? () => inputRef.current?.click()
                        : previewable
                          ? handlePreview
                          : undefined
                }
                onKeyDown={
                    previewable
                        ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') handlePreview()
                          }
                        : undefined
                }
                role={previewable ? 'button' : undefined}
                tabIndex={previewable ? 0 : undefined}
            >
                {/* Thumbnail slot — 48x48 square on the left. Outer card handles the click. */}
                <div
                    style={{
                        flexShrink: 0,
                        width: THUMB_SIZE,
                        height: THUMB_SIZE,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: token.colorFillAlter,
                        borderRadius: token.borderRadiusXS,
                        overflow: 'hidden',
                    }}
                >
                    {(isPending || isLoading) && <Spin size="small" />}
                    {isFailed && (
                        <UploadOutlined style={{ fontSize: 20, color: token.colorError }} />
                    )}
                    {isDeferPending && (
                        pendingFile?.type.startsWith('image/') && localPreviewUrl ? (
                            <img
                                src={localPreviewUrl}
                                alt={pendingFile.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                        ) : (
                            <IconFallback mime={pendingFile?.type ?? ''} />
                        )
                    )}
                    {isReady && (qThumbUrl.url ? (
                        <img
                            src={qThumbUrl.url}
                            alt={filesRow?.name ?? ''}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                    ) : (
                        <IconFallback mime={filesRow?.content_type ?? ''} />
                    ))}
                    {isEmpty && editable && (
                        <UploadOutlined style={{ fontSize: 18, color: token.colorTextTertiary }} />
                    )}
                    {isEmpty && !editable && (
                        <IconFallback mime="" />
                    )}
                </div>

                {/* Right column — filename on top, state tag + actions below */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS, minWidth: 0 }}>
                        <Typography.Text
                            ellipsis
                            style={{
                                fontSize: 12,
                                flex: 1,
                                minWidth: 0,
                                color: isEmpty && !editable ? token.colorTextTertiary : undefined,
                                fontStyle: isEmpty && editable ? 'italic' : 'normal',
                            }}
                        >
                            {filenameText}
                        </Typography.Text>
                        <Tag
                            color={fieldStateTagColor(fieldState)}
                            style={{ margin: 0, fontSize: 10, letterSpacing: 0.4, lineHeight: '16px', flexShrink: 0 }}
                        >
                            {fieldStateTagLabel(fieldState)}
                        </Tag>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 }}>
                        <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                            {isPending
                                ? 'Uploading…'
                                : isFailed
                                  ? 'Upload failed'
                                  : isDeferPending
                                    ? formatBytes(pendingFile?.size)
                                    : isReady
                                      ? formatBytes(filesRow?.size)
                                      : ''}
                        </Typography.Text>
                        <div style={{ display: 'flex', gap: token.marginXXS, flexShrink: 0 }}>
                            {editable && (isReady || isDeferPending) && (
                                <>
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<SwapOutlined />}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            inputRef.current?.click()
                                        }}
                                    />
                                    <Button
                                        type="text"
                                        size="small"
                                        danger
                                        icon={<DeleteOutlined />}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleRemove()
                                        }}
                                    />
                                </>
                            )}
                            {editable && isFailed && (
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<ReloadOutlined />}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        handleRetry()
                                    }}
                                >
                                    Retry
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Hidden file picker */}
                {editable && (
                    <input
                        ref={inputRef}
                        type="file"
                        style={{ display: 'none' }}
                        onChange={handleFilePick}
                    />
                )}
            </div>
            {error && (
                <Typography.Text type="danger" style={{ fontSize: 11 }}>
                    {error}
                </Typography.Text>
            )}
            <App_FilePreviewModal
                open={previewOpen}
                onClose={() => setPreviewOpen(false)}
                url={previewUrl}
                name={pendingFile?.name ?? filesRow?.name ?? null}
                contentType={pendingFile?.type ?? filesRow?.content_type ?? null}
                size={pendingFile?.size ?? filesRow?.size ?? null}
            />
        </div>
    )
}

const IconFallback = ({ mime }: { mime: string }) => {
    const { Icon, primary } = Utils_FileTypeIcon_Component(mime)
    return <Icon twoToneColor={primary} style={{ fontSize: 24 }} />
}
