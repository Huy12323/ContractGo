import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { Typography, Button, Tooltip, Input, Popover, Checkbox, Select, InputNumber, DatePicker, Empty, theme, App } from 'antd'
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
  EmployeeTable_FilterCondition,
  EmployeeTable_FilterOperator,
  EmployeeTable_FieldType,
} from '@/types/employeeTable.types'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_OrgEmployeeViews } from '@/hooks/useQ_Tables_OrgEmployeeViews'
import { App_EmployeeDataGrid } from '@/components/employees/App_EmployeeDataGrid'
import { App_EmployeeDetailModal } from '@/components/employees/App_EmployeeDetailModal'
import { App_FilePreviewModal } from '@/components/employees/App_FilePreviewModal'
import { useQ_Files_ReadUrl } from '@/hooks/useQ_Files_ReadUrl'
import { useQ_Tables_OrgFiles } from '@/hooks/useQ_Tables_OrgFiles'
import { FieldTypeIcon } from '@/components/employees/App_EmployeeFieldTypeIcon'
import {
  EmployeeDataTable_UniversalFields,
  isSystemFieldKey,
  type EmployeeDataTable_TableField,
} from '@/types/employeeTable.types'
import { App_EmployeeFieldComposerModal } from '@/components/employees/App_EmployeeFieldComposerModal'
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
  single_select: [
    { value: 'equals', label: 'is' },
    { value: 'not_equals', label: 'is not' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  multi_select: [
    { value: 'contains_any', label: 'contains any of' },
    { value: 'contains_all', label: 'contains all of' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  // File columns are not filterable — value is an opaque files.id string.
  // Present only empty/non-empty since that's the only meaningful filter.
  file: [
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
}

const NO_VALUE_OPERATORS = new Set<EmployeeTable_FilterOperator>(['is_empty', 'is_not_empty', 'is_true', 'is_false'])

const makeNewCondition = (fields: ReadonlyArray<EmployeeDataTable_TableField>): EmployeeTable_FilterCondition => {
  const first = fields[0]
  if (!first) return { field: '', operator: 'is_empty', value: null }
  return {
    field: first.key,
    operator: OPERATORS_BY_TYPE[first.type][0]!.value,
    value: null,
  }
}

type ConditionRowProps = {
  condition: EmployeeTable_FilterCondition
  fields: ReadonlyArray<EmployeeDataTable_TableField>
  choicesByField: Record<string, { value: string; label: string }[]>
  onChange: (next: EmployeeTable_FilterCondition) => void
  onRemove: () => void
}

const ConditionRow = ({ condition, fields, choicesByField, onChange, onRemove }: ConditionRowProps) => {
  const { token } = theme.useToken()
  const field = fields.find((f) => f.key === condition.field)
  const operators = field ? OPERATORS_BY_TYPE[field.type] : []
  const needsValue = !NO_VALUE_OPERATORS.has(condition.operator)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
      <Select
        size="small"
        showSearch
        popupClassName="field-select-popup"
        optionFilterProp="label"
        style={{ flex: 1, minWidth: 120 }}
        value={condition.field}
        options={fields.map((f) => ({ value: f.key, label: f.label, type: f.type }))}
        optionRender={(option) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: token.marginXXS, fontSize: token.fontSizeSM }}>
            <span style={{ color: token.colorTextTertiary, display: 'inline-flex' }}>
              <FieldTypeIcon type={(option.data as { type: EmployeeTable_FieldType }).type} />
            </span>
            {option.label}
          </span>
        )}
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
        popupClassName="field-select-popup"
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
          {field.type === 'single_select' && (
            <Select
              size="small"
              popupClassName="field-select-popup"
              style={{ width: '100%' }}
              value={(condition.value as string | null) ?? undefined}
              options={choicesByField[field.key] ?? []}
              onChange={(v) => onChange({ ...condition, value: v })}
              allowClear
            />
          )}
          {field.type === 'multi_select' && (
            <Select
              size="small"
              mode="multiple"
              popupClassName="field-select-popup"
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

// --- Main list-view component ---
type Props = { entityId: string; organizationId: string }

export const PageEmployees_ListView = ({ entityId, organizationId }: Props) => {
  const { token } = theme.useToken()
  const search = useSearch({ from: '/_protected/$organizationId/employees/' })
  const navigate = useNavigate()

  const qEmployeeColumns = useQ_Tables_EmployeeColumns({ entityId })
  const qEmployeeColumnChoices = useQ_Tables_EmployeeColumnChoices({ entityId })
  const qViews = useQ_Tables_OrgEmployeeViews({ entityId })

  const mCreateView = useM_EmployeeView_Create()
  const mUpdateView = useM_EmployeeView_Update()
  const mDeleteView = useM_EmployeeView_Delete()
  const mReorderViews = useM_EmployeeView_Reorder()
  const { modal } = App.useApp()

  // Active view (authoritative source for all toolbar state)
  const activeView = useMemo(
    () => qViews.employeeViews.find((v) => v.id === search.viewId) ?? null,
    [qViews.employeeViews, search.viewId],
  )

  // Auto-select the first view when no viewId in URL and views exist.
  // Ref guard prevents infinite re-navigation if the target view disappears mid-flight.
  const lastAutoSelectedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!qViews.query.isSuccess) return
    if (search.viewId !== undefined) return
    if (qViews.employeeViews.length === 0) return
    const firstId = qViews.employeeViews[0]!.id
    if (lastAutoSelectedRef.current === firstId) return
    lastAutoSelectedRef.current = firstId
    navigate({ to: '.', search: { viewId: firstId } })
  }, [search.viewId, qViews.employeeViews, qViews.query.isSuccess, navigate])

  // Read sub-fields directly from the active view row (empty defaults when no view selected)
  const sortState = useMemo(() => (activeView?.sort as EmployeeTable_SortEntry[] | null) ?? [], [activeView])
  const filterState = useMemo(() => (activeView?.filter as EmployeeTable_FilterCondition[] | null) ?? [], [activeView])
  const groupByState = useMemo(() => (activeView?.group_by as EmployeeTable_GroupEntry[] | null) ?? [], [activeView])
  const hiddenKeys = useMemo(() => (activeView?.hidden_keys as string[] | null) ?? [], [activeView])
  const fieldOrder = useMemo(() => (activeView?.field_order as string[] | null) ?? [], [activeView])
  const fieldWidths = useMemo(() => (activeView?.field_widths as Record<string, number> | null) ?? {}, [activeView])

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

  // Field composer modal state (wired from `+` column and chevron Edit)
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerColumnId, setComposerColumnId] = useState<string | null>(null)

  // Employee detail modal — opened by clicking the grid's row-number marker.
  // Null = closed; set to the clicked row's id to open. Modal looks up the
  // current row reactively from the employees query so it stays in sync
  // after saves.
  const [modalEmployeeId, setModalEmployeeId] = useState<string | null>(null)

  // File preview modal — opened from grid file-cell clicks AND detail modal file links.
  // The modal itself is scope-agnostic — we resolve URL + metadata here via the
  // employee_col path and hand the modal a pre-resolved view.
  const [previewCtx, setPreviewCtx] = useState<{ file_id: string; employee_id: string; column_id: string } | null>(null)

  const qPreviewUrl = useQ_Files_ReadUrl({
    resource_type: 'employee_col',
    file_id: previewCtx?.file_id ?? null,
    employee_id: previewCtx?.employee_id ?? null,
    column_id: previewCtx?.column_id ?? null,
  })
  const qPreviewOrgFiles = useQ_Tables_OrgFiles({ organizationId })
  const previewFile = previewCtx ? qPreviewOrgFiles.filesMap[previewCtx.file_id] : null

  // Mutation shortcut — every toolbar edit is a surgical per-column patch
  const patchActiveView = useCallback(
    (patch: { filter?: EmployeeTable_FilterCondition[]; sort?: EmployeeTable_SortEntry[]; group_by?: EmployeeTable_GroupEntry[]; hidden_keys?: string[]; field_order?: string[]; field_widths?: Record<string, number> }) => {
      if (!search.viewId) return
      mUpdateView.mutation.mutate({ viewId: search.viewId, ...patch })
    },
    [search.viewId, mUpdateView.mutation],
  )

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

  // System (`__`-prefixed) columns are pinned by the grid and never hidden or reordered
  // by the user — exclude them from the Hide-fields / drag-reorder panel.
  const reorderableFields = useMemo(
    () => listViewFields.filter((f) => !isSystemFieldKey(f.key)),
    [listViewFields],
  )
  const hideFieldsFiltered = useMemo(() => {
    const q = hideFieldsSearch.trim().toLowerCase()
    if (!q) return reorderableFields
    return reorderableFields.filter((f) => f.label.toLowerCase().includes(q))
  }, [reorderableFields, hideFieldsSearch])

  const sortUsedKeys = useMemo(() => new Set(sortState.map((e) => e.field)), [sortState])
  const addSortEntry = useCallback(() => {
    const available = listViewFields.find((f) => !sortUsedKeys.has(f.key))
    if (!available) return
    patchActiveView({ sort: [...sortState, { field: available.key, direction: 'asc' }] })
  }, [listViewFields, sortUsedKeys, sortState, patchActiveView])
  const updateSortEntry = useCallback((idx: number, patch: Partial<EmployeeTable_SortEntry>) => {
    patchActiveView({ sort: sortState.map((e, i) => (i === idx ? { ...e, ...patch } : e)) })
  }, [sortState, patchActiveView])
  const removeSortEntry = useCallback((idx: number) => {
    patchActiveView({ sort: sortState.filter((_, i) => i !== idx) })
  }, [sortState, patchActiveView])

  const groupUsedKeys = useMemo(() => new Set(groupByState.map((e) => e.field)), [groupByState])
  const addGroupEntry = useCallback(() => {
    const available = listViewFields.find((f) => !groupUsedKeys.has(f.key))
    if (!available) return
    patchActiveView({ group_by: [...groupByState, { field: available.key, direction: 'asc' }] })
  }, [listViewFields, groupUsedKeys, groupByState, patchActiveView])
  const updateGroupEntry = useCallback((idx: number, patch: Partial<EmployeeTable_GroupEntry>) => {
    patchActiveView({ group_by: groupByState.map((e, i) => (i === idx ? { ...e, ...patch } : e)) })
  }, [groupByState, patchActiveView])
  const removeGroupEntry = useCallback((idx: number) => {
    patchActiveView({ group_by: groupByState.filter((_, i) => i !== idx) })
  }, [groupByState, patchActiveView])

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
    const next = [...groupByState]
    const sourceIdx = next.findIndex((e) => e.field === sourceField)
    let targetIdx = next.findIndex((e) => e.field === targetField)
    if (sourceIdx === -1 || targetIdx === -1) return
    const [moved] = next.splice(sourceIdx, 1)
    if (!moved) return
    if (sourceIdx < targetIdx) targetIdx -= 1
    const insertAt = position === 'after' ? targetIdx + 1 : targetIdx
    next.splice(insertAt, 0, moved)
    patchActiveView({ group_by: next })
  }, [groupDragOver, groupByState, patchActiveView])

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
    const next = [...sortState]
    const sourceIdx = next.findIndex((e) => e.field === sourceField)
    let targetIdx = next.findIndex((e) => e.field === targetField)
    if (sourceIdx === -1 || targetIdx === -1) return
    const [moved] = next.splice(sourceIdx, 1)
    if (!moved) return
    if (sourceIdx < targetIdx) targetIdx -= 1
    const insertAt = position === 'after' ? targetIdx + 1 : targetIdx
    next.splice(insertAt, 0, moved)
    patchActiveView({ sort: next })
  }, [sortDragOver, sortState, patchActiveView])

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
    const baseOrder = fieldOrder.length > 0 ? fieldOrder : listViewFields.map((f) => f.key)
    const next = [...baseOrder]
    const sourceIdx = next.indexOf(sourceKey)
    let targetIdx = next.indexOf(targetKey)
    if (sourceIdx === -1 || targetIdx === -1) return
    next.splice(sourceIdx, 1)
    if (sourceIdx < targetIdx) targetIdx -= 1
    const insertAt = position === 'after' ? targetIdx + 1 : targetIdx
    next.splice(insertAt, 0, sourceKey)
    patchActiveView({ field_order: next })
  }, [dragOverInfo, fieldOrder, listViewFields, patchActiveView])

  // Sidebar actions (create / rename / duplicate / delete / reorder)
  const handleCreateView = useCallback(() => {
    setNameModal({
      title: 'Create view',
      initialName: '',
      submitLabel: 'Create',
      onSubmit: async (name) => {
        const created = await mCreateView.mutation.mutateAsync({
          entity_id: entityId,
          name,
          sort_order: computeTopSortOrder(),
        })
        setNameModal(null)
        navigate({ to: '.', search: { viewId: created.id } })
      },
    })
  }, [mCreateView.mutation, organizationId, navigate, computeTopSortOrder])

  const handleRenameView = useCallback((view: EmployeeViewRow) => {
    setNameModal({
      title: 'Rename view',
      initialName: view.name,
      submitLabel: 'Save',
      onSubmit: async (name) => {
        await mUpdateView.mutation.mutateAsync({ viewId: view.id, name })
        setNameModal(null)
      },
    })
  }, [mUpdateView.mutation])

  const handleDuplicateView = useCallback(async (view: EmployeeViewRow) => {
    const created = await mCreateView.mutation.mutateAsync({
      entity_id: entityId,
      name: `Copy of ${view.name}`,
      sort_order: computeAfterSortOrder(view.id),
      filter: view.filter,
      sort: view.sort,
      group_by: view.group_by,
      hidden_keys: view.hidden_keys,
      field_order: view.field_order,
      field_widths: view.field_widths,
    })
    navigate({ to: '.', search: { viewId: created.id } })
  }, [mCreateView.mutation, organizationId, navigate, computeAfterSortOrder])

  const handleReorderViews = useCallback((orderedIds: string[]) => {
    mReorderViews.mutation.mutate({ entityId, orderedIds })
  }, [mReorderViews.mutation, entityId])

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

  // --- Toolbar button shared styling ---
  const toolButtonBaseStyle: React.CSSProperties = {
    fontWeight: 400,
  }
  const toolButtonActiveStyle: React.CSSProperties = {
    ...toolButtonBaseStyle,
    background: token.colorPrimaryBg,
    color: token.colorPrimary,
    borderColor: token.colorPrimaryBg,
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Compact field-picker dropdowns — shrink option rows (Provider_ANTD sets Select.controlHeight: 40 which cascades to optionHeight) */}
      <style>{`
        .field-select-popup .ant-select-item { min-height: 0; padding: ${token.paddingXS}px ${token.paddingSM}px; line-height: 1.4; }
        .field-select-popup .ant-select-item-option-content { font-size: ${token.fontSizeSM}px; }
      `}</style>
      {/* Inner toolbar — spans full width above sidebar + table */}
      <div style={{
        height: 40,
        minHeight: 40,
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
          <Button type="text" size="small" icon={<MenuOutlined />} onClick={() => setSidebarCollapsed((c) => !c)} />
        </Tooltip>
        <Typography.Text
          strong
          ellipsis={{ tooltip: activeView?.name ?? 'No view selected' }}
          style={{ maxWidth: 240, fontSize: token.fontSizeSM }}
        >
          {activeView?.name ?? 'No view selected'}
        </Typography.Text>

        {/* Right cluster — tool buttons in order: Hide Fields → Filters → Groups → Sort */}
        <div style={{ display: 'flex', gap: token.marginXS, marginLeft: 'auto' }}>
          {/* Hide Fields */}
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
                        {dropBefore && (<div style={{ position: 'absolute', left: 0, right: 0, top: -1, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />)}
                        {dropAfter && (<div style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />)}
                        <HolderOutlined style={{ color: token.colorTextTertiary, cursor: 'grab', fontSize: 14 }} />
                        <Checkbox
                          checked={!isHidden}
                          onChange={(e) => {
                            const next = e.target.checked ? hiddenKeys.filter((k) => k !== f.key) : [...hiddenKeys, f.key]
                            patchActiveView({ hidden_keys: next })
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXXS, fontSize: token.fontSizeSM }}>
                            <span style={{ color: token.colorTextTertiary, display: 'inline-flex' }}>
                              <FieldTypeIcon type={f.type} />
                            </span>
                            {f.label}
                          </span>
                        </Checkbox>
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: token.marginSM, paddingTop: token.paddingXS, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                  <Button size="small" type="link" onClick={() => patchActiveView({ hidden_keys: [] })}>Show all</Button>
                  <Button size="small" type="link" onClick={() => patchActiveView({ hidden_keys: reorderableFields.map((f) => f.key) })}>Hide all</Button>
                </div>
              </div>
            }
          >
            <Button
              type="text"
              size="small"
              icon={<EyeInvisibleOutlined />}
              style={hiddenKeys.length > 0 ? toolButtonActiveStyle : toolButtonBaseStyle}
              disabled={!activeView}
            >
              {hiddenKeys.length > 0 ? `${hiddenKeys.length} hidden` : 'Hide fields'}
            </Button>
          </Popover>

          {/* Filters */}
          <Popover
            trigger="click"
            placement="bottom"
            content={
              <div style={{ width: 560, maxHeight: 480, overflowY: 'auto' }}>
                {filterState.length === 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: token.marginSM }}>
                    No filters. All employees shown.
                  </Typography.Text>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
                    {filterState.map((cond, i) => (
                      <ConditionRow
                        key={i}
                        condition={cond}
                        fields={listViewFields}
                        choicesByField={choicesByField}
                        onChange={(next) => patchActiveView({ filter: filterState.map((c, idx) => (idx === i ? next : c)) })}
                        onRemove={() => patchActiveView({ filter: filterState.filter((_, idx) => idx !== i) })}
                      />
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: token.marginSM, paddingTop: token.paddingXS, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                  <Button
                    size="small"
                    type="link"
                    icon={<PlusOutlined />}
                    disabled={listViewFields.length === 0}
                    onClick={() => patchActiveView({ filter: [...filterState, makeNewCondition(listViewFields)] })}
                  >
                    Add condition
                  </Button>
                  {filterState.length > 0 && (
                    <Button size="small" type="link" danger onClick={() => patchActiveView({ filter: [] })}>Clear</Button>
                  )}
                </div>
              </div>
            }
          >
            <Button
              type="text"
              size="small"
              icon={<FilterOutlined />}
              style={filterState.length > 0 ? toolButtonActiveStyle : toolButtonBaseStyle}
              disabled={!activeView}
            >
              {filterState.length > 0 ? `Filtered by ${filterState.length}` : 'Filters'}
            </Button>
          </Popover>

          {/* Groups */}
          <Popover
            trigger="click"
            placement="bottom"
            content={
              <div style={{ width: 400 }}>
                {groupByState.length === 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', padding: `${token.paddingXS}px 0` }}>
                    No grouping. Rows shown as a flat list.
                  </Typography.Text>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS, maxHeight: 320, overflowY: 'auto' }}>
                    {groupByState.map((entry, i) => {
                      const options = listViewFields
                        .filter((f) => f.key === entry.field || !groupUsedKeys.has(f.key))
                        .map((f) => ({ value: f.key, label: f.label, type: f.type }))
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
                          style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: token.marginXS }}
                        >
                          {dropBefore && (<div style={{ position: 'absolute', left: 0, right: 0, top: -4, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />)}
                          {dropAfter && (<div style={{ position: 'absolute', left: 0, right: 0, bottom: -4, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />)}
                          <HolderOutlined style={{ color: token.colorTextTertiary, cursor: 'grab', fontSize: 14 }} />
                          <Select
                            size="small"
                            showSearch
                            popupClassName="field-select-popup"
                            optionFilterProp="label"
                            style={{ flex: 1 }}
                            value={entry.field}
                            options={options}
                            optionRender={(option) => (
                              <span style={{ display: 'flex', alignItems: 'center', gap: token.marginXXS, fontSize: token.fontSizeSM }}>
                                <span style={{ color: token.colorTextTertiary, display: 'inline-flex' }}>
                                  <FieldTypeIcon type={(option.data as { type: EmployeeTable_FieldType }).type} />
                                </span>
                                {option.label}
                              </span>
                            )}
                            onChange={(v) => updateGroupEntry(i, { field: v })}
                          />
                          <Select
                            size="small"
                            popupClassName="field-select-popup"
                            style={{ width: 80 }}
                            value={entry.direction}
                            options={[{ value: 'asc', label: 'asc' }, { value: 'desc', label: 'desc' }]}
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
                  disabled={groupByState.length >= listViewFields.length}
                  onClick={addGroupEntry}
                  style={{ marginTop: token.marginSM }}
                >
                  Add group
                </Button>
                {groupByState.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: token.marginXS, paddingTop: token.paddingXS, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                    <Button size="small" type="link" danger onClick={() => patchActiveView({ group_by: [] })}>Clear grouping</Button>
                  </div>
                )}
              </div>
            }
          >
            <Button
              type="text"
              size="small"
              icon={<GroupOutlined />}
              style={groupByState.length > 0 ? toolButtonActiveStyle : toolButtonBaseStyle}
              disabled={!activeView}
            >
              {groupByState.length > 0 ? `Grouped by ${groupByState.length}` : 'Groups'}
            </Button>
          </Popover>

          {/* Sort */}
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
                        .map((f) => ({ value: f.key, label: f.label, type: f.type }))
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
                          style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: token.marginXS }}
                        >
                          {dropBefore && (<div style={{ position: 'absolute', left: 0, right: 0, top: -4, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />)}
                          {dropAfter && (<div style={{ position: 'absolute', left: 0, right: 0, bottom: -4, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />)}
                          <HolderOutlined style={{ color: token.colorTextTertiary, cursor: 'grab', fontSize: 14 }} />
                          <Select
                            size="small"
                            showSearch
                            popupClassName="field-select-popup"
                            optionFilterProp="label"
                            style={{ flex: 1 }}
                            value={entry.field}
                            options={options}
                            optionRender={(option) => (
                              <span style={{ display: 'flex', alignItems: 'center', gap: token.marginXXS, fontSize: token.fontSizeSM }}>
                                <span style={{ color: token.colorTextTertiary, display: 'inline-flex' }}>
                                  <FieldTypeIcon type={(option.data as { type: EmployeeTable_FieldType }).type} />
                                </span>
                                {option.label}
                              </span>
                            )}
                            onChange={(v) => updateSortEntry(i, { field: v })}
                          />
                          <Select
                            size="small"
                            popupClassName="field-select-popup"
                            style={{ width: 80 }}
                            value={entry.direction}
                            options={[{ value: 'asc', label: 'asc' }, { value: 'desc', label: 'desc' }]}
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
            <Button
              type="text"
              size="small"
              icon={<SortAscendingOutlined />}
              style={sortState.length > 0 ? toolButtonActiveStyle : toolButtonBaseStyle}
              disabled={!activeView}
            >
              {sortState.length > 0 ? `Sorted by ${sortState.length}` : 'Sort'}
            </Button>
          </Popover>
        </div>
      </div>

      {/* Bottom row: sidebar + table */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {!sidebarCollapsed && (
          <PageEmployees_ViewsSidebar
            entityId={entityId}
            onCreateView={handleCreateView}
            onRenameView={handleRenameView}
            onDuplicateView={handleDuplicateView}
            onDeleteView={handleDeleteView}
            onReorderViews={handleReorderViews}
          />
        )}
        <div style={{ flex: 1, overflow: 'hidden', background: token.colorBgContainer }}>
          {activeView ? (
            <App_EmployeeDataGrid
              entityId={entityId}
              organizationId={organizationId}
              hiddenKeys={hiddenKeys}
              fieldOrder={fieldOrder}
              sortState={sortState}
              filterState={filterState}
              groupBy={groupByState}
              fieldWidths={fieldWidths}
              onColumnResize={(colKey, width) => patchActiveView({ field_widths: { ...fieldWidths, [colKey]: width } })}
              onColumnOrderChange={(next) => patchActiveView({ field_order: next })}
              onAddField={() => { setComposerColumnId(null); setComposerOpen(true) }}
              onEditField={(colId) => { setComposerColumnId(colId); setComposerOpen(true) }}
              onHideField={(colKey) => patchActiveView({ hidden_keys: [...hiddenKeys, colKey] })}
              onExpandEmployee={(employee) => setModalEmployeeId(employee.id)}
              onFilePreview={setPreviewCtx}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Create a view to get started"
              />
            </div>
          )}
        </div>
      </div>

      {/* Shared name modal — Create / Rename (Save As removed with auto-save) */}
      <PageEmployees_ViewNameModal
        open={nameModal !== null}
        onClose={() => setNameModal(null)}
        title={nameModal?.title ?? ''}
        initialName={nameModal?.initialName ?? ''}
        submitLabel={nameModal?.submitLabel ?? ''}
        onSubmit={nameModal?.onSubmit ?? (async () => {})}
      />

      {/* Field composer — opened from `+` column (create) and chevron Edit (edit) */}
      <App_EmployeeFieldComposerModal
        open={composerOpen}
        onClose={() => { setComposerOpen(false); setComposerColumnId(null) }}
        entityId={entityId}
        columnId={composerColumnId}
      />

      {/* Employee detail — opened from the grid's row-number marker */}
      <App_EmployeeDetailModal
        open={modalEmployeeId !== null}
        employeeId={modalEmployeeId}
        entityId={entityId}
        organizationId={organizationId}
        onClose={() => setModalEmployeeId(null)}
        fields={listViewFields}
        choicesByField={choicesByField}
        onFilePreview={setPreviewCtx}
      />

      {/* File preview modal — shared across grid cells, detail modal file links, AND
         the attachment strip (via App_FilePreviewModal directly inside Card_Attachment). */}
      <App_FilePreviewModal
        open={previewCtx !== null}
        url={qPreviewUrl.url ?? null}
        name={previewFile?.name ?? null}
        contentType={previewFile?.content_type ?? null}
        size={previewFile?.size ?? null}
        onClose={() => setPreviewCtx(null)}
      />
    </div>
  )
}
