import type {
  EmployeeTable_FieldType,
  EmployeeTable_FilterCondition,
  EmployeeTable_FilterOperator,
  EmployeeTable_SortEntry,
  EmployeeTable_GroupEntry,
} from '@/types/employeeTable.types'

/**
 * Shared filter/sort/group engine for the Employees list view.
 *
 * Both `App_EmployeeDataTable` (ANTD) and `App_EmployeeDataGrid` (Glide) consume the
 * same pipeline so "same inputs → same visible rows" holds across renderers.
 *
 * The engine is pure — no React, no queries. Consumers wrap calls in their own
 * `useMemo`s for memoization.
 */

export type EmployeeTable_FieldMeta = {
  key: string
  label: string
  type: EmployeeTable_FieldType
}

export type EmployeeTable_Row = Record<string, unknown> & { id: string }

export type GroupHeaderRow = {
  __isGroupHeader: true
  __groupLabel: string
  __groupCount: number
  __groupDepth: number
  id: string
}

export type DisplayRow<TRow extends EmployeeTable_Row = EmployeeTable_Row> =
  | TRow
  | GroupHeaderRow

export const isGroupHeader = <TRow extends EmployeeTable_Row>(
  row: DisplayRow<TRow>,
): row is GroupHeaderRow => (row as GroupHeaderRow).__isGroupHeader === true

export const isEmptyValue = (value: unknown) =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

export const formatEngineDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export const compareFieldValues = (a: unknown, b: unknown, type: EmployeeTable_FieldType): number => {
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

export const evaluateOperator = (
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

export const evaluateFilter = <TRow extends EmployeeTable_Row>(
  row: TRow,
  conditions: EmployeeTable_FilterCondition[],
): boolean => {
  if (conditions.length === 0) return true
  return conditions.every((c) =>
    evaluateOperator((row as unknown as Record<string, unknown>)[c.field], c.operator, c.value),
  )
}

export const filterRows = <TRow extends EmployeeTable_Row>(
  rows: readonly TRow[],
  conditions: EmployeeTable_FilterCondition[],
): TRow[] => {
  if (conditions.length === 0) return rows as TRow[]
  return rows.filter((row) => evaluateFilter(row, conditions))
}

export const sortRows = <TRow extends EmployeeTable_Row>(
  rows: readonly TRow[],
  sortState: EmployeeTable_SortEntry[],
  groupBy: EmployeeTable_GroupEntry[],
  fieldsByKey: Record<string, EmployeeTable_FieldMeta>,
): TRow[] => {
  const groupFields = new Set(groupBy.map((e) => e.field))
  const entries: EmployeeTable_SortEntry[] = [
    ...groupBy,
    ...sortState.filter((e) => !groupFields.has(e.field)),
  ]
  if (entries.length === 0) return rows as TRow[]
  const next = [...rows]
  next.sort((a, b) => {
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
  return next
}

export const buildDisplayRows = <TRow extends EmployeeTable_Row>(
  sortedRows: readonly TRow[],
  groupBy: EmployeeTable_GroupEntry[],
  fieldsByKey: Record<string, EmployeeTable_FieldMeta>,
  choicesByField: Record<string, Record<string, string>>,
): DisplayRow<TRow>[] => {
  if (groupBy.length === 0) return sortedRows as TRow[]
  const result: DisplayRow<TRow>[] = []
  const buildLevel = (rows: TRow[], depth: number, ancestorKey: string) => {
    if (depth >= groupBy.length) {
      result.push(...rows)
      return
    }
    const entry = groupBy[depth]!
    const groupField = fieldsByKey[entry.field]
    const groupsMap = new Map<string, TRow[]>()
    for (const row of rows) {
      const rawValue = (row as unknown as Record<string, unknown>)[entry.field]
      const key =
        rawValue === null || rawValue === undefined
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
      else if (groupField?.type === 'date') label = formatEngineDate(key)
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
  buildLevel(sortedRows as TRow[], 0, 'root')
  return result
}

export const pruneCollapsed = <TRow extends EmployeeTable_Row>(
  displayRows: readonly DisplayRow<TRow>[],
  collapsedGroupIds: ReadonlySet<string>,
): DisplayRow<TRow>[] => {
  if (collapsedGroupIds.size === 0) return displayRows as DisplayRow<TRow>[]
  const result: DisplayRow<TRow>[] = []
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
}
