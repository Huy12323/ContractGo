import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { Typography, theme } from 'antd'

export const fieldInputPreviewKey = new PluginKey('fieldInputPreview')

const FieldInputComponent = ({ node, editor }: ReactNodeViewProps) => {
    const { token } = theme.useToken()
    const isPreview = !editor.isEditable

    if (isPreview) {
        const { fieldKey, fieldLabel, fieldType } = node.attrs as { fieldKey: string; fieldLabel: string; fieldType: string }
        const storage = (editor.storage as Record<string, any>).fieldInput || {}
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

        return (
            <NodeViewWrapper
                as="span"
                style={{
                    display: 'inline-block',
                    verticalAlign: 'baseline',
                    margin: '0 2px',
                    padding: `0 ${token.paddingXS}px`,
                    borderRadius: token.borderRadiusXS,
                    fontSize: token.fontSizeSM,
                    lineHeight: '1.6',
                    ...(hasValue
                        ? { background: token.colorSuccessBg, border: `1px solid ${token.colorSuccessBorder}`, color: token.colorSuccess }
                        : { background: token.colorFillTertiary, border: `1px dashed ${token.colorBorder}`, color: token.colorTextPlaceholder }),
                }}
            >
                {displayText ?? fieldLabel}
            </NodeViewWrapper>
        )
    }

    return (
        <NodeViewWrapper
            as="span"
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: `1px ${token.paddingXS}px`,
                border: `1px solid ${token.colorPrimaryBorder}`,
                borderLeft: `3px solid ${token.colorPrimary}`,
                borderRadius: token.borderRadiusSM,
                background: token.colorPrimaryBg,
                verticalAlign: 'baseline',
                lineHeight: '1.6',
                cursor: 'default',
                userSelect: 'none',
            }}
        >
            <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorPrimaryText }}>{node.attrs.fieldLabel}</Typography.Text>
            <Typography.Text style={{ fontSize: 10, color: token.colorPrimaryBorderHover }}>{node.attrs.fieldType}</Typography.Text>
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
                    init: () => 0 as number | false,
                    apply: (tr, prev) => {
                        const meta = tr.getMeta(fieldInputPreviewKey)
                        if (meta === false) return false
                        if (meta !== undefined) return typeof meta === 'number' ? meta : (typeof prev === 'number' ? prev + 1 : 1)
                        return prev
                    },
                },
                props: {
                    decorations: (state) => {
                        const pluginState = fieldInputPreviewKey.getState(state) as number | false
                        const isPreview = pluginState !== false
                        const decos: Decoration[] = []
                        state.doc.descendants((node, pos) => {
                            if (node.type.name === 'fieldInput') {
                                decos.push(Decoration.node(pos, pos + node.nodeSize, {
                                    class: isPreview ? `field-preview v${pluginState}` : 'field-edit',
                                }))
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
            stopEvent: ({ event }) => !!((event.target as HTMLElement).closest?.('input, textarea, .ant-select, .ant-picker, .ant-switch, .ant-input-number')),
        })
    },
})
