import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { Typography, Button, Tooltip, Input, Popover, Checkbox, Badge, Select, InputNumber, DatePicker, theme, App } from 'antd'
import dayjs from 'dayjs'
import {
  PlusOutlined,
  SortAscendingOutlined,
  FilterOutlined,
  GroupOutlined,
  EyeInvisibleOutlined,
  SearchOutlined,
  HolderOutlined,
  DeleteOutlined,
  MenuOutlined,
} from '@ant-design/icons'
import { useSearch, useNavigate } from '@tanstack/react-router'
import type {
  EmployeeTable_SortEntry,
  EmployeeTable_GroupEntry,
  EmployeeTable_FilterGroup,
  EmployeeTable_FilterNode,
  EmployeeTable_FilterCondition,
  EmployeeTable_FilterOperator,
  EmployeeTable_FieldType,
} from '@/types/employeeTable.types'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_OrgEmployeeViews } from '@/hooks/useQ_Tables_OrgEmployeeViews'
import { App_EmployeeDataTable, EmployeeDataTable_UniversalFields, type EmployeeDataTable_TableField } from '@/components/employees/App_EmployeeDataTable'
import { useProvider_Page_Employees_List, emptyToolState, projectConfigFromToolState } from '@/providers/employees/Provider_Page_Employees_List'
import { Utils_EmployeeView_CleanConfig } from '@/utils/Utils_EmployeeView_CleanConfig'
import { useM_EmployeeView_Create } from '@/hooks/useM_EmployeeView_Create'
import { useM_EmployeeView_Update } from '@/hooks/useM_EmployeeView_Update'
import { useM_EmployeeView_Delete } from '@/hooks/useM_EmployeeView_Delete'
import { useM_EmployeeView_Reorder } from '@/hooks/useM_EmployeeView_Reorder'
import type { Tables_OrgEmployeeViews_QueryData } from '@/hooks/useQ_Tables_OrgEmployeeViews'
import { PageEmployees_ViewsSidebar } from '../PageEmployees_ViewsSidebar/PageEmployees_ViewsSidebar'
import { PageEmployees_ViewNameModal } from '../PageEmployees_ViewNameModal/PageEmployees_ViewNameModal'

type EmployeeViewRow = Tables_OrgEmployeeViews_QueryData[number]
type NameModalConfig = {
  title: string
  initialName: string
  submitLabel: string
  onSubmit: (name: string) => Promise<void>
}

