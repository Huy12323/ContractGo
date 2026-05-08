import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { DataEditor, GridCellKind, GridColumnIcon } from '@glideapps/glide-data-grid'
import type { GridCell, GridColumn, Item, Rectangle, Theme, DataEditorRef, GridMouseEventArgs } from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import { Empty, Dropdown, App, theme } from 'antd'
import type { MenuProps } from 'antd'
import { EditOutlined, EyeInvisibleOutlined, DeleteOutlined } from '@ant-design/icons'
import { useQueries } from '@tanstack/react-query'
import { supabase } from '@/configs/supabase/config'
import { QueryKeys } from '@/utils/query/queryKeys'
import { Utils_Glide_CrossOriginImageLoader } from '@/utils/Utils_Glide_CrossOriginImageLoader'
import { Utils_FileTypeIcon_DataUri } from '@/utils/Utils_FileTypeIcon'
import { useQ_Tables_OrgEmployees, type Tables_OrgEmployees_QueryData } from '@/hooks/useQ_Tables_OrgEmployees'
import { useQ_Tables_EmployeeColumns } from '@/hooks/useQ_Tables_EmployeeColumns'
import { useQ_Tables_EmployeeColumnChoices } from '@/hooks/useQ_Tables_EmployeeColumnChoices'
import { useM_EmployeeColumn_Delete } from '@/hooks/useM_EmployeeColumn_Delete'
import { useQ_Tables_OrgFiles } from '@/hooks/useQ_Tables_OrgFiles'
import { useGlideTheme, GRID_EXPAND_ICON, drawExpandIcon } from '@/hooks/useGlideTheme'
import {
  EmployeeDataTable_UniversalFields,
  isSystemFieldKey,
  type EmployeeDataTable_TableField,
  type EmployeeTable_SortEntry,
  type EmployeeTable_GroupEntry,
  type EmployeeTable_FilterCondition,
  type EmployeeTable_FieldType,
} from '@/types/employeeTable.types'
import {
  filterRows,
  sortRows,
  buildDisplayRows,
  pruneCollapsed,
  isGroupHeader,
  type DisplayRow,
} from '@/utils/Utils_EmployeeTable_Engine'

type EmployeeRow = Tables_OrgEmployees_QueryData[number]
type DisplayEmployeeRow = DisplayRow<EmployeeRow>

const UNIVERSAL_FIELDS = EmployeeDataTable_UniversalFields
const UNIVERSAL_KEYS = new Set(['first_name', 'last_name', 'email', 'birthday'])
const DEFAULT_COLUMN_WIDTH = 180
const MIN_COLUMN_WIDTH = 100

