# [v0.0.1 | Employee Management] Employees page — table + chart > Employee data table (list view)

Work Item: [AHR-640](https://plane.jimbui.dev/aiur/browse/AHR-640/)
Tier 1: [AHR-395] [v0.0.1 | Employee Management] Employees page — table + chart (In Progress)
Module: [Employee Management](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: The Employees page currently has a "coming soon" placeholder for list mode. This T2 replaces it with an **Airtable-like data grid** — a dense, spreadsheet-feel table showing every employee with their universal fields (first name, last name, email, birthday) plus one column per admin-defined dynamic `employee_column`. The grid sits inside a list-view shell: a left Views sidebar (placeholder for now) and an inner toolbar with tool icons (Sort / Filter / Group / Hide fields / Search) in the middle and Save / Save-as buttons on the right. The tools are fully interactive (ephemeral state — resets on refresh); view persistence ships later in AHR-405.

Tech: Replace the placeholder at `Page_Employees.tsx` line ~380 (where `viewMode === 'list'`) with a new layout shell. `App_EmployeeDataTable` is a reusable, stateless data grid component (`components/employees/`) that accepts tool state as props (`filter?`, `sortState?`, `filterState?`, `groupByKey?`, `hiddenKeys?`, `searchQuery?`). State is lifted to `Page_Employees` via `useState`. The grid renders universal + dynamic columns with monochrome field-type icons in headers and per-type cell renderers (text/number plain, date localized via dayjs, boolean as disabled Checkbox, multi_select as uniformly-colored Tags mapped from `employee_column_choices`, null as "Null" secondary text). `pagination={false}` + sticky-header scroll gives the Google-Sheets feel. Dynamic columns ordered by `employee_columns.created_at ASC`. Tool-state types live in `src/types/employeeTable.types.ts` so AHR-405 can reuse them for `employee_views.config`.

Related: [Organization](https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — schema source for `employees`, `employee_columns`, `employee_column_choices`, and the dynamic `col_XXXX` pattern. AHR-405 will depend on `src/types/employeeTable.types.ts` shapes defined here to persist views via `employee_views.config`.
Siblings: 3 active, 2 Done — [AHR-639 Org chart departments (Done), AHR-640 Employee data table (Todo) ←, AHR-641 Org chart card rework (Done)]. 3 cancelled (AHR-401/402/403).
Execution Order: Step 2 of 2 — prerequisite AHR-639 (data fix) is Done. Parallel with AHR-641 (also Done). Clear to proceed.

## Phase A: Data layer + tool-state types

- [x] Add `employees` key to `frontend/vite/src/utils/query/queryKeys.ts` following existing factory pattern (`all` / `list` / `record`)
- [x] Create `frontend/vite/src/hooks/useQ_Tables_OrgEmployees.ts` — `select("*")` from `employees` where `organization_id = ?`, ordered by `first_name ASC`. Returns `{ query, employees }`. Export `Tables_OrgEmployees_QueryData = Awaited<ReturnType<typeof fetchOrgEmployees>>`. Follow `sb_FromEmployees_Select` SDK naming convention
- [x] Create `frontend/vite/src/types/employeeTable.types.ts` with shared tool-state shapes (exported for reuse by AHR-405):
    - `EmployeeTable_FieldType` — `'text' | 'number' | 'date' | 'boolean' | 'multi_select'` (mirrors `employee_column_type` enum + universal birthday/text)
    - `EmployeeTable_FieldKey` — union of universal keys (`'first_name' | 'last_name' | 'email' | 'birthday'`) or dynamic `col_XXXX` string
    - `EmployeeTable_SortEntry` — `{ field: string; direction: 'asc' | 'desc' }`
    - `EmployeeTable_FilterOperator` — type-dependent union: text (`equals`, `not_equals`, `contains`, `not_contains`, `is_empty`, `is_not_empty`), number (`equals`, `not_equals`, `gt`, `gte`, `lt`, `lte`, `is_empty`, `is_not_empty`), date (`equals`, `before`, `after`, `is_empty`, `is_not_empty`), boolean (`is_true`, `is_false`, `is_empty`), multi_select (`contains_any`, `contains_all`, `is_empty`, `is_not_empty`)
    - `EmployeeTable_FilterCondition` — `{ kind: 'condition'; field: string; operator: EmployeeTable_FilterOperator; value: unknown }`
    - `EmployeeTable_FilterGroup` — `{ kind: 'group'; combinator: 'and' | 'or'; children: EmployeeTable_FilterNode[] }`
    - `EmployeeTable_FilterNode` — `EmployeeTable_FilterCondition | EmployeeTable_FilterGroup`
    - `EmployeeTable_ToolState` — `{ sort: EmployeeTable_SortEntry[]; filter: EmployeeTable_FilterGroup | null; groupBy: string | null; hiddenKeys: string[]; search: string }`

## Phase B: Core table component + tool engine

- [x] Create `frontend/vite/src/components/employees/App_EmployeeDataTable.tsx` — reusable stateless data grid
    - Props: `{ organizationId: string; filter?: (emp: Tables_OrgEmployees_QueryData[number]) => boolean; sortState?: EmployeeTable_SortEntry[]; filterState?: EmployeeTable_FilterGroup | null; groupByKey?: string | null; hiddenKeys?: string[]; searchQuery?: string }`
    - Internal queries: `useQ_Tables_OrgEmployees({ organizationId })`, `useQ_Tables_EmployeeColumns({ organizationId })`, `useQ_Tables_EmployeeColumnChoices({ organizationId })`
    - Universal columns array (fixed shape): `[{ key: 'first_name', label: 'First Name', type: 'text' }, { key: 'last_name', label: 'Last Name', type: 'text' }, { key: 'email', label: 'Email', type: 'text' }, { key: 'birthday', label: 'Birthday', type: 'date' }]` — mirrors existing `UNIVERSAL_FIELDS` in `App_ContractFiller.tsx` (don't DRY yet — consistent duplication is cheaper than a premature abstraction)
    - Dynamic columns derived from `qColumns.columns` (already ordered by `created_at ASC` from the hook)
    - Column header renderer: field label + monochrome field-type icon at left
        - text → `AlignLeftOutlined`
        - number → `NumberOutlined`
        - date → `CalendarOutlined`
        - boolean → `CheckSquareOutlined`
        - multi_select → `TagsOutlined`
    - Per-type cell renderer (inline in column config):
        - text / number (when value present) → raw text
        - date → `dayjs(value).format('MMM D, YYYY')` (null → fall through to Null renderer)
        - boolean → `<Checkbox checked={!!value} disabled />`
        - multi_select → map array values → choices for this column → render `<Tag color={token.colorPrimary}>` per choice label
        - null / undefined → `<Typography.Text type="secondary">Null</Typography.Text>`
    - Build choices lookup map: `Record<employee_column_id, Record<choice_value, choice_label>>` for O(1) multi_select render
    - Uniform column width: `180` for all columns, no resize
    - Tool engine — derived rows via cascade of `useMemo`s:
        1. Apply `filter?` (business-logic predicate, e.g., department scoping)
        2. Apply `searchQuery` — substring match (case-insensitive) across all cell string representations (universal fields + dynamic columns, using per-type `toDisplayString` helper)
        3. Apply `filterState` — compound predicate evaluator walking the AND/OR tree, operator-aware per field type (extract as `utils_EmployeeDataTable_evaluateFilter` inline const)
        4. Apply `sortState` — multi-field lexicographic compare: iterate `sortState` entries; for each, compare two rows by field with type-aware comparator (numbers numeric, dates by timestamp, text locale-aware, boolean false<true, multi_select by joined string); direction flips sign; first non-zero wins
        5. Apply `groupByKey` — if set, partition rows by the field value (or `__null__` sentinel) and render with group-header rows; preserve sort order within each group
        6. Apply `hiddenKeys` — strip matching columns from the ANTD Table `columns` array
    - Row grouping rendering: when `groupByKey` set, compute ordered array of groups `{ key, label, rows: Row[] }`; render as flat rows preceded by a group-header row per group (use ANTD Table's row-based rendering with a synthetic `__group_header__` row flag, OR use `expandable` + `defaultExpandAllRows` — pick whichever renders cleaner — document choice in commit)
    - ANTD Table config: `rowKey="id"`, `pagination={false}`, `size="small"`, `bordered`, `scroll={{ x: 'max-content', y: '100%' }}`, `locale={{ emptyText: <ActionableEmpty /> }}` where `ActionableEmpty` is a small inline component rendering "No employees yet" + a secondary line "Send onboarding invitations to add employees" (plain text only, no button — the Onboarding button already exists in the page header)
    - Loading state: wait on `qEmployees.query.isLoading || qColumns.query.isLoading || qChoices.query.isLoading` → pass `loading` prop to Table
    - `data-node-id` NOT applicable here (that's chart-specific)
- [x] Export `Tables_OrgEmployees_QueryData` row type alias alongside the component file (or re-export from hook) so `filter?` prop consumers can type their predicate — already exported from `useQ_Tables_OrgEmployees.ts`, no duplicate needed

## Phase C: List view layout shell in Page_Employees

- [x] In `frontend/vite/src/pages/Page_Employees/Page_Employees.tsx`:
    - Add `useState` declarations at the top of the component for lifted tool state:
        - `sortState: EmployeeTable_SortEntry[]` (default `[]`)
        - `filterState: EmployeeTable_FilterGroup | null` (default `null`)
        - `groupByKey: string | null` (default `null`)
        - `hiddenKeys: string[]` (default `[]`)
        - `searchQuery: string` (default `''`)
    - Replace the placeholder block at ~line 380 (currently `<Typography.Text type="secondary">Employee list view coming soon.</Typography.Text>`) with a list-view layout:
        - Outer `<div>` with `display: flex`, `flex: 1`, `height: '100%'`
        - Left sidebar (`width: 220`, `borderRight: 1px solid token.colorBorderSecondary`, vertical flex): header `<Typography.Text strong>Views</Typography.Text>` at top, then a placeholder area with `<Typography.Text type="secondary">TODO: saved views (AHR-405)</Typography.Text>`
        - Right content area (`flex: 1`, vertical flex):
            - Inner horizontal toolbar (`height: 48`, `borderBottom: 1px solid token.colorBorderSecondary`, `display: flex`, `alignItems: center`, `padding: 0 token.paddingMD`):
                - Middle cluster (flex-grow, centered horizontally): 5 tool buttons rendered as icon-only `<Button type="text" icon={...}>` wrapped in `<Tooltip>` for name. All open their respective Popovers (empty in this phase — filled in D–G). Icons from `@ant-design/icons`:
                    - Sort: `SortAscendingOutlined` — tooltip "Sort"
                    - Filter: `FilterOutlined` — tooltip "Filter"
                    - Group: `GroupOutlined` — tooltip "Group" (fallback if GroupOutlined unavailable: `BranchesOutlined` or `AppstoreOutlined` — verify in the build)
                    - Hide fields: `EyeInvisibleOutlined` — tooltip "Hide fields"
                    - Search: `SearchOutlined` — tooltip "Search"
                - Right cluster: two buttons — `<Button disabled>Save</Button>` and `<Button disabled>Save as view</Button>` — grouped with `token.marginXS` gap
            - Table area (`flex: 1`, `overflow: hidden`): `<App_EmployeeDataTable organizationId={organizationId} sortState={sortState} filterState={filterState} groupByKey={groupByKey} hiddenKeys={hiddenKeys} searchQuery={searchQuery} />`
    - Import `App_EmployeeDataTable` and tool-state types
- [x] Verify browser: chart view unchanged; list view shows sidebar (with TODO text) + toolbar (5 icons + 2 disabled buttons) + populated table with all org employees and dynamic columns; empty-state copy appears for an org with no employees — type-check passes; browser verification deferred to user
- [x] Note: `useState` declarations for tool state deferred to Phase D–G (each phase adds its own state + Popover) to avoid TS unused-setter errors. Tool buttons in Phase C are plain `<Tooltip><Button></Tooltip>` — Phase D–G will wrap with `<Popover>` and hook up state.

## Phase D: Hide fields + Search tools

- [x] Wire Hide fields Popover (inline in `Page_Employees.tsx` toolbar):
    - Popover content: column list — universal columns (4) + dynamic columns (from `useQ_Tables_EmployeeColumns`) — each with a checkbox; checked = visible, unchecked = hidden
    - Maintain `hiddenKeys` as a `string[]` (field key names); checkbox `onChange` toggles the key in/out of the array
    - Optional: "Show all" / "Hide all" buttons at the bottom for UX
    - Close Popover on outside click (default ANTD behavior)
- [x] Wire Search Popover (inline in `Page_Employees.tsx` toolbar):
    - Popover content: `<Input.Search placeholder="Search all fields..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} allowClear />` with `autoFocus` on open
    - Consider: show current search term as a badge on the Search icon button when active (count of matched rows too ambitious — skip)
- [x] Verify: hiding a column removes it from the Table; unchecking restores it. Search filters rows live as you type. — type-check passes; browser verification deferred to user

## Phase E: Sort tool (multi-column)

- [x] Wire Sort Popover (inline in `Page_Employees.tsx` toolbar):
    - Popover content: vertical list of current `sortState` entries; each entry is a row of controls:
        - `<Select>` for field (options: all universal + dynamic column labels, filtered to exclude fields already in other sort entries — can't sort by the same field twice)
        - `<Segmented>` or two-button toggle for direction (`asc` / `desc` with arrow icons)
        - `<Button type="text" icon={<DeleteOutlined />}>` to remove the entry
    - "+ Add sort" button at bottom (disabled when all fields are already in the sort list)
    - Empty-state text inside the Popover when `sortState.length === 0`: "No sort rules. Rows are shown in the order they were added."
- [x] Verify: adding a sort entry reorders rows. Adding a second entry refines ordering (second-level tiebreaker). Removing an entry reverts its effect. Asc/desc toggle works per column. — type-check passes; browser verification deferred to user

## Phase F: Filter tool (compound)

- [x] Wire Filter Popover (inline in `Page_Employees.tsx` toolbar):
    - Popover content: root is always a `FilterGroup` (default: `{ kind: 'group', combinator: 'and', children: [] }`). Render recursively:
        - Group node: combinator toggle at top (`AND` / `OR` via Segmented); vertical list of children; buttons at bottom "+ Add condition" and "+ Add group"; if group has a parent, show a "remove group" button in the top-right corner
        - Condition node: horizontal row of `<Select field>` + `<Select operator>` (options filtered by selected field's type) + value input (type-dependent: `Input` for text, `InputNumber` for number, `DatePicker` for date, nothing for boolean/is_empty/is_not_empty, `Select multiple` for multi_select) + `<Button icon={<DeleteOutlined />}>`
    - Operator options derived from the field's type via a `const_EmployeeTable_Operators` map (`Record<EmployeeTable_FieldType, EmployeeTable_FilterOperator[]>` with `label` per operator)
    - Empty-state text when root group has no children: "No filters. All employees shown."
    - Evaluator (in `App_EmployeeDataTable`): walks the tree; condition evaluation is type-aware (string.includes for contains, === for equals, array.some/every for multi_select, timestamp compare for date)
- [x] Verify: adding a single condition filters rows. Nested groups with OR at root and ANDs inside produce expected unions. Removing a condition / group restores rows. — type-check passes; browser verification deferred to user. Added `dayjs` as direct dep to `frontend/vite` (required for ANTD DatePicker in condition value input; was transitively installed but not resolved for this package).

## Phase G: Group tool

- [x] Wire Group Popover (inline in `Page_Employees.tsx` toolbar):
    - Popover content: `<Select>` (with `showSearch` + `allowClear`) for group-by field + `<Select>` for direction (text `asc`/`desc`, matching sort-tool convention). `<Segmented>` swapped for `<Select>` per earlier feedback.
    - "Clear grouping" button shown when `groupByKey` is set
- [x] Added `groupDirection?: 'asc' | 'desc'` prop to `App_EmployeeDataTable`. When `groupByKey` is set, the effective sort is `[{field: groupByKey, direction: groupDirection}, ...userSort.filter(e => e.field !== groupByKey)]` — ensures groups appear in consistent order and user sort applies within each group.
- [x] Verify: selecting a group-by field renders rows grouped with group-header rows showing the group value + row count. Selecting "None" / clearing removes grouping. Group order respects asc/desc toggle. — type-check passes; browser verification deferred to user

---

## Plane IDs (populated by /pp)

Phase A: AHR-722

- Task 1: AHR-723
- Task 2: AHR-724
- Task 3: AHR-725

Phase B: AHR-726

- Task 1: AHR-727
- Task 2: AHR-728

Phase C: AHR-729

- Task 1: AHR-730
- Task 2: AHR-731

Phase D: AHR-732

- Task 1: AHR-733
- Task 2: AHR-734
- Task 3: AHR-735

Phase E: AHR-736

- Task 1: AHR-737
- Task 2: AHR-738

Phase F: AHR-739

- Task 1: AHR-740
- Task 2: AHR-741

Phase G: AHR-742

- Task 1: AHR-743
- Task 2: AHR-744
- Task 3: AHR-745
