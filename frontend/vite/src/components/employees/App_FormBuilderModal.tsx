import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Modal, Input, Button, Typography, Segmented, Select, Dropdown, App, theme, Tooltip } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/configs/supabase/config'
import { useM_Files_Upload } from '@/hooks/useM_Files_Upload'
import { useQ_ContractTemplate_PdfReadUrl } from '@/hooks/useQ_ContractTemplate_PdfReadUrl'
import { QueryKeys } from '@/utils/query/queryKeys'
import {
    AlignCenterOutlined,
    AlignLeftOutlined,
    AlignRightOutlined,
    BoldOutlined,
    CloseOutlined,
    DeleteOutlined,
    ItalicOutlined,
    MinusOutlined,
    OrderedListOutlined,
    PaperClipOutlined,
    PlusOutlined,
    StrikethroughOutlined,
    TableOutlined,
    UnderlineOutlined,
    UnorderedListOutlined,
    EyeOutlined,
    FormOutlined,
    HistoryOutlined,
} from '@ant-design/icons'
import { AlignJustify } from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import { Extension, type JSONContent } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TableKit } from '@tiptap/extension-table'
import { useQ_Tables_ContractTemplates } from '@/hooks/useQ_Tables_ContractTemplates'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useM_ContractTemplate_Create } from '@/hooks/useM_ContractTemplate_Create'
import { useM_ContractTemplate_Update } from '@/hooks/useM_ContractTemplate_Update'
import { FieldInput, FieldRendererContext, fieldInputPreviewKey, type FieldRendererContextValue } from './ext_TipTap_FieldInput'
import { type App_FieldRenderer_State } from './App_FieldRenderer'
import { App_FieldLegendChip } from './App_FieldLegendChip'
import { App_FieldStateDropdown } from './App_FieldStateDropdown'
import { App_ContractFiller } from './App_ContractFiller'
import { App_EmployeeFieldComposerModal } from './App_EmployeeFieldComposerModal'
import { App_ContractTemplateVersionsModal, type App_ContractTemplateVersionsModal_OnRestored } from './App_ContractTemplateVersionsModal'
import { isTipTapLayout, utils_FormBuilder_migrateLayout } from './utils_FormBuilder_migrateLayout'
import { App_PdfZoomControls } from './App_PdfZoomControls'
import { App_PdfFieldEditor } from './App_PdfFieldEditor'
import { App_PdfThumbnailList } from './App_PdfThumbnailList'
import type { PdfLayout } from '@/types/contractTemplate.types'
import type { Json } from '@/types/database.types'

type ContractTemplateKind = 'tiptap' | 'pdf'

const UNIVERSAL_FIELDS = [
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'first_name', label: 'First Name', type: 'text' },
    { key: 'last_name', label: 'Last Name', type: 'text' },
    { key: 'birthday', label: 'Birthday', type: 'date' },
] as const

// Draws the text selection as a decoration when editor loses DOM focus (e.g. toolbar click)
const focusPluginKey = new PluginKey('selectionPreserver')
const SelectionPreserver = Extension.create({
    name: 'selectionPreserver',
    addProseMirrorPlugins() {
        return [new Plugin({
            key: focusPluginKey,
            state: {
                init: () => true,
                apply: (tr, prev) => {
                    const meta = tr.getMeta(focusPluginKey)
                    return meta !== undefined ? meta : prev
                },
            },
            props: {
                handleDOMEvents: {
                    focus: (view) => { view.dispatch(view.state.tr.setMeta(focusPluginKey, true)); return false },
                    blur: (view) => { view.dispatch(view.state.tr.setMeta(focusPluginKey, false)); return false },
                },
                decorations: (state) => {
                    if (focusPluginKey.getState(state)) return DecorationSet.empty
                    const { selection } = state
                    if (selection.empty) return DecorationSet.empty
                    return DecorationSet.create(state.doc, [
                        Decoration.inline(selection.from, selection.to, { class: 'selection-preserved' }),
                    ])
                },
            },
        })]
    },
})

type HeadingEntry = { level: number; text: string; pos: number }

type LineIndicator = {
    buttonX: number
    buttonY: number
    lineX: number
    lineY: number
    lineW: number
    lineH: number
    cell: HTMLElement
}

interface Props {
    open: boolean
    onClose: () => void
    organizationId: string
    entityId: string
    formId: string | null
}

