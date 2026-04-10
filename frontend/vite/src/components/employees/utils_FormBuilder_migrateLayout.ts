import type { JSONContent } from '@tiptap/react'

/**
 * Detect whether a layout value is old-format (string[][]) or TipTap JSON.
 * Old format: array of arrays of field key strings.
 * TipTap format: object with type: 'doc'.
 */
export const isTipTapLayout = (layout: unknown): layout is JSONContent =>
    typeof layout === 'object' && layout !== null && !Array.isArray(layout) && (layout as JSONContent).type === 'doc'

/**
 * Convert old string[][] layout to TipTap ProseMirror JSON.
 * Each row becomes a paragraph, each field key becomes a fieldInput node.
 * Fields within a row are separated by spaces.
 *
 * resolveField maps a field key to { label, type } for populating node attrs.
 */
export const utils_FormBuilder_migrateLayout = (
    rows: string[][],
    resolveField: (key: string) => { label: string; type: string },
): JSONContent => {
    const content: JSONContent[] = rows
        .filter((row) => row.length > 0)
        .map((row) => {
            const inlineContent: JSONContent[] = []
            row.forEach((key, i) => {
                if (i > 0) inlineContent.push({ type: 'text', text: ' ' })
                const field = resolveField(key)
                inlineContent.push({
                    type: 'fieldInput',
                    attrs: { fieldKey: key, fieldLabel: field.label, fieldType: field.type },
                })
            })
            return { type: 'paragraph', content: inlineContent }
        })

    return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] }
}
