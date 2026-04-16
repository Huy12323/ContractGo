import React, { useMemo, useRef, useState } from 'react'
import { Table, Checkbox, Tag, Typography, Button, Tooltip, Dropdown, App, theme } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Resizable } from 'react-resizable'
import 'react-resizable/css/styles.css'
import {
    AlignLeftOutlined,
    NumberOutlined,
    CalendarOutlined,
    CheckSquareOutlined,
    TagsOutlined,
    CaretRightOutlined,
    CaretDownOutlined,
    PlusOutlined,
    DownOutlined,
    EditOutlined,
    DeleteOutlined,
    EyeInvisibleOutlined,
} from '@ant-design/icons'
import { useQ_Tables_OrgEmployees } from '@/hooks/useQ_Tables_OrgEmployees'
import type { Tables_OrgEmployees_QueryData } from '@/hooks/useQ_Tables_OrgEmployees'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useM_EmployeeColumn_Delete } from '@/hooks/useM_EmployeeColumn_Delete'
import type {
    EmployeeTable_FieldType,
    EmployeeTable_SortEntry,
    EmployeeTable_GroupEntry,
    EmployeeTable_FilterCondition,
    EmployeeTable_FilterOperator,
} from '@/types/employeeTable.types'

const ADD_FIELD_KEY = '__add_field__'
const UNIVERSAL_KEYS = new Set(['first_name', 'last_name', 'email', 'birthday'])

type ResizableHeaderCellProps = {
    width?: number
    onResize?: (e: React.SyntheticEvent, data: { size: { width: number; height: number } }) => void
    onResizeStop?: (e: React.SyntheticEvent, data: { size: { width: number; height: number } }) => void
} & React.HTMLAttributes<HTMLTableCellElement>

const ResizableHeaderCell = ({ width, onResize, onResizeStop, ...restProps }: ResizableHeaderCellProps) => {
    if (!width) return <th {...restProps} />
    return (
        <Resizable
            width={width}
            height={0}
            minConstraints={[100, 0]}
            maxConstraints={[600, 0]}
            handle={<span className="column-resize-handle" onClick={(e) => e.stopPropagation()} />}
            onResize={onResize}
            onResizeStop={onResizeStop}
            draggableOpts={{ enableUserSelectHack: false }}
        >
            <th {...restProps} />
        </Resizable>
    )
}

type EmployeeRow = Tables_OrgEmployees_QueryData[number]

export type EmployeeDataTable_TableField = { key: string; label: string; type: EmployeeTable_FieldType }

export const EmployeeDataTable_UniversalFields: ReadonlyArray<EmployeeDataTable_TableField> = [
    { key: 'first_name', label: 'First Name', type: 'text' },
    { key: 'last_name', label: 'Last Name', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'birthday', label: 'Birthday', type: 'date' },
]

type TableField = EmployeeDataTable_TableField
const UNIVERSAL_FIELDS = EmployeeDataTable_UniversalFields

const COLUMN_WIDTH = 180

const FieldTypeIcon = ({ type }: { type: EmployeeTable_FieldType }) => {
    switch (type) {
        case 'text':
            return <AlignLeftOutlined />
        case 'number':
            return <NumberOutlined />
        case 'date':
            return <CalendarOutlined />
        case 'boolean':
            return <CheckSquareOutlined />
        case 'single_select':
            return <TagsOutlined />
        case 'multi_select':
            return <TagsOutlined />
    }
}

const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

const isEmptyValue = (value: unknown) =>
    value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

const compareFieldValues = (a: unknown, b: unknown, type: EmployeeTable_FieldType): number => {
    const aEmpty = isEmptyValue(a)
    const bEmpty = isEmptyValue(b)
    if (aEmpty && bEmpty) return 0
    if (aEmpty) return 1
    if (bEmpty) return -1
    switch (type) {
        case 'number':
            return (a as number) - (b as number)
        case 'date':
            return new Date(a as string).getTime() - new Date(b as string).getTime()
        case 'boolean':
            return (a ? 1 : 0) - (b ? 1 : 0)
        case 'single_select':
            return String(a).localeCompare(String(b))
        case 'multi_select':
            return (a as string[]).join(',').localeCompare((b as string[]).join(','))
        case 'text':
        default:
            return String(a).localeCompare(String(b))
    }
}

