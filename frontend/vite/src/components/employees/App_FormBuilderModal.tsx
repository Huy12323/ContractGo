import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Modal, Input, Button, Typography, Segmented, Select, Dropdown, App, theme, Tooltip } from 'antd'
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
import type { Json } from '@/types/database.types'

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
    formId: string | null
}

export const App_FormBuilderModal = ({ open, onClose, organizationId, formId }: Props) => {
    const { token } = theme.useToken()
    const { modal } = App.useApp()
    const qTemplates = useQ_Tables_ContractTemplates({ organizationId })
    const qColumns = useQ_Tables_EmployeeColumns({ organizationId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ organizationId })
    const mCreate = useM_ContractTemplate_Create()
    const mUpdate = useM_ContractTemplate_Update({ templateId: formId ?? '' })

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
    const initialStateRef = useRef<{ name: string; layout: string; mandatory: string; hr: string; attachment: string }>({ name: '', layout: '', mandatory: '[]', hr: '[]', attachment: '[]' })
    const [isDirty, setIsDirty] = useState(false)
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
        setIsDirty(mandatoryChanged || hrChanged || attachmentChanged || layoutChanged || nameChanged)
    }, [editor, mandatorySet, hrSet, attachmentSet, formName, tick])

    // Combined "used" set — a key counts as used when it's either in the layout body
    // OR in the attachments panel. Powers the palette's grayed-out state + the prune
    // logic below.
    const effectiveUsedKeys = useMemo(
        () => new Set([...usedKeys, ...attachmentSet]),
        [usedKeys, attachmentSet],
    )

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
        if (formId) {
            const existing = qTemplates.templates.find((f) => f.id === formId)
            if (!existing) return // wait for templates query to load this form
            resolvedName = existing.name
            resolvedMandatory = (existing.mandatory_field_keys ?? []) as string[]
            resolvedHr = (existing.hr_field_keys ?? []) as string[]
            resolvedAttachment = (existing.attachment_field_keys ?? []) as string[]
            setFormName(existing.name)
            const layout = existing.layout
            if (isTipTapLayout(layout)) {
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
        }
    }, [open, formId, qTemplates.templates, editor, syncUsedKeys])

    const handleRestored: App_ContractTemplateVersionsModal_OnRestored = (body) => {
        if (!editor) return
        editor.commands.setContent(body.layout)
        const restoredMandatory = body.mandatory_field_keys ?? []
        const restoredHr = body.hr_field_keys ?? []
        const restoredAttachment = body.attachment_field_keys ?? []
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
        }
    }

    const handleNameChange = (name: string) => setFormName(name)

    const insertField = (field: { key: string; label: string; type: string }) => {
        // File-type fields live in the attachment panel (above the editor) rather
        // than inline in the TipTap body — attachments are supporting documents, not
        // body content. Non-file fields keep the existing cursor-insert behavior.
        if (field.type === 'file') {
            setAttachmentSet((prev) => (prev.has(field.key) ? prev : new Set([...prev, field.key])))
            return
        }
        editor?.chain().focus().insertContent({
            type: 'fieldInput',
            attrs: { fieldKey: field.key, fieldLabel: field.label, fieldType: field.type },
        }).run()
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
        if (!formName.trim() || !editor) return
        const layout: Json = editor.getJSON() as Json
        const mandatory_field_keys = Array.from(mandatorySet)
        const hr_field_keys = Array.from(hrSet)
        const attachment_field_keys = Array.from(attachmentSet)
        if (formId) {
            await mUpdate.mutation.mutateAsync({ name: formName.trim(), layout, mandatory_field_keys, hr_field_keys, attachment_field_keys })
        } else {
            await mCreate.mutation.mutateAsync({ organization_id: organizationId, name: formName.trim(), layout, mandatory_field_keys, hr_field_keys, attachment_field_keys })
        }
        onClose()
    }

    const openSaveAs = () => {
        setSaveAsName(`Copy of ${formName}`)
        setSaveAsOpen(true)
    }

    const handleSaveAs = async () => {
        if (!saveAsName.trim() || !editor) return
        const layout: Json = editor.getJSON() as Json
        const mandatory_field_keys = Array.from(mandatorySet)
        const hr_field_keys = Array.from(hrSet)
        const attachment_field_keys = Array.from(attachmentSet)
        await mCreate.mutation.mutateAsync({ organization_id: organizationId, name: saveAsName.trim(), layout, mandatory_field_keys, hr_field_keys, attachment_field_keys })
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

    const isSaving = mCreate.mutation.isPending || mUpdate.mutation.isPending

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
            footer={
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: token.marginXS }}>
                    <Button onClick={handleClose}>Cancel</Button>
                    {formId && isDirty && <Button onClick={openSaveAs}>Save as new</Button>}
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
                <Tooltip title={formId ? 'Version history' : 'Save the template first to see history'}>
                    <Button
                        type="text"
                        size="small"
                        icon={<HistoryOutlined />}
                        disabled={!formId}
                        onClick={() => setHistoryOpen(true)}
                        style={{ marginLeft: 'auto' }}
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
                                    const bg = !isUsed ? token.colorBgContainer : token.colorFillTertiary
                                    const borderColor = token.colorBorderSecondary
                                    return (
                                        <div
                                            key={f.key}
                                            onClick={isUsed ? undefined : () => insertField(f)}
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns: '1fr auto 96px',
                                                alignItems: 'center',
                                                gap: token.marginXS,
                                                padding: `${token.paddingXXS}px ${token.paddingSM}px`,
                                                border: `1px solid ${borderColor}`,
                                                borderRadius: token.borderRadius,
                                                background: bg,
                                                cursor: isUsed ? 'default' : 'pointer',
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
                            Outline
                        </Typography.Text>
                        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                            {headings.length === 0 && (
                                <Typography.Text type="secondary" style={{ fontSize: 12, padding: token.paddingSM }}>
                                    Add headings to see outline
                                </Typography.Text>
                            )}
                            {headings.map((h, i) => (
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
                        </div>
                    </div>
                )}

                {/* Editor column: toolbar + editor */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Toolbar — preventDefault keeps editor focused so selection stays visible */}
                    {!preview && (
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
                            {editor && (
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
                    ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM, flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        {/* Attachments panel — file-type fields live here, not inline in the body.
                           Mirrors where the strip renders at preview / fill time. */}
                        {attachmentSet.size > 0 && (
                            <div style={{
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
                organizationId={organizationId}
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