// --- Filter tool helpers + renderers ---
const OPERATORS_BY_TYPE: Record<EmployeeTable_FieldType, { value: EmployeeTable_FilterOperator; label: string }[]> = {
  text: [
    { value: 'equals', label: 'equals' },
    { value: 'not_equals', label: 'does not equal' },
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  number: [
    { value: 'equals', label: '=' },
    { value: 'not_equals', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'gte', label: '≥' },
    { value: 'lt', label: '<' },
    { value: 'lte', label: '≤' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  date: [
    { value: 'equals', label: 'on' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  boolean: [
    { value: 'is_true', label: 'is true' },
    { value: 'is_false', label: 'is false' },
    { value: 'is_empty', label: 'is empty' },
  ],
  multi_select: [
    { value: 'contains_any', label: 'contains any of' },
    { value: 'contains_all', label: 'contains all of' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
}

const NO_VALUE_OPERATORS = new Set<EmployeeTable_FilterOperator>(['is_empty', 'is_not_empty', 'is_true', 'is_false'])

const makeNewCondition = (fields: ReadonlyArray<EmployeeDataTable_TableField>): EmployeeTable_FilterCondition => {
  const first = fields[0]
  if (!first) return { kind: 'condition', field: '', operator: 'is_empty', value: null }
  return {
    kind: 'condition',
    field: first.key,
    operator: OPERATORS_BY_TYPE[first.type][0]!.value,
    value: null,
  }
}

const makeNewGroup = (fields: ReadonlyArray<EmployeeDataTable_TableField>): EmployeeTable_FilterGroup => ({
  kind: 'group',
  combinator: 'and',
  children: [makeNewCondition(fields)],
})

type FilterRendererProps = {
  fields: ReadonlyArray<EmployeeDataTable_TableField>
  choicesByField: Record<string, { value: string; label: string }[]>
}

const ConditionRow = ({
  condition,
  fields,
  choicesByField,
  onChange,
  onRemove,
}: FilterRendererProps & {
  condition: EmployeeTable_FilterCondition
  onChange: (next: EmployeeTable_FilterCondition) => void
  onRemove: () => void
}) => {
  const { token } = theme.useToken()
  const field = fields.find((f) => f.key === condition.field)
  const operators = field ? OPERATORS_BY_TYPE[field.type] : []
  const needsValue = !NO_VALUE_OPERATORS.has(condition.operator)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
      <Select
        size="small"
        showSearch
        optionFilterProp="label"
        style={{ flex: 1, minWidth: 120 }}
        value={condition.field}
        options={fields.map((f) => ({ value: f.key, label: f.label }))}
        onChange={(v) => {
          const nextField = fields.find((f) => f.key === v)
          if (!nextField) return
          const nextOps = OPERATORS_BY_TYPE[nextField.type]
          const opStillValid = nextOps.some((o) => o.value === condition.operator)
          onChange({
            ...condition,
            field: v,
            operator: opStillValid ? condition.operator : nextOps[0]!.value,
            value: null,
          })
        }}
      />
      <Select
        size="small"
        style={{ width: 150 }}
        value={condition.operator}
        options={operators.map((o) => ({ value: o.value, label: o.label }))}
        onChange={(v) => onChange({ ...condition, operator: v, value: null })}
      />
      {needsValue && field && (
        <div style={{ flex: 1, minWidth: 120 }}>
          {field.type === 'text' && (
            <Input
              size="small"
              value={(condition.value as string | null) ?? ''}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
            />
          )}
          {field.type === 'number' && (
            <InputNumber
              size="small"
              style={{ width: '100%' }}
              value={condition.value as number | null}
              onChange={(v) => onChange({ ...condition, value: v })}
            />
          )}
          {field.type === 'date' && (
            <DatePicker
              size="small"
              style={{ width: '100%' }}
              value={condition.value ? dayjs(condition.value as string) : null}
              onChange={(_, ds) => onChange({ ...condition, value: (ds as string) || null })}
            />
          )}
          {field.type === 'multi_select' && (
            <Select
              size="small"
              mode="multiple"
              style={{ width: '100%' }}
              value={(condition.value as string[] | null) ?? []}
              options={choicesByField[field.key] ?? []}
              onChange={(v) => onChange({ ...condition, value: v })}
            />
          )}
        </div>
      )}
      <Button type="text" size="small" icon={<DeleteOutlined />} onClick={onRemove} />
    </div>
  )
}

const FilterGroupBlock = ({
  group,
  fields,
  choicesByField,
  onChange,
  onRemove,
  isRoot,
}: FilterRendererProps & {
  group: EmployeeTable_FilterGroup
  onChange: (next: EmployeeTable_FilterGroup) => void
  onRemove?: () => void
  isRoot?: boolean
}) => {
  const { token } = theme.useToken()
  const [dragOver, setDragOver] = useState<{ idx: number; position: 'before' | 'after' } | null>(null)
  const dragIdxRef = useRef<number | null>(null)

  const updateChild = (idx: number, newChild: EmployeeTable_FilterNode) =>
    onChange({ ...group, children: group.children.map((c, i) => (i === idx ? newChild : c)) })

  const removeChild = (idx: number) =>
    onChange({ ...group, children: group.children.filter((_, i) => i !== idx) })

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    dragIdxRef.current = idx
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    if (dragIdxRef.current === null) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (dragIdxRef.current === idx) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const mid = rect.top + rect.height / 2
    const position: 'before' | 'after' = e.clientY < mid ? 'before' : 'after'
    setDragOver((prev) => (prev?.idx === idx && prev.position === position ? prev : { idx, position }))
  }
  const handleDragEnd = () => {
    dragIdxRef.current = null
    setDragOver(null)
  }
  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    const sourceIdx = dragIdxRef.current
    if (sourceIdx === null) return
    e.preventDefault()
    e.stopPropagation()
    const position: 'before' | 'after' = dragOver?.idx === targetIdx ? dragOver.position : 'after'
    dragIdxRef.current = null
    setDragOver(null)
    if (sourceIdx === targetIdx) return
    const next = [...group.children]
    const [moved] = next.splice(sourceIdx, 1)
    if (!moved) return
    let insertAt = sourceIdx < targetIdx ? targetIdx - 1 : targetIdx
    if (position === 'after') insertAt += 1
    next.splice(insertAt, 0, moved)
    onChange({ ...group, children: next })
  }

  return (
    <div
      style={{
        padding: token.paddingXS,
        borderRadius: token.borderRadiusSM,
        border: isRoot ? 'none' : `1px solid ${token.colorBorderSecondary}`,
        background: isRoot ? 'transparent' : token.colorFillQuaternary,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: token.marginXS }}>
        <Select
          size="small"
          style={{ width: 120 }}
          value={group.combinator}
          options={[
            { value: 'and', label: 'Match all' },
            { value: 'or', label: 'Match any' },
          ]}
          onChange={(v) => onChange({ ...group, combinator: v as 'and' | 'or' })}
        />
        {!isRoot && onRemove && (
          <Button type="text" size="small" icon={<DeleteOutlined />} onClick={onRemove} />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
        {group.children.length === 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>This group has no conditions.</Typography.Text>
        )}
        {group.children.map((child, i) => {
          const isDropTarget = dragOver?.idx === i
          const dropBefore = isDropTarget && dragOver?.position === 'before'
          const dropAfter = isDropTarget && dragOver?.position === 'after'
          return (
            <div
              key={i}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={(e) => handleDrop(e, i)}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: child.kind === 'group' ? 'stretch' : 'center',
                gap: token.marginXS,
              }}
            >
              {dropBefore && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: -3, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />
              )}
              {dropAfter && (
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: -3, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />
              )}
              <span
                draggable
                onDragStart={(e) => handleDragStart(e, i)}
                onDragEnd={handleDragEnd}
                style={{ cursor: 'grab', display: 'inline-flex', alignItems: 'center', padding: `${child.kind === 'group' ? token.paddingXS : 0}px 0`, flexShrink: 0 }}
              >
                <HolderOutlined style={{ color: token.colorTextTertiary, fontSize: 14 }} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {child.kind === 'condition' ? (
                  <ConditionRow
                    condition={child}
                    fields={fields}
                    choicesByField={choicesByField}
                    onChange={(next) => updateChild(i, next)}
                    onRemove={() => removeChild(i)}
                  />
                ) : (
                  <FilterGroupBlock
                    group={child}
                    fields={fields}
                    choicesByField={choicesByField}
                    onChange={(next) => updateChild(i, next)}
                    onRemove={() => removeChild(i)}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: token.marginXS, marginTop: token.marginSM }}>
        <Button
          size="small"
          type="link"
          icon={<PlusOutlined />}
          onClick={() => onChange({ ...group, children: [...group.children, makeNewCondition(fields)] })}
          disabled={fields.length === 0}
        >
          Add condition
        </Button>
        <Button
          size="small"
          type="link"
          icon={<PlusOutlined />}
          onClick={() => onChange({ ...group, children: [...group.children, makeNewGroup(fields)] })}
          disabled={fields.length === 0}
        >
          Add group
        </Button>
      </div>
    </div>
  )
}

// --- Main list-view component ---
type Props = { organizationId: string }

export const PageEmployees_ListView = ({ organizationId }: Props) => {
  const { token } = theme.useToken()
  const pList = useProvider_Page_Employees_List()
  const search = useSearch({ from: '/_protected/$organizationId/employees/' })
  const navigate = useNavigate()

  const qEmployeeColumns = useQ_Tables_EmployeeColumns({ organizationId })
  const qEmployeeColumnChoices = useQ_Tables_EmployeeColumnChoices({ organizationId })
  const qViews = useQ_Tables_OrgEmployeeViews({ organizationId })

  const mCreateView = useM_EmployeeView_Create()
  const mUpdateView = useM_EmployeeView_Update()
  const mDeleteView = useM_EmployeeView_Delete()
  const mReorderViews = useM_EmployeeView_Reorder()
  const { modal } = App.useApp()

  // Insert-position helpers — views are pre-sorted by sort_order ASC from the query
  const computeTopSortOrder = useCallback((): number => {
    const views = qViews.employeeViews
    if (views.length === 0) return 100
    return Math.min(...views.map((v) => v.sort_order)) - 100
  }, [qViews.employeeViews])

  const computeAfterSortOrder = useCallback((sourceId: string): number => {
    const views = qViews.employeeViews
    const idx = views.findIndex((v) => v.id === sourceId)
    if (idx === -1) return 100
    const source = views[idx]!
    const next = views[idx + 1]
    if (!next) return source.sort_order + 100
    return Math.floor((source.sort_order + next.sort_order) / 2)
  }, [qViews.employeeViews])

  const [nameModal, setNameModal] = useState<NameModalConfig | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Persisted state (from provider)
  const ts = pList.state.toolState
  const { sort: sortState, filter: filterState, groupBy, hiddenKeys, fieldOrder, search: searchQuery } = ts

  // Updater helpers — accept value or updater function for ergonomic parity with useState
  const setSortState = useCallback((updater: EmployeeTable_SortEntry[] | ((prev: EmployeeTable_SortEntry[]) => EmployeeTable_SortEntry[])) => {
    const next = typeof updater === 'function' ? (updater as (prev: EmployeeTable_SortEntry[]) => EmployeeTable_SortEntry[])(pList.state.toolState.sort) : updater
    pList.setToolState({ sort: next })
  }, [pList])
  const setFilterState = useCallback((next: EmployeeTable_FilterGroup | null) => {
    pList.setToolState({ filter: next })
  }, [pList])
  const setGroupBy = useCallback((updater: EmployeeTable_GroupEntry[] | ((prev: EmployeeTable_GroupEntry[]) => EmployeeTable_GroupEntry[])) => {
    const next = typeof updater === 'function' ? (updater as (prev: EmployeeTable_GroupEntry[]) => EmployeeTable_GroupEntry[])(pList.state.toolState.groupBy) : updater
    pList.setToolState({ groupBy: next })
  }, [pList])
  const setHiddenKeys = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    const next = typeof updater === 'function' ? (updater as (prev: string[]) => string[])(pList.state.toolState.hiddenKeys) : updater
    pList.setToolState({ hiddenKeys: next })
  }, [pList])
  const setFieldOrder = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    const next = typeof updater === 'function' ? (updater as (prev: string[]) => string[])(pList.state.toolState.fieldOrder) : updater
    pList.setToolState({ fieldOrder: next })
  }, [pList])
  const setSearchQuery = useCallback((next: string) => {
    pList.setToolState({ search: next })
  }, [pList])

  // Ephemeral/transient local state
  const [hideFieldsSearch, setHideFieldsSearch] = useState<string>('')
  const [dragOverInfo, setDragOverInfo] = useState<{ key: string; position: 'before' | 'after' } | null>(null)
  const [sortDragOver, setSortDragOver] = useState<{ field: string; position: 'before' | 'after' } | null>(null)
  const [groupDragOver, setGroupDragOver] = useState<{ field: string; position: 'before' | 'after' } | null>(null)
  const dragKeyRef = useRef<string | null>(null)
  const sortDragFieldRef = useRef<string | null>(null)
  const groupDragFieldRef = useRef<string | null>(null)

  // Derived: list of all table fields (universal + dynamic) in display order
  const listViewFields = useMemo<EmployeeDataTable_TableField[]>(() => {
    const dynamic: EmployeeDataTable_TableField[] = qEmployeeColumns.columns.map((c) => ({
      key: c.id,
      label: c.label,
      type: c.type as EmployeeDataTable_TableField['type'],
    }))
    const base = [...EmployeeDataTable_UniversalFields, ...dynamic]
    if (fieldOrder.length === 0) return base
    const byKey = new Map(base.map((f) => [f.key, f]))
    const orderSet = new Set(fieldOrder)
    const ordered: EmployeeDataTable_TableField[] = []
    for (const key of fieldOrder) {
      const f = byKey.get(key)
      if (f) ordered.push(f)
    }
    for (const f of base) {
      if (!orderSet.has(f.key)) ordered.push(f)
    }
    return ordered
  }, [qEmployeeColumns.columns, fieldOrder])

  const choicesByField = useMemo(() => {
    const map: Record<string, { value: string; label: string }[]> = {}
    for (const c of qEmployeeColumnChoices.choices) {
      if (!map[c.employee_column_id]) map[c.employee_column_id] = []
      map[c.employee_column_id]!.push({ value: c.value, label: c.label })
    }
    return map
  }, [qEmployeeColumnChoices.choices])

  const hideFieldsFiltered = useMemo(() => {
    const q = hideFieldsSearch.trim().toLowerCase()
    if (!q) return listViewFields
    return listViewFields.filter((f) => f.label.toLowerCase().includes(q))
  }, [listViewFields, hideFieldsSearch])

  const sortUsedKeys = useMemo(() => new Set(sortState.map((e) => e.field)), [sortState])
  const addSortEntry = useCallback(() => {
    const available = listViewFields.find((f) => !sortUsedKeys.has(f.key))
    if (!available) return
    setSortState((prev) => [...prev, { field: available.key, direction: 'asc' }])
  }, [listViewFields, sortUsedKeys, setSortState])
  const updateSortEntry = useCallback((idx: number, patch: Partial<EmployeeTable_SortEntry>) => {
    setSortState((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)))
  }, [setSortState])
  const removeSortEntry = useCallback((idx: number) => {
    setSortState((prev) => prev.filter((_, i) => i !== idx))
  }, [setSortState])

  const groupUsedKeys = useMemo(() => new Set(groupBy.map((e) => e.field)), [groupBy])
  const addGroupEntry = useCallback(() => {
    const available = listViewFields.find((f) => !groupUsedKeys.has(f.key))
    if (!available) return
    setGroupBy((prev) => [...prev, { field: available.key, direction: 'asc' }])
  }, [listViewFields, groupUsedKeys, setGroupBy])
  const updateGroupEntry = useCallback((idx: number, patch: Partial<EmployeeTable_GroupEntry>) => {
    setGroupBy((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)))
  }, [setGroupBy])
  const removeGroupEntry = useCallback((idx: number) => {
    setGroupBy((prev) => prev.filter((_, i) => i !== idx))
  }, [setGroupBy])

  const handleGroupDragStart = useCallback((e: React.DragEvent, field: string) => {
    groupDragFieldRef.current = field
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', field)
  }, [])
  const handleGroupDragOver = useCallback((e: React.DragEvent, field: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (groupDragFieldRef.current === field) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const position: 'before' | 'after' = e.clientY < midY ? 'before' : 'after'
    setGroupDragOver((prev) => (prev?.field === field && prev.position === position ? prev : { field, position }))
  }, [])
  const handleGroupDragEnd = useCallback(() => {
    groupDragFieldRef.current = null
    setGroupDragOver(null)
  }, [])
  const handleGroupDrop = useCallback((e: React.DragEvent, targetField: string) => {
    e.preventDefault()
    const sourceField = groupDragFieldRef.current ?? e.dataTransfer.getData('text/plain')
    const position: 'before' | 'after' = groupDragOver?.field === targetField ? groupDragOver.position : 'after'
    groupDragFieldRef.current = null
    setGroupDragOver(null)
    if (!sourceField || sourceField === targetField) return
    setGroupBy((prev) => {
      const next = [...prev]
      const sourceIdx = next.findIndex((e) => e.field === sourceField)
      let targetIdx = next.findIndex((e) => e.field === targetField)
      if (sourceIdx === -1 || targetIdx === -1) return prev
      const [moved] = next.splice(sourceIdx, 1)
      if (!moved) return prev
      if (sourceIdx < targetIdx) targetIdx -= 1
      const insertAt = position === 'after' ? targetIdx + 1 : targetIdx
      next.splice(insertAt, 0, moved)
      return next
    })
  }, [groupDragOver, setGroupBy])

  const handleSortDragStart = useCallback((e: React.DragEvent, field: string) => {
    sortDragFieldRef.current = field
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', field)
  }, [])
  const handleSortDragOver = useCallback((e: React.DragEvent, field: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (sortDragFieldRef.current === field) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const position: 'before' | 'after' = e.clientY < midY ? 'before' : 'after'
    setSortDragOver((prev) => (prev?.field === field && prev.position === position ? prev : { field, position }))
  }, [])
  const handleSortDragEnd = useCallback(() => {
    sortDragFieldRef.current = null
    setSortDragOver(null)
  }, [])
  const handleSortDrop = useCallback((e: React.DragEvent, targetField: string) => {
    e.preventDefault()
    const sourceField = sortDragFieldRef.current ?? e.dataTransfer.getData('text/plain')
    const position: 'before' | 'after' = sortDragOver?.field === targetField ? sortDragOver.position : 'after'
    sortDragFieldRef.current = null
    setSortDragOver(null)
    if (!sourceField || sourceField === targetField) return
    setSortState((prev) => {
      const next = [...prev]
      const sourceIdx = next.findIndex((e) => e.field === sourceField)
      let targetIdx = next.findIndex((e) => e.field === targetField)
      if (sourceIdx === -1 || targetIdx === -1) return prev
      const [moved] = next.splice(sourceIdx, 1)
      if (!moved) return prev
      if (sourceIdx < targetIdx) targetIdx -= 1
      const insertAt = position === 'after' ? targetIdx + 1 : targetIdx
      next.splice(insertAt, 0, moved)
      return next
    })
  }, [sortDragOver, setSortState])

  const handleFieldDragStart = useCallback((e: React.DragEvent, key: string) => {
    dragKeyRef.current = key
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }, [])
  const handleFieldDragOver = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragKeyRef.current === key) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const position: 'before' | 'after' = e.clientY < midY ? 'before' : 'after'
    setDragOverInfo((prev) => (prev?.key === key && prev.position === position ? prev : { key, position }))
  }, [])
  const handleFieldDragEnd = useCallback(() => {
    dragKeyRef.current = null
    setDragOverInfo(null)
  }, [])
  const handleFieldDrop = useCallback((e: React.DragEvent, targetKey: string) => {
    e.preventDefault()
    const sourceKey = dragKeyRef.current ?? e.dataTransfer.getData('text/plain')
    const position: 'before' | 'after' = dragOverInfo?.key === targetKey ? dragOverInfo.position : 'after'
    dragKeyRef.current = null
    setDragOverInfo(null)
    if (!sourceKey || sourceKey === targetKey) return
    setFieldOrder((prev) => {
      const baseOrder = prev.length > 0 ? prev : listViewFields.map((f) => f.key)
      const next = [...baseOrder]
      const sourceIdx = next.indexOf(sourceKey)
      let targetIdx = next.indexOf(targetKey)
      if (sourceIdx === -1 || targetIdx === -1) return prev
      next.splice(sourceIdx, 1)
      if (sourceIdx < targetIdx) targetIdx -= 1
      const insertAt = position === 'after' ? targetIdx + 1 : targetIdx
      next.splice(insertAt, 0, sourceKey)
      return next
    })
  }, [dragOverInfo, listViewFields, setFieldOrder])

  // --- Sync effect: hydrate provider state from selected view (or reset to Default) ---
  const lastHydratedViewIdRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!qViews.query.isSuccess || !qEmployeeColumns.query.isSuccess) return
    const nextViewId = search.viewId ?? null
    if (lastHydratedViewIdRef.current === nextViewId) return
    lastHydratedViewIdRef.current = nextViewId

    if (nextViewId === null) {
      pList.setState({ savedConfig: null, savedName: null, toolState: emptyToolState })
      return
    }

    const view = qViews.employeeViews.find((v) => v.id === nextViewId)
    if (!view) {
      pList.setState({ savedConfig: null, savedName: null, toolState: emptyToolState })
      return
    }

    const validKeys = new Set<string>([
      ...EmployeeDataTable_UniversalFields.map((f) => f.key),
      ...qEmployeeColumns.columns.map((c) => c.id),
    ])
    const cleaned = Utils_EmployeeView_CleanConfig(view.config, validKeys)
    pList.setState({
      savedConfig: cleaned,
      savedName: view.name,
      toolState: { ...cleaned, search: '' },
    })
  }, [search.viewId, qViews.query.isSuccess, qViews.employeeViews, qEmployeeColumns.query.isSuccess, qEmployeeColumns.columns, pList])

  // Sidebar actions
  const handleCreateView = useCallback(() => {
    setNameModal({
      title: 'Create view',
      initialName: '',
      submitLabel: 'Create',
      onSubmit: async (name) => {
        const created = await mCreateView.mutation.mutateAsync({
          organization_id: organizationId,
          name,
          config: projectConfigFromToolState(pList.state.toolState),
          sort_order: computeTopSortOrder(),
        })
        setNameModal(null)
        navigate({ to: '.', search: { viewId: created.id } })
      },
    })
  }, [mCreateView.mutation, organizationId, pList.state.toolState, navigate, computeTopSortOrder])

  const handleRenameView = useCallback((view: EmployeeViewRow) => {
    setNameModal({
      title: 'Rename view',
      initialName: view.name,
      submitLabel: 'Save',
      onSubmit: async (name) => {
        await mUpdateView.mutation.mutateAsync({ viewId: view.id, name })
        if (view.id === search.viewId) pList.setState({ savedName: name })
        setNameModal(null)
      },
    })
  }, [mUpdateView.mutation, search.viewId, pList])

  const handleDuplicateView = useCallback(async (view: EmployeeViewRow) => {
    const created = await mCreateView.mutation.mutateAsync({
      organization_id: organizationId,
      name: `Copy of ${view.name}`,
      config: view.config,
      sort_order: computeAfterSortOrder(view.id),
    })
    navigate({ to: '.', search: { viewId: created.id } })
  }, [mCreateView.mutation, organizationId, navigate, computeAfterSortOrder])

  const handleReorderViews = useCallback((orderedIds: string[]) => {
    mReorderViews.mutation.mutate({ organizationId, orderedIds })
  }, [mReorderViews.mutation, organizationId])

  const handleDeleteView = useCallback((view: EmployeeViewRow) => {
    modal.confirm({
      title: 'Delete view?',
      content: <>&ldquo;{view.name}&rdquo; will be permanently deleted.</>,
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        await mDeleteView.mutation.mutateAsync({ viewId: view.id })
        if (search.viewId === view.id) {
          navigate({ to: '.', search: { viewId: undefined } })
        }
      },
    })
  }, [modal, mDeleteView.mutation, search.viewId, navigate])

  // Save / Save-As / Cancel Changes — toolbar actions
  const handleSaveCurrentView = useCallback(async () => {
    if (!search.viewId || !pList.isDirty) return
    const newConfig = projectConfigFromToolState(pList.state.toolState)
    await mUpdateView.mutation.mutateAsync({ viewId: search.viewId, config: newConfig })
    pList.setState({ savedConfig: newConfig })
  }, [search.viewId, pList, mUpdateView.mutation])

  const handleSaveAs = useCallback(() => {
    const prefill = pList.state.savedName ? `Copy of ${pList.state.savedName}` : ''
    setNameModal({
      title: 'Save view as',
      initialName: prefill,
      submitLabel: 'Save',
      onSubmit: async (name) => {
        const created = await mCreateView.mutation.mutateAsync({
          organization_id: organizationId,
          name,
          config: projectConfigFromToolState(pList.state.toolState),
          sort_order: computeTopSortOrder(),
        })
        setNameModal(null)
        navigate({ to: '.', search: { viewId: created.id } })
      },
    })
  }, [pList.state.savedName, pList.state.toolState, mCreateView.mutation, organizationId, navigate, computeTopSortOrder])

  const handleCancelChanges = useCallback(() => {
    if (!pList.state.savedConfig) return
    pList.setState({
      toolState: { ...pList.state.savedConfig, search: pList.state.toolState.search },
    })
  }, [pList])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Inner toolbar — spans full width above sidebar + table */}
      <div style={{
        height: 48,
        minHeight: 48,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        padding: `0 ${token.paddingSM}px`,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        gap: token.marginXS,
      }}>
        {/* Left cluster — sidebar toggle + current view name */}
        <Tooltip title={sidebarCollapsed ? 'Show views' : 'Hide views'}>
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setSidebarCollapsed((c) => !c)}
          />
        </Tooltip>
        <Typography.Text
          strong
          ellipsis={{ tooltip: pList.state.savedName ?? 'Default' }}
          style={{ maxWidth: 240, fontSize: 14 }}
        >
          {pList.state.savedName ?? 'Default'}
        </Typography.Text>

        {/* Middle cluster — tool buttons (absolute-centered on viewport) */}
          <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: token.marginXS }}>
            <Popover
              trigger="click"
              placement="bottom"
              content={
                <div style={{ width: 400 }}>
                  {sortState.length === 0 ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', padding: `${token.paddingXS}px 0` }}>
                      No sort rules. Rows are shown in the order they were added.
                    </Typography.Text>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS, maxHeight: 320, overflowY: 'auto' }}>
                      {sortState.map((entry, i) => {
                        const options = listViewFields
                          .filter((f) => f.key === entry.field || !sortUsedKeys.has(f.key))
                          .map((f) => ({ value: f.key, label: f.label }))
                        const isDropTarget = sortDragOver?.field === entry.field
                        const dropBefore = isDropTarget && sortDragOver?.position === 'before'
                        const dropAfter = isDropTarget && sortDragOver?.position === 'after'
                        return (
                          <div
                            key={entry.field}
                            draggable
                            onDragStart={(e) => handleSortDragStart(e, entry.field)}
                            onDragOver={(e) => handleSortDragOver(e, entry.field)}
                            onDrop={(e) => handleSortDrop(e, entry.field)}
                            onDragEnd={handleSortDragEnd}
                            style={{
                              position: 'relative',
                              display: 'flex',
                              alignItems: 'center',
                              gap: token.marginXS,
                            }}
                          >
                            {dropBefore && (
                              <div style={{ position: 'absolute', left: 0, right: 0, top: -4, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />
                            )}
                            {dropAfter && (
                              <div style={{ position: 'absolute', left: 0, right: 0, bottom: -4, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />
                            )}
                            <HolderOutlined style={{ color: token.colorTextTertiary, cursor: 'grab', fontSize: 14 }} />
                            <Select
                              size="small"
                              showSearch
                              optionFilterProp="label"
                              style={{ flex: 1 }}
                              value={entry.field}
                              options={options}
                              onChange={(v) => updateSortEntry(i, { field: v })}
                            />
                            <Select
                              size="small"
                              style={{ width: 80 }}
                              value={entry.direction}
                              options={[
                                { value: 'asc', label: 'asc' },
                                { value: 'desc', label: 'desc' },
                              ]}
                              onChange={(v) => updateSortEntry(i, { direction: v as 'asc' | 'desc' })}
                            />
                            <Button type="text" size="small" icon={<DeleteOutlined />} onClick={() => removeSortEntry(i)} />
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <Button
                    block
                    type="link"
                    size="small"
                    icon={<PlusOutlined />}
                    disabled={sortState.length >= listViewFields.length}
                    onClick={addSortEntry}
                    style={{ marginTop: token.marginSM }}
                  >
                    Add sort
                  </Button>
                </div>
              }
            >
              <Tooltip title="Sort">
                <Badge dot={sortState.length > 0} offset={[-4, 4]}>
                  <Button type="text" icon={<SortAscendingOutlined />} />
                </Badge>
              </Tooltip>
            </Popover>
            <Popover
              trigger="click"
              placement="bottom"
              content={
                filterState === null ? (
                  <div style={{ width: 560 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: token.marginSM }}>
                      No filters. All employees shown.
                    </Typography.Text>
                    <Button
                      size="small"
                      type="link"
                      icon={<PlusOutlined />}
                      disabled={listViewFields.length === 0}
                      onClick={() => setFilterState({ kind: 'group', combinator: 'and', children: [makeNewCondition(listViewFields)] })}
                    >
                      Add condition
                    </Button>
                  </div>
                ) : (
                  <div style={{ width: 560, maxHeight: 480, overflowY: 'auto' }}>
                    <FilterGroupBlock
                      group={filterState}
                      fields={listViewFields}
                      choicesByField={choicesByField}
                      onChange={(next) => setFilterState(next.children.length === 0 ? null : next)}
                      isRoot
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: token.marginSM, paddingTop: token.paddingXS, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                      <Button size="small" type="link" danger onClick={() => setFilterState(null)}>Clear filter</Button>
                    </div>
                  </div>
                )
              }
            >
              <Tooltip title="Filter">
                <Badge dot={filterState !== null} offset={[-4, 4]}>
                  <Button type="text" icon={<FilterOutlined />} />
                </Badge>
              </Tooltip>
            </Popover>
            <Popover
              trigger="click"
              placement="bottom"
              content={
                <div style={{ width: 400 }}>
                  {groupBy.length === 0 ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', padding: `${token.paddingXS}px 0` }}>
                      No grouping. Rows shown as a flat list.
                    </Typography.Text>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS, maxHeight: 320, overflowY: 'auto' }}>
                      {groupBy.map((entry, i) => {
                        const options = listViewFields
                          .filter((f) => f.key === entry.field || !groupUsedKeys.has(f.key))
                          .map((f) => ({ value: f.key, label: f.label }))
                        const isDropTarget = groupDragOver?.field === entry.field
                        const dropBefore = isDropTarget && groupDragOver?.position === 'before'
                        const dropAfter = isDropTarget && groupDragOver?.position === 'after'
                        return (
                          <div
                            key={entry.field}
                            draggable
                            onDragStart={(e) => handleGroupDragStart(e, entry.field)}
                            onDragOver={(e) => handleGroupDragOver(e, entry.field)}
                            onDrop={(e) => handleGroupDrop(e, entry.field)}
                            onDragEnd={handleGroupDragEnd}
                            style={{
                              position: 'relative',
                              display: 'flex',
                              alignItems: 'center',
                              gap: token.marginXS,
                            }}
                          >
                            {dropBefore && (
                              <div style={{ position: 'absolute', left: 0, right: 0, top: -4, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />
                            )}
                            {dropAfter && (
                              <div style={{ position: 'absolute', left: 0, right: 0, bottom: -4, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />
                            )}
                            <HolderOutlined style={{ color: token.colorTextTertiary, cursor: 'grab', fontSize: 14 }} />
                            <Select
                              size="small"
                              showSearch
                              optionFilterProp="label"
                              style={{ flex: 1 }}
                              value={entry.field}
                              options={options}
                              onChange={(v) => updateGroupEntry(i, { field: v })}
                            />
                            <Select
                              size="small"
                              style={{ width: 80 }}
                              value={entry.direction}
                              options={[
                                { value: 'asc', label: 'asc' },
                                { value: 'desc', label: 'desc' },
                              ]}
                              onChange={(v) => updateGroupEntry(i, { direction: v as 'asc' | 'desc' })}
                            />
                            <Button type="text" size="small" icon={<DeleteOutlined />} onClick={() => removeGroupEntry(i)} />
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <Button
                    block
                    type="link"
                    size="small"
                    icon={<PlusOutlined />}
                    disabled={groupBy.length >= listViewFields.length}
                    onClick={addGroupEntry}
                    style={{ marginTop: token.marginSM }}
                  >
                    Add group
                  </Button>
                  {groupBy.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: token.marginXS, paddingTop: token.paddingXS, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                      <Button size="small" type="link" danger onClick={() => setGroupBy([])}>Clear grouping</Button>
                    </div>
                  )}
                </div>
              }
            >
              <Tooltip title="Group">
                <Badge dot={groupBy.length > 0} offset={[-4, 4]}>
                  <Button type="text" icon={<GroupOutlined />} />
                </Badge>
              </Tooltip>
            </Popover>
            <Popover
              trigger="click"
              placement="bottom"
              content={
                <div style={{ width: 280 }}>
                  <Input
                    allowClear
                    size="small"
                    placeholder="Search fields..."
                    prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
                    value={hideFieldsSearch}
                    onChange={(e) => setHideFieldsSearch(e.target.value)}
                    style={{ marginBottom: token.marginSM }}
                  />
                  <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                    {hideFieldsFiltered.length === 0 ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12, padding: `${token.paddingXS}px 0` }}>No fields match your search.</Typography.Text>
                    ) : hideFieldsFiltered.map((f) => {
                      const isHidden = hiddenKeys.includes(f.key)
                      const isDropTarget = dragOverInfo?.key === f.key
                      const dropBefore = isDropTarget && dragOverInfo?.position === 'before'
                      const dropAfter = isDropTarget && dragOverInfo?.position === 'after'
                      return (
                        <div
                          key={f.key}
                          draggable
                          onDragStart={(e) => handleFieldDragStart(e, f.key)}
                          onDragOver={(e) => handleFieldDragOver(e, f.key)}
                          onDrop={(e) => handleFieldDrop(e, f.key)}
                          onDragEnd={handleFieldDragEnd}
                          style={{
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            gap: token.marginXS,
                            padding: `${token.paddingXXS}px ${token.paddingXS}px`,
                            borderRadius: token.borderRadiusSM,
                            cursor: 'default',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = token.colorFillTertiary }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                        >
                          {dropBefore && (
                            <div style={{ position: 'absolute', left: 0, right: 0, top: -1, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />
                          )}
                          {dropAfter && (
                            <div style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />
                          )}
                          <HolderOutlined style={{ color: token.colorTextTertiary, cursor: 'grab', fontSize: 14 }} />
                          <Checkbox
                            checked={!isHidden}
                            onChange={(e) => {
                              setHiddenKeys((prev) => e.target.checked ? prev.filter((k) => k !== f.key) : [...prev, f.key])
                            }}
                          >
                            {f.label}
                          </Checkbox>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: token.marginSM, paddingTop: token.paddingXS, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                    <Button size="small" type="link" onClick={() => setHiddenKeys([])}>Show all</Button>
                    <Button size="small" type="link" onClick={() => setHiddenKeys(listViewFields.map((f) => f.key))}>Hide all</Button>
                  </div>
                </div>
              }
            >
              <Tooltip title="Hide fields">
                <Badge dot={hiddenKeys.length > 0} offset={[-4, 4]}>
                  <Button type="text" icon={<EyeInvisibleOutlined />} />
                </Badge>
              </Tooltip>
            </Popover>
            <Popover
              trigger="click"
              placement="bottom"
              destroyTooltipOnHide
              content={
                <div style={{ width: 320 }}>
                  <Input
                    allowClear
                    autoFocus
                    placeholder="Search all fields..."
                    prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              }
            >
              <Tooltip title="Search">
                <Badge dot={searchQuery.trim().length > 0} offset={[-4, 4]}>
                  <Button type="text" icon={<SearchOutlined />} />
                </Badge>
              </Tooltip>
            </Popover>
          </div>

          {/* Right cluster — save buttons */}
          <div style={{ display: 'flex', gap: token.marginXS, marginLeft: 'auto' }}>
            {pList.state.savedConfig && pList.isDirty && (
              <Button onClick={handleCancelChanges}>Cancel Changes</Button>
            )}
            <Button
              type="primary"
              disabled={!pList.state.savedConfig || !pList.isDirty}
              loading={mUpdateView.mutation.isPending}
              onClick={handleSaveCurrentView}
            >
              Save
            </Button>
            <Button
              loading={mCreateView.mutation.isPending && nameModal?.title === 'Save view as'}
              onClick={handleSaveAs}
            >
              Save as view
            </Button>
          </div>
      </div>

      {/* Bottom row: sidebar + table */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {!sidebarCollapsed && (
          <PageEmployees_ViewsSidebar
            organizationId={organizationId}
            onCreateView={handleCreateView}
            onRenameView={handleRenameView}
            onDuplicateView={handleDuplicateView}
            onDeleteView={handleDeleteView}
            onReorderViews={handleReorderViews}
          />
        )}
        <div style={{ flex: 1, overflow: 'auto', background: token.colorBgContainer }}>
          <App_EmployeeDataTable
            organizationId={organizationId}
            hiddenKeys={hiddenKeys}
            searchQuery={searchQuery}
            fieldOrder={fieldOrder}
            sortState={sortState}
            filterState={filterState}
            groupBy={groupBy}
          />
        </div>
      </div>

      {/* Shared name modal — Create / Save As / Rename */}
      <PageEmployees_ViewNameModal
        open={nameModal !== null}
        onClose={() => setNameModal(null)}
        title={nameModal?.title ?? ''}
        initialName={nameModal?.initialName ?? ''}
        submitLabel={nameModal?.submitLabel ?? ''}
        onSubmit={nameModal?.onSubmit ?? (async () => {})}
      />
    </div>
  )
}