export const App_FormBuilderModal = ({ open, onClose, organizationId, entityId, formId }: Props) => {
    const { token } = theme.useToken()
    const { modal, message } = App.useApp()
    const queryClient = useQueryClient()
    const qTemplates = useQ_Tables_ContractTemplates({ entityId })
    const qColumns = useQ_Tables_EmployeeColumns({ entityId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ entityId })
    const mCreate = useM_ContractTemplate_Create()
    const mUpdate = useM_ContractTemplate_Update({ templateId: formId ?? '' })
    const mFileUpload = useM_Files_Upload()

    const [formName, setFormName] = useState('')
    const [preview, setPreview] = useState(false)
    const [search, setSearch] = useState('')
    const [fieldManagerOpen, setFieldManagerOpen] = useState(false)
    const [tick, setTick] = useState(0)
    const [headings, setHeadings] = useState<HeadingEntry[]>([])
    const [mandatorySet, setMandatorySet] = useState<Set<string>>(new Set())
    const [hrSet, setHrSet] = useState<Set<string>>(new Set())
    const [attachmentSet, setAttachmentSet] = useState<Set<string>>(new Set())
    // Ephemeral state for the composer's preview mode — a two-column filler matching the other surfaces.
    // Resets every time the user toggles into preview (fresh session per peek).
    const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({})
    const [previewSessionKey, setPreviewSessionKey] = useState(0)
    const initialStateRef = useRef<{
        name: string
        layout: string
        mandatory: string
        hr: string
        attachment: string
        kind: ContractTemplateKind
        pdfFilePath: string | null
        pdfLayout: string
    }>({ name: '', layout: '', mandatory: '[]', hr: '[]', attachment: '[]', kind: 'tiptap', pdfFilePath: null, pdfLayout: '[]' })
    const [isDirty, setIsDirty] = useState(false)
    // PDF kind state — coexists with TipTap state. Only one kind is active per template at a time.
    const [kind, setKind] = useState<ContractTemplateKind>('tiptap')
    const [pdfFilePath, setPdfFilePath] = useState<string | null>(null)
    const [pdfLayout, setPdfLayout] = useState<PdfLayout>([])
    const [pdfScale, setPdfScale] = useState(1.0)
    // Field selected from the palette and pending click-to-drop on a PDF page (PDF kind only)
    const [pendingPdfField, setPendingPdfField] = useState<{ key: string; label: string; type: string } | null>(null)
    // Newly-picked PDF source file held in memory until Save. Save handler uploads it
    // to R2 and patches pdf_file_path; never persisted client-side.
    const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null)
    // Page count exposed by App_PdfDocument once the source PDF loads. Drives the
    // PDF-kind page selector that replaces the TipTap outline column.
    const [pdfNumPages, setPdfNumPages] = useState(0)
    // Selected PDF positioned-field — lifted from App_PdfFieldEditor so the palette
    // can render the matching item with an active style and so navigation from the
    // palette can set it programmatically.
    const [pdfSelectedKey, setPdfSelectedKey] = useState<string | null>(null)

    // PDF URL resolution lives here (not inside App_PdfFieldEditor) so the sidebar
    // thumbnail list can render from the same URL without a second hook call.
    // - pendingPdfFile (in-memory blob) takes precedence — used between pick and Save
    // - else the saved pdf_file_path resolves to a signed R2 URL via the hook
    const qPdfReadUrl = useQ_ContractTemplate_PdfReadUrl({
        contractTemplateId: formId,
        pdfFilePathKey: pendingPdfFile ? null : pdfFilePath,
    })
    const pdfBlobUrl = useMemo(
        () => (pendingPdfFile ? URL.createObjectURL(pendingPdfFile) : null),
        [pendingPdfFile],
    )
    useEffect(() => {
        if (!pdfBlobUrl) return
        return () => URL.revokeObjectURL(pdfBlobUrl)
    }, [pdfBlobUrl])
    const pdfFileUrl = pdfBlobUrl ?? qPdfReadUrl.url ?? null
    const hasPdf = !!pendingPdfFile || !!pdfFilePath
    const [saveAsOpen, setSaveAsOpen] = useState(false)
    const [saveAsName, setSaveAsName] = useState('')
    const [historyOpen, setHistoryOpen] = useState(false)
    const [rowIndicator, setRowIndicator] = useState<LineIndicator | null>(null)
    const [colIndicator, setColIndicator] = useState<LineIndicator | null>(null)
    const editorAreaRef = useRef<HTMLDivElement>(null)
    const toolbarRef = useRef<HTMLDivElement>(null)

    const columnsMap = useMemo(
        () => Object.fromEntries(qColumns.columns.map((c) => [c.id, c])),
        [qColumns.columns],
    )

    const choicesMap = useMemo(
        () => qChoices.choices.reduce((acc, c) => {
            ;(acc[c.employee_column_id] ??= []).push({ label: c.label, value: c.value })
            return acc
        }, {} as Record<string, Array<{ label: string; value: string }>>),
        [qChoices.choices],
    )

    const resolveField = useCallback((key: string) => {
        const u = UNIVERSAL_FIELDS.find((f) => f.key === key)
        if (u) return { label: u.label, type: u.type as string }
        const col = columnsMap[key]
        return { label: col?.label ?? key, type: col?.type ?? 'unknown' }
    }, [columnsMap])

    const allFields = useMemo(() => {
        const universals = UNIVERSAL_FIELDS.map((f) => ({ key: f.key, label: f.label, type: f.type as string }))
        const dynamics = qColumns.columns.map((c) => ({ key: c.id, label: c.label, type: c.type }))
        return [...universals, ...dynamics]
    }, [qColumns.columns])

    const [usedKeys, setUsedKeys] = useState<Set<string>>(new Set())

    const availableFields = useMemo(() => {
        if (!search.trim()) return allFields
        const q = search.toLowerCase()
        return allFields.filter((f) => f.label.toLowerCase().includes(q) || f.type.toLowerCase().includes(q))
    }, [allFields, search])

    const syncUsedKeys = useCallback((editorInstance: { getJSON: () => { type: string; content?: unknown[]; attrs?: Record<string, string> } }) => {
        const keys = new Set<string>()
        const walk = (node: { type: string; content?: unknown[]; attrs?: Record<string, string> }) => {
            if (node.type === 'fieldInput' && node.attrs?.fieldKey) keys.add(node.attrs.fieldKey)
            if (node.content) (node.content as typeof node[]).forEach(walk)
        }
        walk(editorInstance.getJSON())
        setUsedKeys(keys)
    }, [])

    const editor = useEditor({
        extensions: [
            StarterKit,
            TextAlign.configure({ types: ['heading', 'paragraph'] }),
            TableKit,
            FieldInput,
            SelectionPreserver,
        ],
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        editorProps: {
            attributes: { style: 'outline: none; min-height: 100%;' },
        },
        onUpdate: ({ editor: e }) => syncUsedKeys(e),
        onTransaction: ({ editor: e }) => {
            setTick((n) => n + 1)
            const h: HeadingEntry[] = []
            e.state.doc.descendants((node, pos) => {
                if (node.type.name === 'heading') h.push({ level: node.attrs.level as number, text: node.textContent, pos })
            })
            setHeadings(h)
            // Dirty reconciled by the mandatorySet+formName useEffect below — which runs
            // on every layout transaction via the tick state. Here we just track structure.
        },
        immediatelyRender: false,
    })

    useEffect(() => {
        if (!editor) return
        editor.setEditable(!preview)
        // Dispatch preview decoration change — decoration updates are guaranteed
        // to trigger node view re-renders (unlike setEditable alone)
        editor.view.dispatch(editor.state.tr.setMeta(fieldInputPreviewKey, preview))
    }, [editor, preview])

    // Reset preview field values + bump the App_ContractFiller session key each time
    // the user enters preview mode — gives a fresh filler session over the latest layout.
    useEffect(() => {
        if (preview) {
            setPreviewValues({})
            setPreviewSessionKey((k) => k + 1)
        }
    }, [preview])

    useEffect(() => {
        if (editor) (editor.storage as Record<string, any>).fieldInput.choicesMap = choicesMap
    }, [editor, choicesMap])

    // 3-state setter with app-side mutual exclusivity (HR ⊥ MANDATORY).
    const setFieldState = useCallback((key: string, nextState: 'hr' | 'mandatory' | 'optional') => {
        setMandatorySet((prev) => {
            const next = new Set(prev)
            if (nextState === 'mandatory') next.add(key)
            else next.delete(key)
            return next
        })
        setHrSet((prev) => {
            const next = new Set(prev)
            if (nextState === 'hr') next.add(key)
            else next.delete(key)
            return next
        })
    }, [])

    // Field state + toggle callback are provided to FieldInput node-views via FieldRendererContext
    // (wrapped around EditorContent below). Context changes reliably re-render React NodeViews —
    // storage mutation + decoration bumps don't, which caused the earlier sync bugs.
    const fieldRendererContextValue = useMemo<FieldRendererContextValue>(
        () => ({
            hrSet,
            mandatorySet,
            mode: 'fill',
            isBuilder: true,
            onToggleState: setFieldState,
        }),
        [hrSet, mandatorySet, setFieldState],
    )

    // When a column is deleted upstream, remove any FieldInput nodes from the editor that
    // reference it. Targeted cleanup — preserves all other unsaved edits.
    const validKeysRef = useRef<Set<string> | null>(null)
    useEffect(() => {
        if (!editor) return
        const newKeys = new Set<string>([
            ...UNIVERSAL_FIELDS.map((f) => f.key),
            ...qColumns.columns.map((c) => c.id),
        ])

        if (validKeysRef.current === null) {
            validKeysRef.current = newKeys
            return
        }

        const removedKeys: string[] = []
        for (const k of validKeysRef.current) if (!newKeys.has(k)) removedKeys.push(k)
        validKeysRef.current = newKeys

        if (removedKeys.length === 0) return

        const removals: Array<[number, number]> = []
        editor.state.doc.descendants((node, pos) => {
            if (
                node.type.name === 'fieldInput' &&
                removedKeys.includes(node.attrs.fieldKey as string)
            ) {
                removals.push([pos, pos + node.nodeSize])
            }
        })
        if (removals.length === 0) return

        const tr = editor.state.tr
        // Apply in reverse so earlier positions stay valid
        for (let i = removals.length - 1; i >= 0; i--) {
            tr.delete(removals[i]![0], removals[i]![1])
        }
        editor.view.dispatch(tr)

        // Prune removed keys from both sets too
        const pruneBy = (prev: Set<string>) => {
            const next = new Set(prev)
            for (const k of removedKeys) next.delete(k)
            return next
        }
        setMandatorySet(pruneBy)
        setHrSet(pruneBy)
    }, [editor, qColumns.columns])

    // Unified dirty check — runs on every transaction (via tick), field-state/name changes
    useEffect(() => {
        if (!editor) return
        const mandatoryChanged = JSON.stringify([...mandatorySet].sort()) !== initialStateRef.current.mandatory
        const hrChanged = JSON.stringify([...hrSet].sort()) !== initialStateRef.current.hr
        const attachmentChanged = JSON.stringify([...attachmentSet].sort()) !== initialStateRef.current.attachment
        const layoutChanged = JSON.stringify(editor.getJSON()) !== initialStateRef.current.layout
        const nameChanged = formName !== initialStateRef.current.name
        const kindChanged = kind !== initialStateRef.current.kind
        const pdfPathChanged = pdfFilePath !== initialStateRef.current.pdfFilePath
        const pdfLayoutChanged = JSON.stringify(pdfLayout) !== initialStateRef.current.pdfLayout
        const hasPendingPdfUpload = pendingPdfFile !== null
        setIsDirty(
            mandatoryChanged || hrChanged || attachmentChanged || layoutChanged || nameChanged
            || kindChanged || pdfPathChanged || pdfLayoutChanged || hasPendingPdfUpload,
        )
    }, [editor, mandatorySet, hrSet, attachmentSet, formName, tick, kind, pdfFilePath, pdfLayout, pendingPdfFile])

    // Combined "used" set — a key counts as used when it's either in the layout body
    // (TipTap kind), in the PDF positioned-fields layout (PDF kind), or in the
    // attachments panel. Powers the palette's grayed-out state + the prune logic below.
    const effectiveUsedKeys = useMemo(() => {
        const pdfKeys = kind === 'pdf' ? pdfLayout.map((f) => f.key) : []
        return new Set([...usedKeys, ...attachmentSet, ...pdfKeys])
    }, [usedKeys, attachmentSet, kind, pdfLayout])

    // Prune mandatorySet + hrSet when a field is removed (either from the layout
    // or the attachments panel). Re-adding it later shouldn't carry old state.
    useEffect(() => {
        const pruneUnused = (prev: Set<string>) => {
            let changed = false
            const next = new Set<string>()
            for (const k of prev) {
                if (effectiveUsedKeys.has(k)) next.add(k)
                else changed = true
            }
            return changed ? next : prev
        }
        setMandatorySet(pruneUnused)
        setHrSet(pruneUnused)
    }, [effectiveUsedKeys])

    // Delete key removes selected rows/cols; Backspace only clears content (default)
    useEffect(() => {
        if (!editor) return
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Delete' || e.ctrlKey || e.metaKey) return
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sel = editor.state.selection as any
            if (typeof sel.isRowSelection !== 'function') return
            if (sel.isRowSelection()) {
                e.preventDefault()
                editor.commands.deleteRow()
            } else if (sel.isColSelection()) {
                e.preventDefault()
                editor.commands.deleteColumn()
            }
        }
        editor.view.dom.addEventListener('keydown', handleKeyDown)
        return () => { editor.view.dom.removeEventListener('keydown', handleKeyDown) }
    }, [editor])

    // Hydrate the editor once per modal-open session.
    // The hydratedKey ref guards against re-runs when upstream queries (columns, choices)
    // refetch — those refetches change resolveField's reference and would otherwise
    // re-trigger this effect and wipe the user's unsaved edits.
    // qTemplates.templates stays in deps so the effect can hydrate once templates load.
    const hydratedKeyRef = useRef<string | null>(null)
    const resolveFieldRef = useRef(resolveField)
    resolveFieldRef.current = resolveField

    useEffect(() => {
        if (!open) {
            hydratedKeyRef.current = null
            return
        }
        if (!editor) return

        const sessionKey = formId ?? '__new__'
        if (hydratedKeyRef.current === sessionKey) return

        let resolvedName = ''
        let resolvedMandatory: string[] = []
        let resolvedHr: string[] = []
        let resolvedAttachment: string[] = []
        let resolvedKind: ContractTemplateKind = 'tiptap'
        let resolvedPdfFilePath: string | null = null
        let resolvedPdfLayout: PdfLayout = []
        if (formId) {
            const existing = qTemplates.templates.find((f) => f.id === formId)
            if (!existing) return // wait for templates query to load this form
            resolvedName = existing.name
            resolvedMandatory = (existing.mandatory_field_keys ?? []) as string[]
            resolvedHr = (existing.hr_field_keys ?? []) as string[]
            resolvedAttachment = (existing.attachment_field_keys ?? []) as string[]
            resolvedKind = (existing.type === 'pdf' ? 'pdf' : 'tiptap') as ContractTemplateKind
            resolvedPdfFilePath = existing.pdf_file_path ?? null
            setFormName(existing.name)
            const layout = existing.layout
            if (resolvedKind === 'pdf') {
                // PDF kind: layout is the positioned-fields array. Reset TipTap editor to empty;
                // dirty tracking on TipTap layout naturally noops since baseline matches.
                resolvedPdfLayout = Array.isArray(layout) ? (layout as unknown as PdfLayout) : []
                editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
            } else if (isTipTapLayout(layout)) {
                editor.commands.setContent(layout)
            } else if (Array.isArray(layout) && layout.length > 0) {
                editor.commands.setContent(utils_FormBuilder_migrateLayout(layout as string[][], resolveFieldRef.current))
            } else {
                editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
            }
        } else {
            setFormName('')
            editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
        }
        setMandatorySet(new Set(resolvedMandatory))
        setHrSet(new Set(resolvedHr))
        setAttachmentSet(new Set(resolvedAttachment))
        setKind(resolvedKind)
        setPdfFilePath(resolvedPdfFilePath)
        setPdfLayout(resolvedPdfLayout)
        setPdfScale(1.0)
        setPendingPdfField(null)
        setPendingPdfFile(null)
        setPdfNumPages(0)
        setPdfSelectedKey(null)
        setPreview(false)
        setSearch('')
        setIsDirty(false)
        syncUsedKeys(editor)
        hydratedKeyRef.current = sessionKey
        // Snapshot initial state synchronously — editor.commands.setContent() above is sync,
        // so editor.getJSON() already reflects the new content. Deferring via setTimeout would
        // let the dirty-check effect run against the PREVIOUS template's snapshot, falsely
        // flagging the freshly-loaded template as dirty.
        initialStateRef.current = {
            name: resolvedName,
            layout: JSON.stringify(editor.getJSON()),
            mandatory: JSON.stringify([...resolvedMandatory].sort()),
            hr: JSON.stringify([...resolvedHr].sort()),
            attachment: JSON.stringify([...resolvedAttachment].sort()),
            kind: resolvedKind,
            pdfFilePath: resolvedPdfFilePath,
            pdfLayout: JSON.stringify(resolvedPdfLayout),
        }
    }, [open, formId, qTemplates.templates, editor, syncUsedKeys])

    const handleRestored: App_ContractTemplateVersionsModal_OnRestored = (body) => {
        if (!editor) return
        const restoredKind: ContractTemplateKind = body.type === 'pdf' ? 'pdf' : 'tiptap'
        const restoredPdfFilePath = body.pdf_file_path ?? null
        let restoredPdfLayout: PdfLayout = []
        if (restoredKind === 'pdf') {
            restoredPdfLayout = Array.isArray(body.layout) ? (body.layout as unknown as PdfLayout) : []
            // Reset TipTap editor to empty so dirty-tracking on its layout naturally noops
            editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
        } else {
            editor.commands.setContent(body.layout as JSONContent)
        }
        const restoredMandatory = body.mandatory_field_keys ?? []
        const restoredHr = body.hr_field_keys ?? []
        const restoredAttachment = body.attachment_field_keys ?? []
        setKind(restoredKind)
        setPdfFilePath(restoredPdfFilePath)
        setPdfLayout(restoredPdfLayout)
        setMandatorySet(new Set(restoredMandatory))
        setHrSet(new Set(restoredHr))
        setAttachmentSet(new Set(restoredAttachment))
        setIsDirty(false)
        syncUsedKeys(editor)
        initialStateRef.current = {
            name: formName,
            layout: JSON.stringify(editor.getJSON()),
            mandatory: JSON.stringify([...restoredMandatory].sort()),
            hr: JSON.stringify([...restoredHr].sort()),
            attachment: JSON.stringify([...restoredAttachment].sort()),
            kind: restoredKind,
            pdfFilePath: restoredPdfFilePath,
            pdfLayout: JSON.stringify(restoredPdfLayout),
        }
    }

    // Kind switch — destructive (clears the kind-specific layout). Confirm first.
    const handleKindChange = (next: ContractTemplateKind) => {
        if (next === kind) return
        modal.confirm({
            title: 'Switch template kind?',
            content: (
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                    Switching to <strong>{next === 'pdf' ? 'PDF' : 'Docs'}</strong> will discard your current layout.
                    This is reversible by switching back, but the layout you just made will be lost. Continue?
                </Typography.Paragraph>
            ),
            okText: `Switch to ${next === 'pdf' ? 'PDF' : 'Docs'}`,
            okButtonProps: { danger: true },
            cancelText: 'Cancel',
            onOk: () => {
                setKind(next)
                setPendingPdfField(null) // clear any in-flight click-to-drop
                setPendingPdfFile(null) // discard any unsaved PDF upload
                setPdfNumPages(0)
                setPdfSelectedKey(null)
                if (next === 'pdf') {
                    // Switching to PDF — clear TipTap doc; PDF layout starts empty (HR uploads source PDF in App_PdfFieldEditor)
                    if (editor) editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
                    setPdfLayout([])
                    // pdfFilePath stays null until HR uploads
                } else {
                    // Switching to TipTap — clear PDF layout + file path
                    setPdfLayout([])
                    setPdfFilePath(null)
                }
            },
        })
    }

    const handleNameChange = (name: string) => setFormName(name)

    const insertField = (field: { key: string; label: string; type: string }) => {
        // File-type fields live in the attachment panel rather than positioned on the
        // document — attachments are supporting documents, not body content. Same for
        // both kinds.
        if (field.type === 'file') {
            setAttachmentSet((prev) => (prev.has(field.key) ? prev : new Set([...prev, field.key])))
            return
        }
        // PDF kind: arm a click-to-drop. App_PdfFieldEditor consumes pendingPdfField on
        // page click and clears it via the consumer callback.
        if (kind === 'pdf') {
            setPendingPdfField(field)
            // Mutual exclusivity — only one PDF palette item can be "active" at a time.
            // Arming a drop clears any existing on-page selection.
            setPdfSelectedKey(null)
            return
        }
        editor?.chain().focus().insertContent({
            type: 'fieldInput',
            attrs: { fieldKey: field.key, fieldLabel: field.label, fieldType: field.type },
        }).run()
    }

    // Scroll a PDF page into view *within the PDF scroll container only* — scrollIntoView
    // bubbles to ancestors in some browsers and would also scroll the editor column /
    // modal body, causing the action bar to disappear above the viewport.
    //
    // When `yOffsetPct` is provided, the destination scroll position lands at that
    // percentage down the page — useful for navigating to a specific field whose
    // y_pct we know. With it omitted (e.g. thumbnail click), scroll lands at the top
    // of the page.
    const scrollPdfPageIntoView = (pageNumber: number, yOffsetPct?: number) => {
        const container = document.querySelector('.pdf-scroll-container') as HTMLElement | null
        const pageEl = document.querySelector(`[data-pdf-page="${pageNumber}"]`) as HTMLElement | null
        if (!container || !pageEl) return
        const pageTop = pageEl.offsetTop - container.offsetTop
        const fieldOffset = yOffsetPct !== undefined ? yOffsetPct * pageEl.offsetHeight : 0
        // Small breathing room so the field doesn't sit flush against the container's top edge.
        const topPadding = 8
        container.scrollTo({
            top: Math.max(0, pageTop + fieldOffset - topPadding),
            behavior: 'smooth',
        })
    }

    // Click on a USED field in the palette: navigate to where it currently sits in the
    // form so HR can quickly inspect or adjust it. Branches by kind + by attachment.
    const navigateToField = (field: { key: string; label: string; type: string }) => {
        // Attachment field — scroll the attachment panel into view (same panel for both kinds).
        if (field.type === 'file' && attachmentSet.has(field.key)) {
            document
                .querySelector('[data-attachment-panel]')
                ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            return
        }
        if (kind === 'pdf') {
            const layoutField = pdfLayout.find((lf) => lf.key === field.key)
            if (!layoutField) return
            setPdfSelectedKey(field.key)
            // Mutual exclusivity — selecting an existing field clears any pending drop arm.
            setPendingPdfField(null)
            // Pass the field's y_pct so the scroll lands the field itself near the top of
            // the visible area, not just the top of the page that contains it.
            scrollPdfPageIntoView(layoutField.page, layoutField.y_pct)
            return
        }
        // TipTap kind — find the fieldInput node and scroll to it.
        if (!editor) return
        let nodePos: number | null = null
        editor.state.doc.descendants((node, pos) => {
            if (
                node.type.name === 'fieldInput' &&
                (node.attrs as Record<string, unknown>)?.fieldKey === field.key
            ) {
                nodePos = pos
                return false
            }
            return undefined
        })
        if (nodePos === null) return
        editor.chain().focus().setNodeSelection(nodePos).run()
        const nodeDom = editor.view.nodeDOM(nodePos)
        const el = nodeDom instanceof HTMLElement ? nodeDom : (nodeDom as Node | null)?.parentElement
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }

    const removeAttachment = (key: string) => {
        setAttachmentSet((prev) => {
            if (!prev.has(key)) return prev
            const next = new Set(prev)
            next.delete(key)
            return next
        })
    }

    const handleSave = async () => {
        if (!formName.trim() || !editor || isSaving) return
        setSaving(true)
        try {
        // Layout shape per kind: TipTap doc for tiptap, PdfLayout array for pdf.
        const layout: Json = (kind === 'pdf' ? pdfLayout : editor.getJSON()) as Json
        const mandatory_field_keys = Array.from(mandatorySet)
        const hr_field_keys = Array.from(hrSet)
        const attachment_field_keys = Array.from(attachmentSet)

        // PDF kind with a pending file requires a template_id for the upload's auth.
        // For new templates, we stub-create the row first (empty layout, null pdf_file_path),
        // then upload, then PATCH with the resolved pdf_file_path + final layout. This
        // produces 2 version rows for the first save (stub + final), which is acceptable
        // for the trade-off — HR gets a "type → upload → place → save" UX with no orphan
        // R2 objects on discard (file is held in memory until Save runs).
        if (kind === 'pdf' && pendingPdfFile) {
            let templateIdForUpload = formId
            if (!templateIdForUpload) {
                const stub = await mCreate.mutation.mutateAsync({
                    entity_id: entityId,
                    name: formName.trim(),
                    layout: [] as unknown as Json,
                    type: 'pdf',
                    pdf_file_path: null,
                })
                templateIdForUpload = stub.id
            }
            const uploadResult = await mFileUpload.mutation.mutateAsync({
                resource_type: 'contract_template_pdf',
                contract_template_id: templateIdForUpload,
                file: pendingPdfFile,
            })
            const sb_FromContractTemplates_Update = await supabase
                .from('contract_templates')
                .update({
                    name: formName.trim(),
                    layout,
                    type: 'pdf',
                    pdf_file_path: uploadResult.r2_key,
                    mandatory_field_keys,
                    hr_field_keys,
                    attachment_field_keys,
                })
                .eq('id', templateIdForUpload)
            if (sb_FromContractTemplates_Update.error) throw sb_FromContractTemplates_Update.error
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_templates.all() })
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_template_versions.all() })
            setPendingPdfFile(null)
            setPdfFilePath(uploadResult.r2_key)
            message.success(formId ? "Template updated" : "Template created")
            onClose()
            return
        }

        // Standard path (TipTap kind, OR PDF kind with no pending file change)
        if (formId) {
            await mUpdate.mutation.mutateAsync({
                name: formName.trim(),
                layout,
                type: kind,
                pdf_file_path: kind === 'pdf' ? pdfFilePath : null,
                mandatory_field_keys,
                hr_field_keys,
                attachment_field_keys,
            })
        } else {
            await mCreate.mutation.mutateAsync({
                entity_id: entityId,
                name: formName.trim(),
                layout,
                type: kind,
                pdf_file_path: kind === 'pdf' ? pdfFilePath : null,
                mandatory_field_keys,
                hr_field_keys,
                attachment_field_keys,
            })
        }
        message.success(formId ? "Template updated" : "Template created")
        onClose()
        } finally { setSaving(false) }
    }

    const openSaveAs = () => {
        setSaveAsName(`Copy of ${formName}`)
        setSaveAsOpen(true)
    }

    const handleSaveAs = async () => {
        if (!saveAsName.trim() || !editor) return
        const layout: Json = (kind === 'pdf' ? pdfLayout : editor.getJSON()) as Json
        const mandatory_field_keys = Array.from(mandatorySet)
        const hr_field_keys = Array.from(hrSet)
        const attachment_field_keys = Array.from(attachmentSet)

        // PDF kind with a pending file: stub-create the new template, upload to its scope,
        // then PATCH with full body (same pattern as handleSave). Source PDF is uniquely
        // re-uploaded for the new template under its own R2 path — no shared object.
        if (kind === 'pdf' && pendingPdfFile) {
            const stub = await mCreate.mutation.mutateAsync({
                entity_id: entityId,
                name: saveAsName.trim(),
                layout: [] as unknown as Json,
                type: 'pdf',
                pdf_file_path: null,
            })
            const uploadResult = await mFileUpload.mutation.mutateAsync({
                resource_type: 'contract_template_pdf',
                contract_template_id: stub.id,
                file: pendingPdfFile,
            })
            const sb_FromContractTemplates_Update = await supabase
                .from('contract_templates')
                .update({
                    layout,
                    pdf_file_path: uploadResult.r2_key,
                    mandatory_field_keys,
                    hr_field_keys,
                    attachment_field_keys,
                })
                .eq('id', stub.id)
            if (sb_FromContractTemplates_Update.error) throw sb_FromContractTemplates_Update.error
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_templates.all() })
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_template_versions.all() })
            setSaveAsOpen(false)
            onClose()
            return
        }

        // Standard "Save as new" — copies current kind + layout; for PDF kind without a
        // pending file change, the new template references the same pdf_file_path (R2 has
        // no FK; the source PDF is logically content-addressable across templates until
        // one of them re-uploads).
        await mCreate.mutation.mutateAsync({
            entity_id: entityId,
            name: saveAsName.trim(),
            layout,
            type: kind,
            pdf_file_path: kind === 'pdf' ? pdfFilePath : null,
            mandatory_field_keys,
            hr_field_keys,
            attachment_field_keys,
        })
        setSaveAsOpen(false)
        onClose()
    }

    const handleClose = () => {
        if (!isDirty) { onClose(); return }
        const instance = modal.confirm({
            title: 'Unsaved changes',
            content: 'You have unsaved changes. What would you like to do?',
            okText: 'Save changes',
            cancelText: 'Discard',
            closable: false,
            maskClosable: false,
            onOk: () => handleSave(),
            onCancel: () => onClose(),
            footer: (_, { OkBtn, CancelBtn }) => (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: token.marginXS, flexWrap: 'wrap' }}>
                    <Button onClick={() => instance.destroy()}>Continue editing</Button>
                    <CancelBtn />
                    {formId && <Button onClick={() => { instance.destroy(); openSaveAs() }}>Save as new</Button>}
                    <OkBtn />
                </div>
            ),
        })
    }

    // --- Table hover "+" indicators (row on left, col on top, both can show) ---
    const handleEditorMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!editor || preview) { setRowIndicator(null); setColIndicator(null); return }
        const container = editorAreaRef.current
        if (!container) return

        // Find table near mouse (including margin outside for button access)
        const OUTER_MARGIN = 30
        let table: HTMLTableElement | null = null
        for (const t of container.querySelectorAll('table')) {
            const r = t.getBoundingClientRect()
            if (e.clientX >= r.left - OUTER_MARGIN && e.clientX <= r.right + OUTER_MARGIN &&
                e.clientY >= r.top - OUTER_MARGIN && e.clientY <= r.bottom + OUTER_MARGIN) {
                table = t as HTMLTableElement
                break
            }
        }
        if (!table) { setRowIndicator(null); setColIndicator(null); return }

        const cRect = container.getBoundingClientRect()
        const scrollTop = container.scrollTop
        const scrollLeft = container.scrollLeft
        const tRect = table.getBoundingClientRect()
        const rows = Array.from(table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr'))
        const THRESHOLD = 15

        // Check row borders (bottom edge of each row) — button on LEFT
        let foundRow = false
        for (let i = 0; i < rows.length; i++) {
            const rRect = rows[i]!.getBoundingClientRect()
            if (Math.abs(e.clientY - rRect.bottom) < THRESHOLD) {
                const cell = rows[i]!.querySelector('td, th') as HTMLElement | null
                if (cell) {
                    const y = rRect.bottom - cRect.top + scrollTop
                    setRowIndicator({
                        buttonX: tRect.left - cRect.left + scrollLeft - 14,
                        buttonY: y,
                        lineX: tRect.left - cRect.left + scrollLeft,
                        lineY: y,
                        lineW: tRect.width,
                        lineH: 2,
                        cell,
                    })
                    foundRow = true
                    break
                }
            }
        }
        if (!foundRow) setRowIndicator(null)

        // Check column borders (right edge of each cell in first row) — button on TOP
        let foundCol = false
        if (rows.length > 0) {
            const cells = Array.from(rows[0]!.querySelectorAll('th, td'))
            for (let i = 0; i < cells.length; i++) {
                const cellRect = cells[i]!.getBoundingClientRect()
                if (Math.abs(e.clientX - cellRect.right) < THRESHOLD) {
                    const x = cellRect.right - cRect.left + scrollLeft
                    setColIndicator({
                        buttonX: x,
                        buttonY: tRect.top - cRect.top + scrollTop - 14,
                        lineX: x,
                        lineY: tRect.top - cRect.top + scrollTop,
                        lineW: 2,
                        lineH: tRect.height,
                        cell: cells[i] as HTMLElement,
                    })
                    foundCol = true
                    break
                }
            }
        }
        if (!foundCol) setColIndicator(null)
    }, [editor, preview])

    const handleIndicatorClick = useCallback((indicator: LineIndicator, type: 'row' | 'col') => {
        if (!editor) return
        const pos = editor.view.posAtDOM(indicator.cell, 0)
        editor.commands.setTextSelection(pos)
        if (type === 'row') {
            editor.commands.addRowAfter()
        } else {
            editor.commands.addColumnAfter()
        }
        setRowIndicator(null)
        setColIndicator(null)
    }, [editor])

    const [saving, setSaving] = useState(false)
    const isSaving = saving || mCreate.mutation.isPending || mUpdate.mutation.isPending

    const headingValue = editor?.isActive('heading', { level: 1 }) ? 'h1'
        : editor?.isActive('heading', { level: 2 }) ? 'h2'
            : editor?.isActive('heading', { level: 3 }) ? 'h3'
                : 'paragraph'

    return (
        <>
        <style>{`
            .tiptap table { width: 100%; border-collapse: collapse; margin: ${token.marginSM}px 0; }
            .tiptap th, .tiptap td { border: 1px solid ${token.colorBorderSecondary}; padding: ${token.paddingXS}px ${token.paddingSM}px; min-width: 80px; vertical-align: top; }
            .tiptap th { background: ${token.colorFillQuaternary}; font-weight: 600; }
            .tiptap th p, .tiptap td p { margin: 0; }
            .tiptap .selectedCell { background: ${token.colorPrimaryBg}; }
            .tiptap .selection-preserved { background: ${token.colorPrimaryBg}; border-radius: 2px; }
        `}</style>
        <Modal
            open={open}
            onCancel={handleClose}
            title={formId ? 'Edit Form' : 'Create Form'}
            maskClosable={!isSaving}
            closable={!isSaving}
            footer={
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: token.marginXS }}>
                    <Button onClick={handleClose} disabled={isSaving}>Cancel</Button>
                    {formId && isDirty && <Button onClick={openSaveAs} disabled={isSaving}>Save as new</Button>}
                    <Button type="primary" loading={isSaving} disabled={!formName.trim() || (!isDirty && !!formId)} onClick={handleSave}>
                        {formId ? 'Save' : 'Create'}
                    </Button>
                </div>
            }
            width="80vw"
            styles={{ body: { height: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}
            destroyOnHidden
        >
            {/* Form name + preview toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: token.marginSM, marginBottom: token.marginMD, flexShrink: 0 }}>
                <Typography.Text strong style={{ flexShrink: 0 }}>Form Name:</Typography.Text>
                <Input
                    value={formName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="e.g. Standard Employment Contract"
                    style={{ flex: 1, maxWidth: 400 }}
                />
                <Segmented
                    size="small"
                    value={kind}
                    onChange={(v) => handleKindChange(v as ContractTemplateKind)}
                    options={[
                        { value: 'tiptap', label: 'Docs' },
                        { value: 'pdf', label: 'PDF' },
                    ]}
                    style={{ marginLeft: 'auto' }}
                />
                {kind === 'pdf' && !preview && (
                    <App_PdfZoomControls scale={pdfScale} onScaleChange={setPdfScale} />
                )}
                <Tooltip title={formId ? 'Version history' : 'Save the template first to see history'}>
                    <Button
                        type="text"
                        size="small"
                        icon={<HistoryOutlined />}
                        disabled={!formId}
                        onClick={() => setHistoryOpen(true)}
                    />
                </Tooltip>
                <Segmented
                    size="small"
                    value={preview ? 'preview' : 'edit'}
                    onChange={(v) => setPreview(v === 'preview')}
                    options={[
                        { value: 'edit', icon: <FormOutlined /> },
                        { value: 'preview', icon: <EyeOutlined /> },
                    ]}
                />
            </div>

            {/* Main content area */}
            <div style={{ flex: 1, display: 'flex', gap: token.marginMD, overflow: 'hidden' }}>
                {/* Field palette sidebar */}
                {!preview && (
                    <div style={{
                        width: 300,
                        minWidth: 300,
                        display: 'flex',
                        flexDirection: 'column',
                        borderRight: `1px solid ${token.colorBorderSecondary}`,
                        paddingRight: token.paddingMD,
                        overflow: 'hidden',
                    }}>
                        {/* Available Fields */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                            <div style={{ flexShrink: 0, marginBottom: token.marginXS }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: token.marginXXS }}>
                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Available Fields</Typography.Text>
                                    <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => setFieldManagerOpen(true)} style={{ fontSize: 12, padding: 0, height: 'auto' }}>Add field</Button>
                                </div>
                                <Input
                                    placeholder="Search..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    allowClear
                                />
                            </div>
                            {/* Column header */}
                            <div style={{
                                flexShrink: 0,
                                display: 'grid',
                                gridTemplateColumns: '1fr auto 96px',
                                alignItems: 'center',
                                gap: token.marginXS,
                                padding: `0 ${token.paddingSM}px`,
                                marginBottom: token.marginXXS,
                            }}>
                                <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Label</Typography.Text>
                                <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Type</Typography.Text>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: token.marginXXS }}>
                                    <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fill rule</Typography.Text>
                                    <App_FieldLegendChip />
                                </div>
                            </div>
                            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
                                {availableFields.length === 0 && (
                                    <Typography.Text type="secondary" style={{ fontSize: 12, padding: token.paddingSM }}>
                                        {search ? 'No matching fields' : 'No fields defined'}
                                    </Typography.Text>
                                )}
                                {availableFields.map((f) => {
                                    const isUsed = effectiveUsedKeys.has(f.key)
                                    const fieldState: App_FieldRenderer_State = hrSet.has(f.key)
                                        ? 'hr'
                                        : mandatorySet.has(f.key)
                                            ? 'mandatory'
                                            : 'optional'
                                    // Active when: PDF kind has this field selected on the page,
                                    // OR a click-to-drop is armed for this field. Same visual style
                                    // for both — the palette communicates "this field is the focus
                                    // right now" regardless of whether it's already placed.
                                    const isActive =
                                        (kind === 'pdf' && pdfSelectedKey === f.key) ||
                                        pendingPdfField?.key === f.key
                                    const bg = isActive
                                        ? token.colorPrimaryBg
                                        : !isUsed
                                            ? token.colorBgContainer
                                            : token.colorFillTertiary
                                    const borderColor = isActive
                                        ? token.colorPrimary
                                        : token.colorBorderSecondary
                                    return (
                                        <div
                                            key={f.key}
                                            data-pdf-palette-item
                                            onClick={() => (isUsed ? navigateToField(f) : insertField(f))}
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns: '1fr auto 96px',
                                                alignItems: 'center',
                                                gap: token.marginXS,
                                                padding: `${token.paddingXXS}px ${token.paddingSM}px`,
                                                border: `1px solid ${borderColor}`,
                                                borderRadius: token.borderRadius,
                                                background: bg,
                                                cursor: 'pointer',
                                                userSelect: 'none',
                                            }}
                                        >
                                            <Typography.Text strong ellipsis style={{ fontSize: 13, minWidth: 0 }}>{f.label}</Typography.Text>
                                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>{f.type}</Typography.Text>
                                            {isUsed ? (
                                                <div style={{ justifySelf: 'center' }} onClick={(e) => e.stopPropagation()}>
                                                    <App_FieldStateDropdown
                                                        state={fieldState}
                                                        onChange={(next) => setFieldState(f.key, next)}
                                                    />
                                                </div>
                                            ) : (
                                                <span />
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* Outline column */}
                {!preview && (
                    <div style={{
                        width: 260,
                        minWidth: 260,
                        display: 'flex',
                        flexDirection: 'column',
                        borderRight: `1px solid ${token.colorBorderSecondary}`,
                        paddingRight: token.paddingMD,
                        overflow: 'hidden',
                    }}>
                        <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: token.marginXS, flexShrink: 0 }}>
                            {kind === 'pdf' ? 'Pages' : 'Outline'}
                        </Typography.Text>
                        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                            {kind === 'tiptap' && headings.length === 0 && (
                                <Typography.Text type="secondary" style={{ fontSize: 12, padding: token.paddingSM }}>
                                    Add headings to see outline
                                </Typography.Text>
                            )}
                            {kind === 'tiptap' && headings.map((h, i) => (
                                <div
                                    key={i}
                                    onClick={() => {
                                        editor?.chain().setTextSelection(h.pos + 1).run()
                                        const resolved = editor?.view.domAtPos(h.pos + 1)
                                        if (resolved) {
                                            const el = resolved.node instanceof HTMLElement ? resolved.node : resolved.node.parentElement
                                            el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                                        }
                                    }}
                                    style={{
                                        padding: `${token.paddingXXS}px ${token.paddingXXS}px ${token.paddingXXS}px ${(h.level - 1) * 12 + token.paddingXXS}px`,
                                        cursor: 'pointer',
                                        borderRadius: token.borderRadiusSM,
                                        userSelect: 'none',
                                    }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = token.colorFillQuaternary }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                                >
                                    <Typography.Text
                                        ellipsis
                                        strong={h.level === 1}
                                        style={{ fontSize: h.level === 1 ? 13 : 12, display: 'block' }}
                                    >
                                        {h.text || '(empty heading)'}
                                    </Typography.Text>
                                </div>
                            ))}
                            {kind === 'pdf' && (!pdfFileUrl || pdfNumPages === 0) && (
                                <Typography.Text type="secondary" style={{ fontSize: 12, padding: token.paddingSM }}>
                                    Upload a PDF to see pages
                                </Typography.Text>
                            )}
                            {kind === 'pdf' && pdfFileUrl && pdfNumPages > 0 && (
                                <App_PdfThumbnailList
                                    fileUrl={pdfFileUrl}
                                    numPages={pdfNumPages}
                                    pdfLayout={pdfLayout}
                                    onPageClick={scrollPdfPageIntoView}
                                />
                            )}
                        </div>
                    </div>
                )}

                {/* Editor column: toolbar + editor */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Toolbar — TipTap-specific; hidden when kind=pdf or in preview mode */}
                    {!preview && kind === 'tiptap' && (
                        <div ref={toolbarRef} onMouseDown={(e) => e.preventDefault()} style={{
                            display: 'flex',
                            gap: token.marginXXS,
                            padding: `${token.paddingXXS}px ${token.paddingSM}px`,
                            borderBottom: `1px solid ${token.colorBorderSecondary}`,
                            marginBottom: token.marginSM,
                            flexShrink: 0,
                            flexWrap: 'wrap',
                            alignItems: 'center',
                        }}>
                            <Select
                                size="small"
                                value={headingValue}
                                onChange={(v) => {
                                    if (v === 'paragraph') editor?.chain().focus().setParagraph().run()
                                    else editor?.chain().focus().toggleHeading({ level: parseInt(v.replace('h', '')) as 1 | 2 | 3 }).run()
                                }}
                                options={[
                                    { value: 'paragraph', label: 'Paragraph' },
                                    { value: 'h1', label: 'Heading 1' },
                                    { value: 'h2', label: 'Heading 2' },
                                    { value: 'h3', label: 'Heading 3' },
                                ]}
                                style={{ width: 120 }}
                                popupMatchSelectWidth={false}
                                getPopupContainer={() => toolbarRef.current!}
                            />
                            <Button size="small" type={editor?.isActive('bold') ? 'primary' : 'text'} icon={<BoldOutlined />} onClick={() => editor?.chain().focus().toggleBold().run()} />
                            <Button size="small" type={editor?.isActive('italic') ? 'primary' : 'text'} icon={<ItalicOutlined />} onClick={() => editor?.chain().focus().toggleItalic().run()} />
                            <Button size="small" type={editor?.isActive('underline') ? 'primary' : 'text'} icon={<UnderlineOutlined />} onClick={() => editor?.chain().focus().toggleUnderline().run()} />
                            <Button size="small" type={editor?.isActive('strike') ? 'primary' : 'text'} icon={<StrikethroughOutlined />} onClick={() => editor?.chain().focus().toggleStrike().run()} />
                            <div style={{ width: 1, height: 20, background: token.colorBorderSecondary, margin: `0 ${token.marginXXS}px` }} />
                            <Button size="small" type={editor?.isActive({ textAlign: 'left' }) ? 'primary' : 'text'} icon={<AlignLeftOutlined />} onClick={() => editor?.chain().focus().setTextAlign('left').run()} />
                            <Button size="small" type={editor?.isActive({ textAlign: 'center' }) ? 'primary' : 'text'} icon={<AlignCenterOutlined />} onClick={() => editor?.chain().focus().setTextAlign('center').run()} />
                            <Button size="small" type={editor?.isActive({ textAlign: 'right' }) ? 'primary' : 'text'} icon={<AlignRightOutlined />} onClick={() => editor?.chain().focus().setTextAlign('right').run()} />
                            <Button size="small" type={editor?.isActive({ textAlign: 'justify' }) ? 'primary' : 'text'} icon={<AlignJustify size={14} />} onClick={() => editor?.chain().focus().setTextAlign('justify').run()} />
                            <div style={{ width: 1, height: 20, background: token.colorBorderSecondary, margin: `0 ${token.marginXXS}px` }} />
                            <Button size="small" type={editor?.isActive('bulletList') ? 'primary' : 'text'} icon={<UnorderedListOutlined />} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
                            <Button size="small" type={editor?.isActive('orderedList') ? 'primary' : 'text'} icon={<OrderedListOutlined />} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
                            <Button size="small" type="text" icon={<MinusOutlined />} onClick={() => editor?.chain().focus().setHorizontalRule().run()} />
                            <Dropdown
                                menu={{
                                    items: [
                                        { key: 'insert', label: 'Insert table (3x3)', icon: <PlusOutlined />, onClick: () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
                                        { key: 'delete', label: 'Delete table', icon: <DeleteOutlined />, onClick: () => editor?.chain().focus().deleteTable().run(), disabled: !editor?.can().deleteTable(), danger: true },
                                    ],
                                }}
                                trigger={['click']}
                            >
                                <Button size="small" type={editor?.isActive('table') ? 'primary' : 'text'} icon={<TableOutlined />} />
                            </Dropdown>
                        </div>
                    )}

                    {/* Editor area */}
                    {preview ? (
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                            {kind === 'pdf' ? (
                                <App_ContractFiller
                                    key={previewSessionKey}
                                    kind="pdf"
                                    layout={pdfLayout}
                                    pdfFileUrl={pdfFileUrl}
                                    mode="fill"
                                    fieldValues={previewValues}
                                    onChange={(k, v) => setPreviewValues((prev) => ({ ...prev, [k]: v }))}
                                    columns={qColumns.columns}
                                    choices={qChoices.choices}
                                    mandatoryKeys={Array.from(mandatorySet)}
                                    hrFieldKeys={Array.from(hrSet)}
                                    attachmentFieldKeys={Array.from(attachmentSet)}
                                    fillerRole="hr"
                                    organization_id={organizationId}
                                />
                            ) : editor && (
                                <App_ContractFiller
                                    key={previewSessionKey}
                                    mode="fill"
                                    layout={editor.getJSON() as JSONContent}
                                    fieldValues={previewValues}
                                    onChange={(k, v) => setPreviewValues((prev) => ({ ...prev, [k]: v }))}
                                    columns={qColumns.columns}
                                    choices={qChoices.choices}
                                    mandatoryKeys={Array.from(mandatorySet)}
                                    hrFieldKeys={Array.from(hrSet)}
                                    attachmentFieldKeys={Array.from(attachmentSet)}
                                    fillerRole="hr"
                                    organization_id={organizationId}
                                    /* No uploadContext — composer preview is a peek,
                                       strip renders readonly with "No file" placeholders. */
                                />
                            )}
                        </div>
                    ) : kind === 'pdf' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM, flex: 1, minHeight: 0, overflow: 'hidden' }}>
                            {attachmentSet.size > 0 && (
                                <div data-attachment-panel style={{
                                    flexShrink: 0,
                                    border: `1px solid ${token.colorBorderSecondary}`,
                                    borderRadius: token.borderRadiusLG,
                                    padding: token.paddingSM,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: token.marginXS,
                                }}>
                                    <Typography.Text strong style={{ fontSize: 12 }}>
                                        Attachments ({attachmentSet.size})
                                    </Typography.Text>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXS }}>
                                        {Array.from(attachmentSet).map((key) => {
                                            const field = resolveField(key)
                                            const state: App_FieldRenderer_State = hrSet.has(key)
                                                ? 'hr'
                                                : mandatorySet.has(key)
                                                    ? 'mandatory'
                                                    : 'optional'
                                            return (
                                                <div
                                                    key={key}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: token.marginXS,
                                                        padding: `${token.paddingXXS}px ${token.paddingSM}px`,
                                                        border: `1px solid ${token.colorBorderSecondary}`,
                                                        borderRadius: token.borderRadiusSM,
                                                        background: token.colorBgContainer,
                                                    }}
                                                >
                                                    <PaperClipOutlined style={{ color: token.colorTextSecondary, fontSize: 12 }} />
                                                    <Typography.Text style={{ fontSize: 12 }}>{field.label}</Typography.Text>
                                                    <App_FieldStateDropdown
                                                        state={state}
                                                        onChange={(next) => setFieldState(key, next)}
                                                    />
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        icon={<CloseOutlined />}
                                                        onClick={() => removeAttachment(key)}
                                                    />
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}
                            <App_PdfFieldEditor
                                pdfFileUrl={pdfFileUrl}
                                hasPdf={hasPdf}
                                pdfLayout={pdfLayout}
                                onPdfLayoutChange={setPdfLayout}
                                pdfScale={pdfScale}
                                pendingFieldDrop={pendingPdfField}
                                onPendingFieldDropConsumed={() => setPendingPdfField(null)}
                                onArmFieldDrop={(f) => {
                                    setPendingPdfField(f)
                                    setPdfSelectedKey(null)
                                }}
                                pendingPdfFile={pendingPdfFile}
                                onPendingPdfFileChange={setPendingPdfFile}
                                hrSet={hrSet}
                                mandatorySet={mandatorySet}
                                onFieldStateChange={setFieldState}
                                resolveField={resolveField}
                                onNumPagesChange={setPdfNumPages}
                                selectedKey={pdfSelectedKey}
                                onSelectedKeyChange={setPdfSelectedKey}
                                onNavigateToField={navigateToField}
                            />
                        </div>
                    ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM, flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        {/* Attachments panel — file-type fields live here, not inline in the body.
                           Mirrors where the strip renders at preview / fill time. */}
                        {attachmentSet.size > 0 && (
                            <div data-attachment-panel style={{
                                flexShrink: 0,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                borderRadius: token.borderRadiusLG,
                                padding: token.paddingSM,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: token.marginXS,
                            }}>
                                <Typography.Text strong style={{ fontSize: 12 }}>
                                    Attachments ({attachmentSet.size})
                                </Typography.Text>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXS }}>
                                    {Array.from(attachmentSet).map((key) => {
                                        const field = resolveField(key)
                                        const state: App_FieldRenderer_State = hrSet.has(key)
                                            ? 'hr'
                                            : mandatorySet.has(key)
                                                ? 'mandatory'
                                                : 'optional'
                                        return (
                                            <div
                                                key={key}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: token.marginXS,
                                                    padding: `${token.paddingXXS}px ${token.paddingSM}px`,
                                                    border: `1px solid ${token.colorBorderSecondary}`,
                                                    borderRadius: token.borderRadiusSM,
                                                    background: token.colorBgContainer,
                                                }}
                                            >
                                                <PaperClipOutlined style={{ color: token.colorTextSecondary, fontSize: 12 }} />
                                                <Typography.Text style={{ fontSize: 12 }}>{field.label}</Typography.Text>
                                                <App_FieldStateDropdown
                                                    state={state}
                                                    onChange={(next) => setFieldState(key, next)}
                                                />
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<CloseOutlined />}
                                                    onClick={() => removeAttachment(key)}
                                                />
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                    <div
                    ref={editorAreaRef}
                    onMouseMove={handleEditorMouseMove}
                    onMouseLeave={() => { setRowIndicator(null); setColIndicator(null) }}
                    style={{
                        flex: 1,
                        overflow: 'auto',
                        position: 'relative',
                        border: `1px solid ${token.colorBorderSecondary}`,
                        borderRadius: token.borderRadiusLG,
                        padding: token.paddingMD,
                    }}
                >
                    <div>
                        <FieldRendererContext.Provider value={fieldRendererContextValue}>
                            <EditorContent editor={editor} />
                        </FieldRendererContext.Provider>
                    </div>

                    {/* Table hover "+" indicators — row on left, col on top */}
                    {[
                        rowIndicator && { ind: rowIndicator, type: 'row' as const },
                        colIndicator && { ind: colIndicator, type: 'col' as const },
                    ].filter(Boolean).map((item) => {
                        const { ind, type } = item!
                        return (
                            <div key={type}>
                                <div style={{
                                    position: 'absolute',
                                    top: ind.lineY,
                                    left: ind.lineX,
                                    width: ind.lineW,
                                    height: ind.lineH,
                                    background: token.colorPrimary,
                                    pointerEvents: 'none',
                                    zIndex: 5,
                                }} />
                                <div
                                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleIndicatorClick(ind, type) }}
                                    style={{
                                        position: 'absolute',
                                        top: ind.buttonY - 10,
                                        left: ind.buttonX - 10,
                                        width: 20,
                                        height: 20,
                                        borderRadius: '50%',
                                        background: token.colorPrimary,
                                        color: token.colorWhite,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        zIndex: 10,
                                        fontSize: 14,
                                        fontWeight: 700,
                                        lineHeight: 1,
                                        boxShadow: token.boxShadow,
                                    }}
                                >
                                    +
                                </div>
                            </div>
                        )
                    })}
                </div>
                    </div>
                )}
                </div>
            </div>

            <App_EmployeeFieldComposerModal
                open={fieldManagerOpen}
                onClose={() => setFieldManagerOpen(false)}
                entityId={entityId}
            />

            <App_ContractTemplateVersionsModal
                open={historyOpen}
                onClose={() => setHistoryOpen(false)}
                templateId={formId ?? ''}
                organizationId={organizationId}
                onRestored={handleRestored}
            />

            <Modal
                open={saveAsOpen}
                onCancel={() => setSaveAsOpen(false)}
                title="Save as new form"
                okText="Save as new"
                onOk={handleSaveAs}
                confirmLoading={mCreate.mutation.isPending}
                okButtonProps={{ disabled: !saveAsName.trim() }}
                destroyOnHidden
            >
                <div style={{ marginTop: token.marginSM }}>
                    <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXXS }}>New form name</Typography.Text>
                    <Input
                        value={saveAsName}
                        onChange={(e) => setSaveAsName(e.target.value)}
                        placeholder="Enter a name for the new form"
                        onPressEnter={handleSaveAs}
                        autoFocus
                    />
                </div>
            </Modal>
        </Modal>
        </>
    )
}
