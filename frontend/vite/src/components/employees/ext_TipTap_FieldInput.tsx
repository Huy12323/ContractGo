import { createContext, useContext } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { Typography, theme } from 'antd'
import { Asterisk } from 'lucide-react'

export const fieldInputPreviewKey = new PluginKey('fieldInputPreview')

export type FieldInputContextValue = {
    mandatorySet: Set<string>
    isBuilder: boolean
    onToggleMandatory?: (key: string) => void
}

export const FieldInputContext = createContext<FieldInputContextValue>({
    mandatorySet: new Set<string>(),
    isBuilder: false,
})

const FieldInputComponent = ({ node, editor }: ReactNodeViewProps) => {
    const { token } = theme.useToken()
    const isPreview = !editor.isEditable
    const { fieldKey, fieldLabel, fieldType } = node.attrs as { fieldKey: string; fieldLabel: string; fieldType: string }
    const storage = (editor.storage as Record<string, any>).fieldInput || {}
    const { mandatorySet, isBuilder, onToggleMandatory } = useContext(FieldInputContext)
    const isMandatory = mandatorySet.has(fieldKey)

    if (isPreview) {
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
                {isMandatory && (
                    <span style={{
                        color: token.colorError,
                        marginLeft: 3,
                        fontWeight: 'bold',
                        fontSize: token.fontSize,
                    }}>*</span>
                )}
            </NodeViewWrapper>
        )
    }

    const labelColor = isMandatory ? token.colorErrorText : token.colorPrimaryText
    const typeColor = isMandatory ? token.colorErrorTextHover : token.colorPrimaryBorderHover
    const borderColor = isMandatory ? token.colorErrorBorder : token.colorPrimaryBorder
    const accentColor = isMandatory ? token.colorError : token.colorPrimary
    const bgColor = isMandatory ? token.colorErrorBg : token.colorPrimaryBg

    return (
        <NodeViewWrapper
            as="span"
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: `1px ${token.paddingXS}px`,
                border: `1px solid ${borderColor}`,
                borderLeft: `3px solid ${accentColor}`,
                borderRadius: token.borderRadiusSM,
                background: bgColor,
                verticalAlign: 'baseline',
                lineHeight: '1.6',
                cursor: 'default',
                userSelect: 'none',
            }}
        >
            <Typography.Text style={{ fontSize: token.fontSizeSM, color: labelColor }}>{node.attrs.fieldLabel}</Typography.Text>
            <Typography.Text style={{ fontSize: 10, color: typeColor }}>{node.attrs.fieldType}</Typography.Text>
            {isBuilder && onToggleMandatory && (
                <span
                    role="button"
                    title={isMandatory ? 'Required — click to make optional' : 'Click to mark as required'}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleMandatory(fieldKey) }}
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 16,
                        height: 16,
                        cursor: 'pointer',
                        borderRadius: token.borderRadius,
                        background: isMandatory ? token.colorError : 'transparent',
                        border: `1px solid ${isMandatory ? token.colorError : token.colorBorder}`,
                        color: token.colorTextLightSolid,
                        marginLeft: 2,
                    }}
                >
                    {isMandatory && <Asterisk size={11} strokeWidth={3} />}
                </span>
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
            stopEvent: ({ event }) => !!((event.target as HTMLElement).closest?.('input, textarea, .ant-select, .ant-picker, .ant-switch, .ant-input-number')),
        })
    },
})
