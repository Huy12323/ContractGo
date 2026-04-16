import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Modal, Input, Button, Typography, Segmented, Select, Dropdown, App, theme } from 'antd'
import {
    AlignCenterOutlined,
    AlignLeftOutlined,
    AlignRightOutlined,
    BoldOutlined,
    DeleteOutlined,
    ItalicOutlined,
    MinusOutlined,
    OrderedListOutlined,
    PlusOutlined,
    StrikethroughOutlined,
    TableOutlined,
    UnderlineOutlined,
    UnorderedListOutlined,
    EyeOutlined,
    FormOutlined,
} from '@ant-design/icons'
import { AlignJustify } from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
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
import { FieldInput, fieldInputPreviewKey } from './ext_TipTap_FieldInput'
import { App_ContractPreview } from './App_ContractPreview'
import { App_EmployeeFieldComposerModal } from './App_EmployeeFieldComposerModal'
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
    const [, setTick] = useState(0)
    const [headings, setHeadings] = useState<HeadingEntry[]>([])
    const initialStateRef = useRef<{ name: string; layout: string }>({ name: '', layout: '' })
    const [isDirty, setIsDirty] = useState(false)
    const [saveAsOpen, setSaveAsOpen] = useState(false)
    const [saveAsName, setSaveAsName] = useState('')
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
        const unused = allFields.filter((f) => !usedKeys.has(f.key))
        if (!search.trim()) return unused
        const q = search.toLowerCase()
        return unused.filter((f) => f.label.toLowerCase().includes(q) || f.type.toLowerCase().includes(q))
    }, [allFields, usedKeys, search])

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
            const currentLayout = JSON.stringify(e.getJSON())
            setIsDirty(currentLayout !== initialStateRef.current.layout)
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

    useEffect(() => {
        if (editor) (editor.storage as Record<string, any>).fieldInput.choicesMap = choicesMap
    }, [editor, choicesMap])

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
    }, [editor, qColumns.columns])

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
        if (formId) {
            const existing = qTemplates.templates.find((f) => f.id === formId)
            if (!existing) return // wait for templates query to load this form
            resolvedName = existing.name
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
        setPreview(false)
        setSearch('')
        setIsDirty(false)
        syncUsedKeys(editor)
        hydratedKeyRef.current = sessionKey
        // Snapshot initial state after content is set
        setTimeout(() => {
            initialStateRef.current = { name: resolvedName, layout: JSON.stringify(editor.getJSON()) }
        }, 0)
    }, [open, formId, qTemplates.templates, editor, syncUsedKeys])

    const handleNameChange = (name: string) => {
        setFormName(name)
        const layoutChanged = editor ? JSON.stringify(editor.getJSON()) !== initialStateRef.current.layout : false
        setIsDirty(name !== initialStateRef.current.name || layoutChanged)
    }

    const insertField = (field: { key: string; label: string; type: string }) => {
        editor?.chain().focus().insertContent({
            type: 'fieldInput',
            attrs: { fieldKey: field.key, fieldLabel: field.label, fieldType: field.type },
        }).run()
    }

    const handleSave = async () => {
        if (!formName.trim() || !editor) return
        const layout: Json = editor.getJSON() as Json
        if (formId) {
            await mUpdate.mutation.mutateAsync({ name: formName.trim(), layout })
        } else {
            await mCreate.mutation.mutateAsync({ organization_id: organizationId, name: formName.trim(), layout })
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
        await mCreate.mutation.mutateAsync({ organization_id: organizationId, name: saveAsName.trim(), layout })
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
                <Segmented
                    size="small"
                    value={preview ? 'preview' : 'edit'}
                    onChange={(v) => setPreview(v === 'preview')}
                    options={[
                        { value: 'edit', icon: <FormOutlined /> },
                        { value: 'preview', icon: <EyeOutlined /> },
                    ]}
                    style={{ marginLeft: 'auto' }}
                />
            </div>

            {/* Main content area */}
            <div style={{ flex: 1, display: 'flex', gap: token.marginMD, overflow: 'hidden' }}>
                {/* Field palette sidebar */}
                {!preview && (
                    <div style={{
                        width: 220,
                        minWidth: 220,
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
                            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
                                {availableFields.length === 0 && (
                                    <Typography.Text type="secondary" style={{ fontSize: 12, padding: token.paddingSM }}>
                                        {search ? 'No matching fields' : 'All fields are in use'}
                                    </Typography.Text>
                                )}
                                {availableFields.map((f) => (
                                    <div
                                        key={f.key}
                                        onClick={() => insertField(f)}
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            padding: `${token.paddingXXS}px ${token.paddingSM}px`,
                                            border: `1px solid ${token.colorBorderSecondary}`,
                                            borderRadius: token.borderRadius,
                                            background: token.colorBgContainer,
                                            cursor: 'pointer',
                                            userSelect: 'none',
                                        }}
                                    >
                                        <Typography.Text strong ellipsis style={{ fontSize: 13 }}>{f.label}</Typography.Text>
                                        <Typography.Text type="secondary" style={{ fontSize: 11, flexShrink: 0, marginLeft: token.marginXS }}>{f.type}</Typography.Text>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Divider */}
                        <div style={{ flexShrink: 0, margin: `${token.marginSM}px 0`, borderTop: `2px solid ${token.colorBorderSecondary}`, position: 'relative' }}>
                            <Typography.Text
                                type="secondary"
                                style={{
                                    fontSize: 11,
                                    position: 'absolute',
                                    top: -9,
                                    left: 0,
                                    background: token.colorBgElevated,
                                    paddingRight: token.paddingXS,
                                    textTransform: 'uppercase',
                                    letterSpacing: 0.5,
                                }}
                            >
                                Outline
                            </Typography.Text>
                        </div>

                        {/* Document Outline */}
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
                            <App_ContractPreview editor={editor} />
                        </div>
                    ) : (
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
                        <EditorContent editor={editor} />
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
                )}
                </div>
            </div>

            <App_EmployeeFieldComposerModal
                open={fieldManagerOpen}
                onClose={() => setFieldManagerOpen(false)}
                organizationId={organizationId}
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