const evaluateOperator = (
    fieldValue: unknown,
    operator: EmployeeTable_FilterOperator,
    value: unknown,
): boolean => {
    switch (operator) {
        case 'equals':
            return fieldValue === value
        case 'not_equals':
            return fieldValue !== value
        case 'contains':
            return String(fieldValue ?? '').toLowerCase().includes(String(value ?? '').toLowerCase())
        case 'not_contains':
            return !String(fieldValue ?? '').toLowerCase().includes(String(value ?? '').toLowerCase())
        case 'gt':
            return (fieldValue as number) > (value as number)
        case 'gte':
            return (fieldValue as number) >= (value as number)
        case 'lt':
            return (fieldValue as number) < (value as number)
        case 'lte':
            return (fieldValue as number) <= (value as number)
        case 'before':
            return new Date(fieldValue as string).getTime() < new Date(value as string).getTime()
        case 'after':
            return new Date(fieldValue as string).getTime() > new Date(value as string).getTime()
        case 'is_true':
            return fieldValue === true
        case 'is_false':
            return fieldValue === false
        case 'contains_any':
            return Array.isArray(fieldValue) && (value as string[]).some((v) => (fieldValue as string[]).includes(v))
        case 'contains_all':
            return Array.isArray(fieldValue) && (value as string[]).every((v) => (fieldValue as string[]).includes(v))
        case 'is_empty':
            return isEmptyValue(fieldValue)
        case 'is_not_empty':
            return !isEmptyValue(fieldValue)
        default:
            return true
    }
}

const evaluateFilter = (row: EmployeeRow, conditions: EmployeeTable_FilterCondition[]): boolean => {
    if (conditions.length === 0) return true
    return conditions.every((c) => evaluateOperator(
        (row as unknown as Record<string, unknown>)[c.field],
        c.operator,
        c.value,
    ))
}

type GroupHeaderRow = {
    __isGroupHeader: true
    __groupLabel: string
    __groupCount: number
    __groupDepth: number
    id: string
}

type DisplayRow = EmployeeRow | GroupHeaderRow

const isGroupHeader = (row: DisplayRow): row is GroupHeaderRow => (row as GroupHeaderRow).__isGroupHeader === true

type Props = {
    organizationId: string
    filter?: (employee: EmployeeRow) => boolean
    sortState?: EmployeeTable_SortEntry[]
    filterState?: EmployeeTable_FilterCondition[]
    groupBy?: EmployeeTable_GroupEntry[]
    hiddenKeys?: string[]
    fieldOrder?: string[]
    fieldWidths?: Record<string, number>
    onColumnResize?: (columnKey: string, newWidth: number) => void
    onColumnOrderChange?: (nextOrder: string[]) => void
    onAddField?: () => void
    onEditField?: (columnId: string) => void
    onHideField?: (columnKey: string) => void
}

