import { createContext, useContext } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { Typography, theme } from 'antd'
import { App_FieldStateDropdown } from './App_FieldStateDropdown'

export const fieldInputPreviewKey = new PluginKey('fieldInputPreview')

export type FieldRendererContext_Mode = 'fill' | 'readonly'
export type FieldRendererContext_State = 'hr' | 'mandatory' | 'optional'

export type FieldRendererContextValue = {
    hrSet: Set<string>
    mandatorySet: Set<string>
    mode: FieldRendererContext_Mode
    isBuilder: boolean
    onToggleState?: (key: string, nextState: FieldRendererContext_State) => void
}

export const FieldRendererContext = createContext<FieldRendererContextValue>({
    hrSet: new Set<string>(),
    mandatorySet: new Set<string>(),
    mode: 'readonly',
    isBuilder: false,
})

const resolveState = (key: string, hrSet: Set<string>, mandatorySet: Set<string>): FieldRendererContext_State => {
    if (hrSet.has(key)) return 'hr'
    if (mandatorySet.has(key)) return 'mandatory'
    return 'optional'
}

const stateAccentColor = (state: FieldRendererContext_State, token: ReturnType<typeof theme.useToken>['token']) => {
    if (state === 'hr') return token.colorInfo
    if (state === 'mandatory') return token.colorError
    return token.colorBorder
}

const FieldInputComponent = ({ node, editor }: ReactNodeViewProps) => {
    const { token } = theme.useToken()
    const isPreview = !editor.isEditable
    const { fieldKey, fieldLabel, fieldType } = node.attrs as { fieldKey: string; fieldLabel: string; fieldType: string }
    const storage = (editor.storage as Record<string, any>).fieldInput || {}
    const { hrSet, mandatorySet, isBuilder, onToggleState } = useContext(FieldRendererContext)
    const state = resolveState(fieldKey, hrSet, mandatorySet)

    if (isPreview) {
        // Defensive: post-AHR-1791 templates keep file fields out of the layout
        // entirely (attachments panel in the builder). This branch only fires for
        // legacy invitation snapshots that were frozen before the backfill ran —
        // they still carry file-type fieldInput nodes in their template_snapshot.
        // Showing `(see attachments)` keeps the body readable in those old
        // invitations instead of leaking raw file_id strings into the prose.
        if (fieldType === 'file') {
            return (
                <NodeViewWrapper as="span" style={{ verticalAlign: 'baseline' }}>
                    <Typography.Text italic style={{ color: token.colorTextTertiary, fontSize: token.fontSizeSM }}>
                        (see attachments)
                    </Typography.Text>
                </NodeViewWrapper>
            )
        }

        const choicesMap = (storage.choicesMap || {}) as Record<string, Array<{ label: string; value: string }>>
        const choices = choicesMap[fieldKey] || []
        const values = (storage.values || {}) as Record<string, unknown>
        const value = values[fieldKey]
        const hasValue = value !== undefined && value !== '' && value !== null

        // Resolve display text for select fields
        const displayText = (() => {
            if (!hasValue) return null
            if (fieldType === 'boolean') return value ? 'Yes' : 'No'
            if (fieldType === 'multi_select') {
                const match = choices.find((c) => c.value === value)
                return match?.label ?? String(value)
            }
            return String(value)
        })()

        // Plain inline rendering — value flows in the sentence with no chip or background.
        // State indicators live on the fill card, not inline, so the contract body stays readable.
        // Filled values get `colorPrimary` so they're visually distinct from the static contract
        // prose; empty fields render as italic muted placeholder.
        if (hasValue) {
            return (
                <NodeViewWrapper as="span" style={{ verticalAlign: 'baseline' }}>
                    <Typography.Text style={{ color: token.colorPrimary, fontWeight: 500 }}>
                        {displayText}
                    </Typography.Text>
                </NodeViewWrapper>
            )
        }
        return (
            <NodeViewWrapper as="span" style={{ verticalAlign: 'baseline' }}>
                <Typography.Text italic style={{ color: token.colorTextPlaceholder, fontSize: token.fontSizeSM }}>
                    [{fieldLabel}]
                </Typography.Text>
            </NodeViewWrapper>
        )
    }

    const accentColor = stateAccentColor(state, token)

    return (
        <NodeViewWrapper
            as="span"
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: `1px ${token.paddingXS}px`,
                border: `1px solid ${token.colorBorder}`,
                borderLeft: `3px solid ${accentColor}`,
                borderRadius: token.borderRadiusSM,
                verticalAlign: 'baseline',
                lineHeight: '1.6',
                cursor: 'default',
                userSelect: 'none',
            }}
        >
            <Typography.Text style={{ fontSize: token.fontSizeSM }}>{fieldLabel}</Typography.Text>
            <Typography.Text style={{ fontSize: 10, color: token.colorTextTertiary }}>{fieldType}</Typography.Text>
            {isBuilder && onToggleState && (
                <App_FieldStateDropdown
                    state={state}
                    onChange={(nextState) => onToggleState(fieldKey, nextState)}
                />
            )}
        </NodeViewWrapper>
    )
}

export const FieldInput = Node.create({
    name: 'fieldInput',
    group: 'inline',
    inline: true,
    atom: true,

    addStorage() {
        return { choicesMap: {} as Record<string, Array<{ label: string; value: string }>> }
    },

    addAttributes() {
        return {
            fieldKey: { default: '' },
            fieldLabel: { default: '' },
            fieldType: { default: '' },
        }
    },

    parseHTML() {
        return [{
            tag: 'span[data-field-input]',
            getAttrs: (dom: HTMLElement) => ({
                fieldKey: dom.getAttribute('data-field-key'),
                fieldLabel: dom.getAttribute('data-field-label'),
                fieldType: dom.getAttribute('data-field-type'),
            }),
        }]
    },

    renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, string> }) {
        return ['span', mergeAttributes({
            'data-field-input': '',
            'data-field-key': HTMLAttributes.fieldKey,
            'data-field-label': HTMLAttributes.fieldLabel,
            'data-field-type': HTMLAttributes.fieldType,
        }), `[${HTMLAttributes.fieldLabel}]`]
    },

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: fieldInputPreviewKey,
                state: {
                    init: () => ({ version: 0, preview: false as boolean }),
                    apply: (tr, prev) => {
                        const meta = tr.getMeta(fieldInputPreviewKey)
                        if (meta === undefined) return prev
                        const nextVersion = prev.version + 1
                        if (meta === false) return { version: nextVersion, preview: false }
                        if (meta === true) return { version: nextVersion, preview: true }
                        if (typeof meta === 'number') return { version: meta, preview: true }
                        return prev
                    },
                },
                props: {
                    decorations: (state) => {
                        const pluginState = fieldInputPreviewKey.getState(state) as { version: number; preview: boolean }
                        const decos: Decoration[] = []
                        state.doc.descendants((node, pos) => {
                            if (node.type.name === 'fieldInput') {
                                const cls = pluginState.preview
                                    ? `field-preview v${pluginState.version}`
                                    : `field-edit v${pluginState.version}`
                                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: cls }))
                            }
                        })
                        return DecorationSet.create(state.doc, decos)
                    },
                },
            }),
        ]
    },

    addNodeView() {
        return ReactNodeViewRenderer(FieldInputComponent, {
            stopEvent: ({ event }) => !!((event.target as HTMLElement).closest?.('input, textarea, .ant-select, .ant-picker, .ant-switch, .ant-input-number, .ant-tag, .ant-dropdown-trigger')),
        })
    },
})