const FIELD_TYPE_TO_ICON: Record<EmployeeTable_FieldType, GridColumnIcon> = {
  text: GridColumnIcon.HeaderString,
  number: GridColumnIcon.HeaderNumber,
  date: GridColumnIcon.HeaderDate,
  boolean: GridColumnIcon.HeaderBoolean,
  single_select: GridColumnIcon.HeaderSingleValue,
  multi_select: GridColumnIcon.HeaderArray,
  file: GridColumnIcon.HeaderUri,
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

type Props = {
  entityId: string
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
  onExpandEmployee?: (employee: EmployeeRow) => void
  onFilePreview?: (ctx: { file_id: string; employee_id: string; column_id: string }) => void
}

export const App_EmployeeDataGrid = ({
  entityId,
  organizationId,
  filter,
  sortState,
  filterState,
  groupBy,
  fieldOrder,
  fieldWidths,
  hiddenKeys,
  onColumnResize,
  onColumnOrderChange,
  onAddField,
  onEditField,
  onHideField,
  onExpandEmployee,
  onFilePreview,
}: Props) => {
  const { token } = theme.useToken()
  const { modal } = App.useApp()
  const qEmployees = useQ_Tables_OrgEmployees({ entityId })
  const qColumns = useQ_Tables_EmployeeColumns({ entityId })
  const qChoices = useQ_Tables_EmployeeColumnChoices({ entityId })
  const qOrgFiles = useQ_Tables_OrgFiles({ organizationId })
  const mDeleteColumn = useM_EmployeeColumn_Delete()

  const gridRef = useRef<DataEditorRef>(null)
  const hoveredRowRef = useRef<number | undefined>(undefined)

  const [menu, setMenu] = useState<{ colIndex: number; bounds: Rectangle } | null>(null)
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set())
  // Local overrides during resize / reorder gestures. The mutation's `onMutate` awaits
  // `cancelQueries` before patching the cache, introducing a microtask gap between
  // gesture release and the new `fieldWidths`/`fieldOrder` props arriving. During that
  // gap Glide's internal drag preview clears and it reads the stale prop → visible
  // flicker to the old position/width. Override locally until the prop catches up.
  const [localWidths, setLocalWidths] = useState<Record<string, number>>({})
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)

  // Drop width overrides once the external fieldWidths prop catches up (mutation landed).
  // On mutation error the external won't match, so the user's dragged value stays visible.
  useEffect(() => {
    setLocalWidths((prev) => {
      const keys = Object.keys(prev)
      if (keys.length === 0) return prev
      let changed = false
      const next: Record<string, number> = {}
      for (const key of keys) {
        const external = fieldWidths?.[key]
        if (external === prev[key] || external === undefined) {
          changed = true
        } else {
          next[key] = prev[key]!
        }
      }
      return changed ? next : prev
    })
  }, [fieldWidths])

  // Drop order override once external fieldOrder matches (or cleared)
  useEffect(() => {
    if (localOrder === null) return
    if (!fieldOrder || fieldOrder.length !== localOrder.length) return
    const match = fieldOrder.every((k, i) => k === localOrder[i])
    if (match) setLocalOrder(null)
  }, [fieldOrder, localOrder])

  // Outside-click + Escape to close the header menu. ANTD Dropdown with `trigger={[]}`
  // has no bound target to attach its own outside-click listener to, so we handle it
  // ourselves. The mousedown listener is attached on the next tick to avoid being
  // triggered by the same canvas click that opened the menu.
  useEffect(() => {
    if (!menu) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('.ant-dropdown')) return
      setMenu(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onMouseDown)
      document.addEventListener('keydown', onKeyDown)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  const fields = useMemo<EmployeeDataTable_TableField[]>(() => {
    const dynamic: EmployeeDataTable_TableField[] = qColumns.columns.map((c) => ({
      key: c.id,
      label: c.label,
      type: c.type as EmployeeTable_FieldType,
    }))
    const base = [...UNIVERSAL_FIELDS, ...dynamic]
    const orderSrc = localOrder ?? fieldOrder ?? []
    const ordered = orderSrc.length === 0
      ? base
      : (() => {
          const byKey = new Map(base.map((f) => [f.key, f]))
          const orderSet = new Set(orderSrc)
          const out: EmployeeDataTable_TableField[] = []
          for (const key of orderSrc) {
            const f = byKey.get(key)
            if (f) out.push(f)
          }
          for (const f of base) {
            if (!orderSet.has(f.key)) out.push(f)
          }
          return out
        })()
    // System columns (`__`-prefixed) are pinned to the front — ignore any `fieldOrder`
    // positioning for them. Grid also hardcodes `freezeColumns={1}`, so the first
    // entry (currently `__full_name`) becomes the sticky primary-identifier column.
    const system = ordered.filter((f) => isSystemFieldKey(f.key))
    const rest = ordered.filter((f) => !isSystemFieldKey(f.key))
    return [...system, ...rest]
  }, [qColumns.columns, fieldOrder, localOrder])

  const visibleFields = useMemo(() => {
    const hidden = new Set(hiddenKeys ?? [])
    // System columns ignore `hiddenKeys` — they can never be hidden.
    return fields.filter((f) => isSystemFieldKey(f.key) || !hidden.has(f.key))
  }, [fields, hiddenKeys])

  const fieldsByKey = useMemo(() => {
    const map: Record<string, EmployeeDataTable_TableField> = {}
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

  // Filter → sort → group → prune — same pipeline the Table uses (via the shared engine).
  const baseRows = useMemo(
    () => (filter ? qEmployees.employees.filter(filter) : qEmployees.employees),
    [qEmployees.employees, filter],
  )
  const filteredRows = useMemo(
    () => filterRows(baseRows, filterState ?? []),
    [baseRows, filterState],
  )
  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortState ?? [], groupBy ?? [], fieldsByKey),
    [filteredRows, sortState, groupBy, fieldsByKey],
  )
  const displayRows = useMemo<DisplayEmployeeRow[]>(
    () => buildDisplayRows(sortedRows, groupBy ?? [], fieldsByKey, choicesByField),
    [sortedRows, groupBy, fieldsByKey, choicesByField],
  )
  const visibleRows = useMemo<DisplayEmployeeRow[]>(
    () => pruneCollapsed(displayRows, collapsedGroupIds),
    [displayRows, collapsedGroupIds],
  )

  // Map sort state → per-column direction marker (↑ / ↓) appended to the column title.
  // Glide's GridColumnIcon set has no sort arrow and registering a custom SpriteMap
  // glyph is finicky — a unicode suffix reads clearly without extra machinery.
  const sortByKey = useMemo(() => {
    const map = new Map<string, 'asc' | 'desc'>()
    for (const e of sortState ?? []) map.set(e.field, e.direction)
    return map
  }, [sortState])

  const columns = useMemo<GridColumn[]>(() => {
    const real: GridColumn[] = visibleFields.map((f) => {
      const dir = sortByKey.get(f.key)
      const suffix = dir === 'asc' ? ' ↑' : dir === 'desc' ? ' ↓' : ''
      return {
        title: `${f.label}${suffix}`,
        id: f.key,
        width: localWidths[f.key] ?? fieldWidths?.[f.key] ?? DEFAULT_COLUMN_WIDTH,
        icon: FIELD_TYPE_TO_ICON[f.type],
        hasMenu: true,
      }
    })
    const addCol: GridColumn = {
      title: '',
      id: '__add_field__',
      width: 48,
      hasMenu: false,
    }
    return [...real, addCol]
  }, [visibleFields, fieldWidths, localWidths, sortByKey])

  const addFieldColIndex = visibleFields.length
  const lastColIndex = visibleFields.length // includes the synthetic "+" col at N

  // Thumbnail URL resolution for file-type cells. We need a URL per (file_id,
  // employee_id, column_id) triple because the sign-read-url edge fn gates access
  // by (employee, column) for RLS. Files can appear in many cells in theory; in
  // practice one file belongs to one (employee, column) pair, so fileId uniqueness
  // is sufficient for the map key.
  const thumbnailCells = useMemo(() => {
    const cells: Array<{ file_id: string; employee_id: string; column_id: string }> = []
    const seen = new Set<string>()
    for (const record of visibleRows) {
      if (isGroupHeader(record)) continue
      const employeeId = (record as unknown as { id?: string }).id
      if (!employeeId) continue
      for (const field of visibleFields) {
        if (field.type !== 'file') continue
        const fileId = (record as unknown as Record<string, unknown>)[field.key]
        if (typeof fileId !== 'string' || !fileId) continue
        if (seen.has(fileId)) continue
        const filesRow = qOrgFiles.filesMap[fileId]
        // `thumbnail_r2_key` is null until the backend generates a thumbnail —
        // skip those rows so we don't fire a 404 on every render.
        if (!filesRow?.thumbnail_r2_key) continue
        seen.add(fileId)
        cells.push({ file_id: fileId, employee_id: employeeId, column_id: field.key })
      }
    }
    return cells
  }, [visibleRows, visibleFields, qOrgFiles.filesMap])

  const SIX_DAYS_MS = 6 * 24 * 3600 * 1000
  const thumbnailQueries = useQueries({
    queries: thumbnailCells.map((c) => ({
      queryKey: [
        ...QueryKeys.files.record(c.file_id),
        'read-url',
        { employee_id: c.employee_id, column_id: c.column_id, use_thumbnail: true },
      ],
      queryFn: async () => {
        const sb_FunctionsFilesR2SignReadUrl_Invoke = await supabase.functions.invoke(
          'files_r2_sign-read-url',
          {
            body: {
              resource_type: 'employee_col',
              file_id: c.file_id,
              employee_id: c.employee_id,
              column_id: c.column_id,
              use_thumbnail: true,
            },
          },
        )
        if (sb_FunctionsFilesR2SignReadUrl_Invoke.error) throw sb_FunctionsFilesR2SignReadUrl_Invoke.error
        return sb_FunctionsFilesR2SignReadUrl_Invoke.data as { url: string; expiresAt: string }
      },
      staleTime: SIX_DAYS_MS,
    })),
  })

  const thumbnailUrlsMap = useMemo(() => {
    const map: Record<string, string> = {}
    thumbnailCells.forEach((c, i) => {
      const url = thumbnailQueries[i]?.data?.url
      if (url) map[c.file_id] = url
    })
    return map
  }, [thumbnailCells, thumbnailQueries])

  // Glide's default image loader creates `new Image()` without `crossOrigin`,
  // which taints the canvas when drawing cross-origin thumbnails. Our custom
  // loader sets `crossOrigin="anonymous"` so the R2 Worker's `*` CORS header
  // lets the canvas draw the bitmap.
  const imageWindowLoader = useMemo(() => new Utils_Glide_CrossOriginImageLoader(), [])

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const record = visibleRows[row]
      if (!record) {
        return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false }
      }
      // Group header row — spans all columns. drawCell paints the custom look below.
      if (isGroupHeader(record)) {
        return {
          kind: GridCellKind.Text,
          data: '',
          displayData: '',
          allowOverlay: false,
          span: [0, lastColIndex],
          themeOverride: { bgCell: token.colorFillAlter },
        }
      }
      const field = visibleFields[col]
      if (!field) {
        return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false }
      }
      const value = (record as unknown as Record<string, unknown>)[field.key]
      const isPrimaryCol = col === 0 && isSystemFieldKey(field.key)
      const expandPadding = isPrimaryCol ? { cellHorizontalPadding: GRID_EXPAND_ICON.padding } : undefined
      if (field.type !== 'boolean' && isEmpty(value)) {
        return {
          kind: GridCellKind.Text,
          data: '',
          displayData: 'Null',
          allowOverlay: false,
          ...(isPrimaryCol && { cursor: "pointer" as const }),
          themeOverride: { textDark: token.colorTextTertiary, ...expandPadding },
        }
      }
      switch (field.type) {
        case 'number':
          return {
            kind: GridCellKind.Number,
            data: value as number,
            displayData: String(value),
            allowOverlay: false,
          }
        case 'date':
          return {
            kind: GridCellKind.Text,
            data: value as string,
            displayData: formatDate(value as string),
            allowOverlay: false,
          }
        case 'boolean':
          return {
            kind: GridCellKind.Boolean,
            data: value === true,
            allowOverlay: false,
            readonly: true,
          }
        case 'single_select': {
          const labels = choicesByField[field.key] ?? {}
          const key = value as string
          return { kind: GridCellKind.Bubble, data: [labels[key] ?? key], allowOverlay: false }
        }
        case 'multi_select': {
          const labels = choicesByField[field.key] ?? {}
          const arr = (value as string[]).map((v) => labels[v] ?? v)
          return { kind: GridCellKind.Bubble, data: arr, allowOverlay: false }
        }
        case 'file': {
          const fileId = value as string
          const filesRow = qOrgFiles.filesMap[fileId]
          const thumbnailUrl = thumbnailUrlsMap[fileId]
          // Drilldown cell = pill with thumbnail + filename side-by-side. Falls back
          // to the ANTD TwoTone data URI (red PDF, blue Word, etc.) when no thumbnail
          // exists. onCellClicked still opens the preview modal.
          const img = thumbnailUrl ?? Utils_FileTypeIcon_DataUri(filesRow?.content_type ?? '')
          const name = filesRow?.name ?? fileId
          return {
            kind: GridCellKind.Drilldown,
            data: [{ text: name, img }],
            allowOverlay: false,
          }
        }
        case 'text':
        default:
          return {
            kind: GridCellKind.Text,
            data: String(value),
            displayData: String(value),
            allowOverlay: false,
            ...(isPrimaryCol && { cursor: "pointer" as const }),
            ...(expandPadding && { themeOverride: expandPadding }),
          }
      }
    },
    [visibleFields, visibleRows, choicesByField, qOrgFiles.filesMap, thumbnailUrlsMap, token.colorTextTertiary, token.colorFillAlter, token.colorLink, lastColIndex],
  )

  // Per-tick during drag. Glide's live resize preview depends on us updating the
  // `columns[i].width` prop on every tick — without this, the cursor drags but the
  // column edge stays frozen. flushSync forces the React commit inside the event
  // handler so Glide sees the new width in the next canvas frame (no lag).
  const handleColumnResize = useCallback(
    (_col: GridColumn, newSize: number, colIndex: number) => {
      if (colIndex >= visibleFields.length) return
      const field = visibleFields[colIndex]
      if (!field) return
      const size = Math.max(MIN_COLUMN_WIDTH, newSize)
      flushSync(() => {
        setLocalWidths((prev) => ({ ...prev, [field.key]: size }))
      })
    },
    [visibleFields],
  )

  // On release — commit to the saved view. The local override is already at the
  // final value from the last `onColumnResize` tick, so Glide keeps showing it
  // until the mutation's optimistic cache patch arrives and the effect drops the
  // override.
  const handleColumnResizeEnd = useCallback(
    (_col: GridColumn, newSize: number, colIndex: number) => {
      if (colIndex >= visibleFields.length) return
      const field = visibleFields[colIndex]
      if (!field) return
      const size = Math.max(MIN_COLUMN_WIDTH, newSize)
      onColumnResize?.(field.key, size)
    },
    [visibleFields, onColumnResize],
  )

  // Proposed during drag — returning false blocks Glide's visual preview so the
  // user never sees a system column (index 0) appear to swap places with the
  // dragged column. Without this, the drop handler rejects and the preview snaps
  // back, which reads as jank.
  const handleColumnProposeMove = useCallback(
    (from: number, to: number) => from !== 0 && to !== 0,
    [],
  )

  const handleColumnMoved = useCallback(
    (from: number, to: number) => {
      if (from === to) return
      if (from >= visibleFields.length || to >= visibleFields.length) return
      // Defensive: onColumnProposeMove already blocks this at the drag layer.
      if (from === 0 || to === 0) return
      const visibleKeys = visibleFields.map((f) => f.key)
      const nextVisible = [...visibleKeys]
      const [moved] = nextVisible.splice(from, 1)
      if (!moved) return
      nextVisible.splice(to, 0, moved)
      const hidden = new Set(hiddenKeys ?? [])
      const baseOrder = fieldOrder && fieldOrder.length > 0 ? fieldOrder : fields.map((f) => f.key)
      let visibleIdx = 0
      const nextFullOrder = baseOrder.map((key) => {
        if (hidden.has(key)) return key
        const replacement = nextVisible[visibleIdx]
        visibleIdx += 1
        return replacement ?? key
      })
      // flushSync: same rationale as resize — commit the order override synchronously
      // so Glide's post-drop render sees the new `columns` prop in the same frame.
      flushSync(() => {
        setLocalOrder(nextFullOrder)
      })
      onColumnOrderChange?.(nextFullOrder)
    },
    [visibleFields, fields, fieldOrder, hiddenKeys, onColumnOrderChange],
  )

  const handleHeaderMenuClick = useCallback(
    (colIndex: number, bounds: Rectangle) => {
      // System columns have no interactions — suppress the menu entirely.
      const field = visibleFields[colIndex]
      if (field && isSystemFieldKey(field.key)) return
      setMenu({ colIndex, bounds })
    },
    [visibleFields],
  )

  const handleHeaderClicked = useCallback(
    (colIndex: number) => {
      if (colIndex === addFieldColIndex) onAddField?.()
    },
    [addFieldColIndex, onAddField],
  )

  const handleCellClicked = useCallback(
    ([col, row]: Item) => {
      const record = visibleRows[row]
      if (!record) return
      if (isGroupHeader(record)) {
        if (col !== 0) return
        setCollapsedGroupIds((prev) => {
          const next = new Set(prev)
          if (next.has(record.id)) next.delete(record.id)
          else next.add(record.id)
          return next
        })
        return
      }
      if (col === 0) {
        onExpandEmployee?.(record as EmployeeRow)
        return
      }
      const field = visibleFields[col]
      if (field && field.type === 'file') {
        const fileId = (record as unknown as Record<string, unknown>)[field.key]
        if (typeof fileId === 'string' && fileId) {
          onFilePreview?.({
            file_id: fileId,
            employee_id: (record as EmployeeRow).id,
            column_id: field.key,
          })
        }
      }
    },
    [visibleRows, visibleFields, onExpandEmployee, onFilePreview],
  )

  const handleDeleteField = useCallback(
    (columnId: string, label: string) => {
      modal.confirm({
        title: 'Delete field?',
        content: `"${label}" and all its data will be permanently removed. This cannot be undone.`,
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: () => mDeleteColumn.mutation.mutateAsync({ columnId }),
      })
    },
    [modal, mDeleteColumn.mutation],
  )

  const menuField = menu ? visibleFields[menu.colIndex] : undefined
  const menuItems: MenuProps['items'] = menuField
    ? [
        {
          key: 'edit',
          icon: <EditOutlined />,
          label: 'Edit field',
          disabled: UNIVERSAL_KEYS.has(menuField.key),
        },
        { key: 'hide', icon: <EyeInvisibleOutlined />, label: 'Hide column' },
        { type: 'divider' },
        {
          key: 'delete',
          icon: <DeleteOutlined />,
          label: 'Delete field',
          danger: true,
          disabled: UNIVERSAL_KEYS.has(menuField.key),
        },
      ]
    : []

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (!menuField) return
    if (key === 'edit') onEditField?.(menuField.key)
    else if (key === 'hide') onHideField?.(menuField.key)
    else if (key === 'delete') handleDeleteField(menuField.key, menuField.label)
    setMenu(null)
  }

  const handleItemHovered = useCallback((args: GridMouseEventArgs) => {
    const newRow = args.kind === "cell" ? args.location[1] : undefined
    if (hoveredRowRef.current !== newRow) {
      const damage: { cell: Item }[] = []
      if (hoveredRowRef.current !== undefined) damage.push({ cell: [0, hoveredRowRef.current] })
      if (newRow !== undefined) damage.push({ cell: [0, newRow] })
      hoveredRowRef.current = newRow
      if (damage.length > 0) gridRef.current?.updateCells(damage)
    }
  }, [])

  const drawCell = useCallback(
    (
      args: {
        ctx: CanvasRenderingContext2D
        col: number
        row: number
        rect: Rectangle
        theme: Theme
      },
      drawContent: () => void,
    ): void => {
      const record = visibleRows[args.row]
      if (!record || !isGroupHeader(record)) {
        drawContent()
        if (args.col === 0 && hoveredRowRef.current === args.row && record && !isGroupHeader(record)) {
          drawExpandIcon(args.ctx, args.rect.x, args.rect.y, args.rect.height, token.colorText)
        }
        return
      }
      if (args.col !== 0) return // spanning cell already painted
      const { ctx, rect, theme: glideTheme } = args
      const indent = record.__groupDepth * 16
      const isCollapsed = collapsedGroupIds.has(record.id)
      ctx.save()
      // Tinted background across the entire row — the span-cell themeOverride already
      // draws this at col 0, but drawing again here guarantees consistent color across
      // row-extending Glide redraws that use damage-rect partial repaints.
      ctx.fillStyle = glideTheme.bgCell
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      // Caret (▸ collapsed / ▾ expanded)
      ctx.fillStyle = glideTheme.textMedium
      ctx.font = `500 11px ${glideTheme.fontFamily}`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillText(isCollapsed ? '▸' : '▾', rect.x + 8 + indent, rect.y + rect.height / 2)
      // Label (field group value)
      ctx.fillStyle = glideTheme.textDark
      ctx.font = `600 12px ${glideTheme.fontFamily}`
      ctx.fillText(record.__groupLabel, rect.x + 26 + indent, rect.y + rect.height / 2)
      // Count pill — right-aligned
      const countText = `${record.__groupCount} ${record.__groupCount === 1 ? 'record' : 'records'}`
      ctx.fillStyle = glideTheme.textLight
      ctx.font = `400 11px ${glideTheme.fontFamily}`
      ctx.textAlign = 'right'
      ctx.fillText(countText, rect.x + rect.width - 12, rect.y + rect.height / 2)
      ctx.restore()
    },
    [visibleRows, collapsedGroupIds, token.colorText],
  )

  // Custom header drawer — the trailing "+" column gets a big centered plus glyph;
  // every other column falls through to Glide's default (`drawContent`).
  const drawHeader = useCallback(
    (
      args: {
        ctx: CanvasRenderingContext2D
        column: GridColumn
        rect: Rectangle
        theme: Theme
      },
      drawContent: () => void,
    ): void => {
      if (args.column.id !== '__add_field__') {
        drawContent()
        return
      }
      const { ctx, rect, theme: glideTheme } = args
      ctx.save()
      ctx.font = `400 20px ${glideTheme.fontFamily}`
      ctx.fillStyle = glideTheme.textLight
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('+', rect.x + rect.width / 2, rect.y + rect.height / 2 + 1)
      ctx.restore()
    },
    [],
  )

  const gridTheme = useGlideTheme()

  if (!qEmployees.query.isLoading && qEmployees.employees.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description="No employees yet" />
      </div>
    )
  }
  if (!qEmployees.query.isLoading && visibleRows.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description="No employees match your filters" />
      </div>
    )
  }

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <DataEditor
        ref={gridRef}
        columns={columns}
        rows={visibleRows.length}
        getCellContent={getCellContent}
        getCellsForSelection
        rowHeight={32}
        headerHeight={36}
        smoothScrollX
        smoothScrollY
        width="100%"
        height="100%"
        freezeColumns={1}
        rowMarkers="number"
        theme={gridTheme}
        drawHeader={drawHeader}
        drawCell={drawCell}
        imageWindowLoader={imageWindowLoader}
        onItemHovered={handleItemHovered}
        onColumnResize={handleColumnResize}
        onColumnResizeEnd={handleColumnResizeEnd}
        onColumnProposeMove={handleColumnProposeMove}
        onColumnMoved={handleColumnMoved}
        onHeaderMenuClick={handleHeaderMenuClick}
        onHeaderClicked={handleHeaderClicked}
        onCellClicked={handleCellClicked}
      />
      {menu && (
        <Dropdown
          open
          trigger={[]}
          onOpenChange={(o) => { if (!o) setMenu(null) }}
          menu={{ items: menuItems, onClick: handleMenuClick }}
        >
          <div
            style={{
              position: 'fixed',
              left: menu.bounds.x,
              top: menu.bounds.y,
              width: menu.bounds.width,
              height: menu.bounds.height,
              pointerEvents: 'none',
            }}
          />
        </Dropdown>
      )}
    </div>
  )
}