export const App_EmployeeDataTable = ({
    organizationId,
    filter,
    sortState,
    filterState,
    groupBy,
    hiddenKeys,
    fieldOrder,
    fieldWidths,
    onColumnResize,
    onColumnOrderChange,
    onAddField,
    onEditField,
    onHideField,
}: Props) => {
    const { token } = theme.useToken()
    const { modal } = App.useApp()
    const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set())
    const [dragOverKey, setDragOverKey] = useState<{ key: string; position: 'before' | 'after' } | null>(null)
    const dragKeyRef = useRef<string | null>(null)
    const qEmployees = useQ_Tables_OrgEmployees({ organizationId })
    const qColumns = useQ_Tables_EmployeeColumns({ organizationId })
    const qChoices = useQ_Tables_EmployeeColumnChoices({ organizationId })
    const mDeleteColumn = useM_EmployeeColumn_Delete()

    const fields = useMemo<TableField[]>(() => {
        const dynamic: TableField[] = qColumns.columns.map((c) => ({
            key: c.id,
            label: c.label,
            type: c.type as EmployeeTable_FieldType,
        }))
        const base = [...UNIVERSAL_FIELDS, ...dynamic]
        if (!fieldOrder || fieldOrder.length === 0) return base
        const byKey = new Map(base.map((f) => [f.key, f]))
        const orderSet = new Set(fieldOrder)
        const ordered: TableField[] = []
        for (const key of fieldOrder) {
            const f = byKey.get(key)
            if (f) ordered.push(f)
        }
        for (const f of base) {
            if (!orderSet.has(f.key)) ordered.push(f)
        }
        return ordered
    }, [qColumns.columns, fieldOrder])

    const fieldsByKey = useMemo(() => {
        const map: Record<string, TableField> = {}
        for (const f of fields) map[f.key] = f
        return map
    }, [fields])

    const choicesByField = useMemo(() => {
        const map: Record<string, Record<string, string>> = {}
        for (const c of qChoices.choices) {
            if (!map[c.employee_column_id]) map[c.employee_column_id] = {}
            map[c.employee_column_id]![c.value] = c.label
        }
        return map
    }, [qChoices.choices])

    const baseRows = useMemo(() => {
        const rows = qEmployees.employees
        return filter ? rows.filter(filter) : rows
    }, [qEmployees.employees, filter])

    const filteredRows = useMemo(() => {
        const conditions = filterState ?? []
        if (conditions.length === 0) return baseRows
        return baseRows.filter((row) => evaluateFilter(row, conditions))
    }, [baseRows, filterState])

    const sortedRows = useMemo(() => {
        const userEntries = sortState ?? []
        const groupEntries = groupBy ?? []
        const groupFields = new Set(groupEntries.map((e) => e.field))
        const entries: EmployeeTable_SortEntry[] = [
            ...groupEntries,
            ...userEntries.filter((e) => !groupFields.has(e.field)),
        ]
        if (entries.length === 0) return filteredRows
        const rows = [...filteredRows]
        rows.sort((a, b) => {
            for (const entry of entries) {
                const field = fieldsByKey[entry.field]
                if (!field) continue
                const av = (a as unknown as Record<string, unknown>)[entry.field]
                const bv = (b as unknown as Record<string, unknown>)[entry.field]
                const cmp = compareFieldValues(av, bv, field.type)
                if (cmp !== 0) return entry.direction === 'asc' ? cmp : -cmp
            }
            return 0
        })
        return rows
    }, [filteredRows, sortState, fieldsByKey, groupBy])

    const displayRows = useMemo<DisplayRow[]>(() => {
        const groupEntries = groupBy ?? []
        if (groupEntries.length === 0) return sortedRows
        const result: DisplayRow[] = []
        const buildLevel = (rows: EmployeeRow[], depth: number, ancestorKey: string) => {
            if (depth >= groupEntries.length) {
                result.push(...rows)
                return
            }
            const entry = groupEntries[depth]!
            const groupField = fieldsByKey[entry.field]
            const groupsMap = new Map<string, EmployeeRow[]>()
            for (const row of rows) {
                const rawValue = (row as unknown as Record<string, unknown>)[entry.field]
                const key = rawValue === null || rawValue === undefined
                    ? '__null__'
                    : Array.isArray(rawValue)
                        ? rawValue.join('|')
                        : String(rawValue)
                if (!groupsMap.has(key)) groupsMap.set(key, [])
                groupsMap.get(key)!.push(row)
            }
            for (const [key, bucket] of groupsMap) {
                let label: string
                if (key === '__null__') label = 'Null'
                else if (groupField?.type === 'boolean') label = key === 'true' ? 'Yes' : 'No'
                else if (groupField?.type === 'date') label = formatDate(key)
                else if (groupField?.type === 'multi_select') {
                    const labels = choicesByField[groupField.key] || {}
                    label = key
                        .split('|')
                        .map((v) => labels[v] ?? v)
                        .join(', ')
                } else label = key
                result.push({
                    __isGroupHeader: true,
                    __groupLabel: label,
                    __groupCount: bucket.length,
                    __groupDepth: depth,
                    id: `__group__${ancestorKey}__${entry.field}__${key}`,
                })
                buildLevel(bucket, depth + 1, `${ancestorKey}__${key}`)
            }
        }
        buildLevel(sortedRows, 0, 'root')
        return result
    }, [sortedRows, groupBy, fieldsByKey, choicesByField])

    const visibleDisplayRows = useMemo<DisplayRow[]>(() => {
        if (collapsedGroupIds.size === 0) return displayRows
        const result: DisplayRow[] = []
        const collapseStack: Array<{ id: string; depth: number }> = []
        for (const row of displayRows) {
            if (isGroupHeader(row)) {
                while (collapseStack.length > 0 && collapseStack[collapseStack.length - 1]!.depth >= row.__groupDepth) {
                    collapseStack.pop()
                }
                if (collapseStack.length > 0) continue
                result.push(row)
                if (collapsedGroupIds.has(row.id)) {
                    collapseStack.push({ id: row.id, depth: row.__groupDepth })
                }
            } else {
                if (collapseStack.length > 0) continue
                result.push(row)
            }
        }
        return result
    }, [displayRows, collapsedGroupIds])

    const visibleFields = useMemo(() => {
        const hidden = new Set(hiddenKeys ?? [])
        return fields.filter((f) => !hidden.has(f.key))
    }, [fields, hiddenKeys])

    // --- Column drag-reorder handlers ---
    const handleColDragStart = (e: React.DragEvent, key: string) => {
        dragKeyRef.current = key
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', key)
    }
    const handleColDragOver = (e: React.DragEvent, key: string) => {
        if (dragKeyRef.current === null || dragKeyRef.current === key) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const midX = rect.left + rect.width / 2
        const position: 'before' | 'after' = e.clientX < midX ? 'before' : 'after'
        setDragOverKey((prev) => (prev?.key === key && prev.position === position ? prev : { key, position }))
    }
    const handleColDragEnd = () => {
        dragKeyRef.current = null
        setDragOverKey(null)
    }
    const handleColDrop = (e: React.DragEvent, targetKey: string) => {
        e.preventDefault()
        const sourceKey = dragKeyRef.current ?? e.dataTransfer.getData('text/plain')
        const position: 'before' | 'after' = dragOverKey?.key === targetKey ? dragOverKey.position : 'after'
        dragKeyRef.current = null
        setDragOverKey(null)
        if (!sourceKey || sourceKey === targetKey) return
        if (!onColumnOrderChange) return
        const baseOrder = fieldOrder && fieldOrder.length > 0 ? fieldOrder : fields.map((f) => f.key)
        const next = [...baseOrder]
        const sourceIdx = next.indexOf(sourceKey)
        let targetIdx = next.indexOf(targetKey)
        if (sourceIdx === -1 || targetIdx === -1) return
        next.splice(sourceIdx, 1)
        if (sourceIdx < targetIdx) targetIdx -= 1
        const insertAt = position === 'after' ? targetIdx + 1 : targetIdx
        next.splice(insertAt, 0, sourceKey)
        onColumnOrderChange(next)
    }

    // --- Delete handler (chevron menu) ---
    const handleDeleteField = (columnId: string, label: string) => {
        modal.confirm({
            title: 'Delete field?',
            content: `"${label}" and all its data will be permanently removed. This cannot be undone.`,
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: () => mDeleteColumn.mutation.mutateAsync({ columnId }),
        })
    }

    const columns = useMemo<ColumnsType<DisplayRow>>(() => {
        const cellEllipsisStyle: React.CSSProperties = {
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
        }
        const groupByArr = groupBy ?? []
        const realCols: ColumnsType<DisplayRow> = visibleFields.map((f, i) => {
            const isUniversal = UNIVERSAL_KEYS.has(f.key)
            const width = fieldWidths?.[f.key] ?? COLUMN_WIDTH
            const isDropTarget = dragOverKey?.key === f.key
            const dropBefore = isDropTarget && dragOverKey?.position === 'before'
            const dropAfter = isDropTarget && dragOverKey?.position === 'after'
            return ({
            key: f.key,
            dataIndex: f.key,
            width,
            ellipsis: true,
            onHeaderCell: () => ({
                width,
                onResize: () => {},
                onResizeStop: (_e: React.SyntheticEvent, data: { size: { width: number } }) => {
                    onColumnResize?.(f.key, data.size.width)
                },
            } as React.HTMLAttributes<HTMLTableCellElement>),
            title: (
                <div
                    draggable
                    onDragStart={(e) => handleColDragStart(e, f.key)}
                    onDragOver={(e) => handleColDragOver(e, f.key)}
                    onDrop={(e) => handleColDrop(e, f.key)}
                    onDragEnd={handleColDragEnd}
                    className="emp-col-header"
                    style={{
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'grab',
                        userSelect: 'none',
                    }}
                >
                    {dropBefore && (
                        <div style={{ position: 'absolute', left: -1, top: 0, bottom: 0, width: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />
                    )}
                    {dropAfter && (
                        <div style={{ position: 'absolute', right: -1, top: 0, bottom: 0, width: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />
                    )}
                    <FieldTypeIcon type={f.type} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
                    <Dropdown
                        trigger={['click']}
                        placement="bottomRight"
                        menu={{
                            items: [
                                { key: 'edit', icon: <EditOutlined />, label: 'Edit field', disabled: isUniversal },
                                { key: 'hide', icon: <EyeInvisibleOutlined />, label: 'Hide column' },
                                { type: 'divider' },
                                { key: 'delete', icon: <DeleteOutlined />, label: 'Delete field', danger: true, disabled: isUniversal },
                            ],
                            onClick: ({ key, domEvent }) => {
                                domEvent.stopPropagation()
                                if (key === 'edit') onEditField?.(f.key)
                                else if (key === 'hide') onHideField?.(f.key)
                                else if (key === 'delete') handleDeleteField(f.key, f.label)
                            },
                        }}
                    >
                        <Button
                            type="text"
                            size="small"
                            icon={<DownOutlined />}
                            className="emp-col-chevron"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            draggable={false}
                            onDragStart={(e) => e.preventDefault()}
                        />
                    </Dropdown>
                </div>
            ),
            onCell: (record) => {
                if (isGroupHeader(record)) {
                    if (i === 0) {
                        return {
                            colSpan: visibleFields.length,
                            style: {
                                background: token.colorFillAlter,
                                padding: 0,
                            },
                        }
                    }
                    return { colSpan: 0 }
                }
                return {}
            },
            render: (value: unknown, record: DisplayRow) => {
                if (isGroupHeader(record)) {
                    if (i !== 0) return null
                    const indent = record.__groupDepth * 20
                    const isCollapsed = collapsedGroupIds.has(record.id)
                    const groupEntry = groupByArr[record.__groupDepth]
                    const groupField = groupEntry ? fieldsByKey[groupEntry.field] : undefined
                    return (
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: `10px ${token.paddingMD}px 10px ${token.paddingXS + indent}px`,
                                minHeight: 52,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                <Button
                                    type="text"
                                    size="small"
                                    icon={isCollapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
                                    onClick={() => {
                                        setCollapsedGroupIds((prev) => {
                                            const next = new Set(prev)
                                            if (next.has(record.id)) next.delete(record.id)
                                            else next.add(record.id)
                                            return next
                                        })
                                    }}
                                />
                                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
                                    {groupField && (
                                        <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {groupField.label}
                                        </Typography.Text>
                                    )}
                                    <Typography.Text strong style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {record.__groupLabel}
                                    </Typography.Text>
                                </div>
                            </div>
                            <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                {record.__groupCount} {record.__groupCount === 1 ? 'record' : 'records'}
                            </Typography.Text>
                        </div>
                    )
                }
                if (isEmptyValue(value) && f.type !== 'boolean') {
                    return <Typography.Text type="secondary">Null</Typography.Text>
                }
                switch (f.type) {
                    case 'date':
                        return <span style={cellEllipsisStyle}>{formatDate(value as string)}</span>
                    case 'boolean':
                        return <Checkbox checked={value === true} disabled />
                    case 'single_select': {
                        const labels = choicesByField[f.key] || {}
                        const key = value as string
                        return (
                            <span style={{ ...cellEllipsisStyle, maxWidth: '100%' }}>
                                <Tag color={token.colorPrimary}>{labels[key] ?? key}</Tag>
                            </span>
                        )
                    }
                    case 'multi_select': {
                        const labels = choicesByField[f.key] || {}
                        return (
                            <span style={{ ...cellEllipsisStyle, maxWidth: '100%' }}>
                                {(value as string[]).map((v) => (
                                    <Tag key={v} color={token.colorPrimary} style={{ marginInlineEnd: 4 }}>{labels[v] ?? v}</Tag>
                                ))}
                            </span>
                        )
                    }
                    case 'number':
                    case 'text':
                    default:
                        return <span style={cellEllipsisStyle}>{String(value)}</span>
                }
            },
        })
        })
        // Virtual + column — last, not draggable/resizable, not in field_order/hidden_keys/field_widths
        const addCol: ColumnsType<DisplayRow>[number] = {
            key: ADD_FIELD_KEY,
            width: 48,
            onHeaderCell: () => ({
                onClick: onAddField,
                style: { cursor: 'pointer', textAlign: 'center', padding: 0 },
            } as React.HTMLAttributes<HTMLTableCellElement>),
            title: (
                <Tooltip title="Add field">
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                        <PlusOutlined />
                    </span>
                </Tooltip>
            ),
            onCell: (record) => {
                if (isGroupHeader(record)) return { colSpan: 0 }
                return {}
            },
            render: () => null,
        }
        return [...realCols, addCol]
    }, [visibleFields, choicesByField, token, groupBy, fieldsByKey, collapsedGroupIds, fieldWidths, dragOverKey, onColumnResize, onAddField, onEditField, onHideField])

    const isLoading = qEmployees.query.isLoading || qColumns.query.isLoading || qChoices.query.isLoading

    const emptyText = qEmployees.employees.length === 0
        ? (
            <div style={{ padding: token.paddingLG, textAlign: 'center' }}>
                <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>No employees yet</Typography.Text>
                <Typography.Text type="secondary">Send onboarding invitations to add employees</Typography.Text>
            </div>
        )
        : (
            <div style={{ padding: token.paddingLG, textAlign: 'center' }}>
                <Typography.Text type="secondary">No employees match your filters</Typography.Text>
            </div>
        )

    return (
        <>
            <style>{`
                .emp-data-table .ant-table-container { border-top: none !important; }
                .emp-data-table .ant-table-container,
                .emp-data-table .ant-table-thead > tr > th,
                .emp-data-table .ant-table-tbody > tr > td { border-width: 2px !important; }
                .emp-data-table .column-resize-handle {
                    position: absolute;
                    right: -5px;
                    top: 0;
                    bottom: 0;
                    width: 10px;
                    cursor: col-resize;
                    z-index: 3;
                }
                .emp-data-table .emp-col-chevron { opacity: 0; transition: opacity 0.15s; margin-left: auto; flex-shrink: 0; }
                .emp-data-table .ant-table-thead > tr > th:hover .emp-col-chevron { opacity: 1; }
                .emp-data-table .ant-table-thead > tr > th { position: relative; }
            `}</style>
            <Table<DisplayRow>
                className="emp-data-table"
                rowKey="id"
                size="small"
                bordered
                tableLayout="fixed"
                pagination={false}
                loading={isLoading}
                dataSource={visibleDisplayRows}
                columns={columns}
                style={{ width: 'max-content' }}
                locale={{ emptyText }}
                components={{
                    header: {
                        cell: (props: ResizableHeaderCellProps) => {
                            const { width, onResize, onResizeStop, style, ...rest } = props
                            const mergedStyle: React.CSSProperties = {
                                ...style,
                                position: 'sticky',
                                top: 0,
                                zIndex: 2,
                                borderTop: `2px solid ${token.colorBorder}`,
                            }
                            return (
                                <ResizableHeaderCell
                                    {...rest}
                                    width={width}
                                    onResize={onResize}
                                    onResizeStop={onResizeStop}
                                    style={mergedStyle}
                                />
                            )
                        },
                    },
                }}
            />
        </>
    )
}
