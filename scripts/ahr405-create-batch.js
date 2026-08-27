#!/usr/bin/env node
// One-shot batch creator for AHR-405 T3/T4 items.
// Uses the same fields plane-item-create.js sets, but skips the
// cycle-add step's hard error (it succeeds for cycle 2026/16).

const PLANE_API_KEY = "plane_api_2173f1bbcaeb406cb725369589adf627";
const BASE = "https://plane.jimbui.dev";
const SLUG = "aiur";
const PROJECT_ID = "53594a97-bd1d-4d52-bcb9-ebacadc41464";
const STATE_DONE = "b78525a5-e6f0-439a-b0ab-5191a046b55c";
const ASSIGNEE = "34232675-13d1-4b23-b90c-d5abe8bfd83b";
const CYCLE_2026_16 = "0e5adea2-0792-4257-aa58-ab225d92665e";
const MODULE_EMP_MGMT = "3fd67ea1-f53b-40dc-9382-ee2bc8234f58";
const VERSION_DOC_URL = "https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802";
const T2_AHR405_UUID = "1abdf7d3-a65b-4e25-9eb7-bb2974444ba7";
const PROJECT_IDENTIFIER = "AHR";

const headers = {
    "X-API-Key": PLANE_API_KEY,
    "Content-Type": "application/json",
};

const projBase = `${BASE}/api/v1/workspaces/${SLUG}/projects/${PROJECT_ID}`;
const wsBase = `${BASE}/api/v1/workspaces/${SLUG}/projects/${PROJECT_ID}`;

const wrapDesc = (text) => `<p>Version: <a href="${VERSION_DOC_URL}">Outline</a></p><p>${text}</p>`;

async function createIssue({ name, parentUuid, descText }) {
    const body = {
        name,
        state: STATE_DONE,
        priority: "medium",
        parent: parentUuid,
        assignees: [ASSIGNEE],
        start_date: "2026-04-07",
        description_html: wrapDesc(descText),
    };
    const r = await fetch(`${projBase}/issues/`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    if (!r.ok) {
        const t = await r.text();
        throw new Error(`Create failed: ${r.status} ${t}`);
    }
    const issue = await r.json();
    const ident = `${PROJECT_IDENTIFIER}-${issue.sequence_id}`;
    // Add to cycle (best-effort)
    await fetch(`${projBase}/cycles/${CYCLE_2026_16}/cycle-issues/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ issues: [issue.id] }),
    }).catch(() => {});
    // Add to module (best-effort)
    await fetch(`${projBase}/modules/${MODULE_EMP_MGMT}/module-issues/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ issues: [issue.id] }),
    }).catch(() => {});
    return { ident, uuid: issue.id };
}

const PHASE_PREFIX = "[v0.0.1 | Employee Management] Employees page — saved views > Saved views UI";

async function processPhase(phaseLetter, phaseName, phaseDesc, t3IdentOverride, tasks) {
    let t3;
    if (t3IdentOverride) {
        // already exists, look up its UUID via REST
        const r = await fetch(`${BASE}/api/v1/workspaces/${SLUG}/issues/${t3IdentOverride}/`, {
            headers,
        });
        const j = await r.json();
        t3 = { ident: t3IdentOverride, uuid: j.id };
        console.log(`Phase ${phaseLetter} T3 (existing): ${t3.ident}`);
    } else {
        t3 = await createIssue({
            name: `${PHASE_PREFIX} > Phase ${phaseLetter} - ${phaseName}`,
            parentUuid: T2_AHR405_UUID,
            descText: phaseDesc,
        });
        console.log(`Phase ${phaseLetter} T3 created: ${t3.ident}`);
    }
    const t4s = [];
    for (let i = 0; i < tasks.length; i++) {
        const [taskName, taskDesc] = tasks[i];
        const t4 = await createIssue({
            name: `${PHASE_PREFIX} > Phase ${phaseLetter} > ${taskName}`,
            parentUuid: t3.uuid,
            descText: taskDesc,
        });
        t4s.push({ name: taskName, ident: t4.ident });
        console.log(`  T4 ${i + 1}/${tasks.length}: ${t4.ident} - ${taskName}`);
    }
    return { t3, t4s };
}

const PHASES = [
    {
        letter: "A",
        name: "Data layer & types",
        desc: "Defines the persisted EmployeeView_Config type, wires the JSONB override at the SDK boundary, adds the employeeViews query-key factory, and ships the query + 3 mutation hooks (Create/Update/Delete).",
        existingT3: "AHR-746",
        tasks: [
            [
                "Add fieldOrder + EmployeeView_Config type",
                "Adds fieldOrder field to EmployeeTable_ToolState and exports EmployeeView_Config (sort/filter/groupBy/hiddenKeys/fieldOrder — search excluded as ephemeral) in src/types/employeeTable.types.ts.",
            ],
            [
                "Wire employee_views.config JSONB override + switch SDK client",
                "Adds Tables.employee_views.{Row,Insert,Update}.config: EmployeeView_Config in database.override.types.ts via MergeDeep, and switches src/configs/supabase/config.ts to createClient<DatabaseWithCustomTypes> so the override applies at the SDK boundary.",
            ],
            [
                "Add employeeViews factory to queryKeys",
                "Appends employeeViews: { all, list, record } to src/utils/query/queryKeys.ts matching existing conventions.",
            ],
            [
                "Create useQ_Tables_OrgEmployeeViews query hook",
                "New src/hooks/useQ_Tables_OrgEmployeeViews.ts — select * .eq organization_id, returns { query, employeeViews }. Exports Tables_OrgEmployeeViews_QueryData type.",
            ],
            [
                "Create useM_EmployeeView_Create mutation hook",
                "New src/hooks/useM_EmployeeView_Create.ts — body { organization_id, name, config }, success toast + invalidates QueryKeys.employeeViews.all().",
            ],
            [
                "Create useM_EmployeeView_Update mutation hook",
                "New src/hooks/useM_EmployeeView_Update.ts — body { viewId, name?, config? } (mutate-time viewId for dynamic UI), differentiates rename vs save toast.",
            ],
            [
                "Create useM_EmployeeView_Delete mutation hook",
                "New src/hooks/useM_EmployeeView_Delete.ts — body { viewId }, success toast + invalidates.",
            ],
        ],
    },
    {
        letter: "B",
        name: "DB cleanup trigger + client util + created_by default",
        desc: "Two migrations: (1) created_by DEFAULT auth.uid() so the Create mutation can omit it; (2) AFTER DELETE trigger on employee_columns that strips references to the deleted column from every employee_views.config in the org (recursive filter walker). Plus a matching client util for race-protection on view load.",
        tasks: [
            [
                "Migration: created_by DEFAULT auth.uid()",
                "20260415083723_ahr405_employee_views_created_by_default.sql — ALTER TABLE employee_views ALTER COLUMN created_by SET DEFAULT auth.uid().",
            ],
            [
                "Migration: column-cleanup trigger + recursive filter walker",
                "20260415083722_ahr405_employee_views_column_cleanup_trigger.sql — clean_employee_view_filter_node() recursive PL/pgSQL helper + clean_employee_views_on_column_delete() SECURITY DEFINER trigger function + AFTER DELETE trigger on employee_columns. Strips refs from fieldOrder/hiddenKeys/sort[].field/groupBy[].field and prunes empty filter groups.",
            ],
            [
                "Apply migrations + regen types + verify",
                "pnpm sb:dev:push, pnpm sb:dev:types. Verified default + trigger via information_schema queries. Lint shows pre-existing public.authorize warning (unrelated).",
            ],
            [
                "Create Utils_EmployeeView_CleanConfig client util",
                "src/utils/Utils_EmployeeView_CleanConfig.ts — function overload preserves EmployeeTable_FilterGroup at top level. Returns same reference when nothing changed (React memoization-friendly).",
            ],
            [
                "Manual smoke verification covered by user recordings",
                "Recordings attached to version doc demonstrate trigger + util keeping config in sync.",
            ],
        ],
    },
    {
        letter: "C",
        name: "Provider + route search schema",
        desc: "New Provider_Page_Employees_List owns tool state + savedConfig + savedName + dirty diff. Route gains validateSearch for ?viewId=. Page_Employees list branch extracted into PageEmployees_ListView (~700 LOC) and wrapped in the provider; chart branch untouched.",
        tasks: [
            [
                "Add validateSearch for viewId to employees route",
                "src/routes/_protected/$organizationId/employees/index.tsx — validateSearch coerces viewId to string|undefined, rejects garbage.",
            ],
            [
                "Create Provider_Page_Employees_List with helpers",
                "src/providers/employees/Provider_Page_Employees_List.tsx — pure state class + useReducer + helpers (emptyToolState/emptyConfig, projectConfigFromToolState, equalConfig). Hook returns { state, setState, setToolState, isDirty }.",
            ],
            [
                "Sync effect hydrating provider from selected viewId",
                "Effect in PageEmployees_ListView keyed on [viewId, qViews data, qColumns data] with lastHydratedViewIdRef guard — re-hydrates only on viewId change so dirty state survives background refetches.",
            ],
            [
                "Expose isDirty derived from hook wrapper",
                "useProvider_Page_Employees_List computes isDirty by deep-equal of savedConfig vs projected current config; excludes search.",
            ],
            [
                "Extract list branch into PageEmployees_ListView",
                "New src/pages/Page_Employees/PageEmployees_ListView/PageEmployees_ListView.tsx with all list state/handlers/helpers (OPERATORS_BY_TYPE, ConditionRow, FilterGroupBlock). Page_Employees.tsx slimmed from 1392 → 420 lines, only chart branch + page shell + modals remain.",
            ],
            [
                "Migrate useState to provider toolState with updater shims",
                "setSortState/setFilterState/setGroupBy/setHiddenKeys/setFieldOrder/setSearchQuery accept value or functional updater so existing handler code ports 1:1. Drag refs + drop-hover state stay local (transient gestures).",
            ],
        ],
    },
    {
        letter: "D",
        name: "Views sidebar subcomponent",
        desc: 'New PageEmployees_ViewsSidebar with header, search filter, "+ New View" button, virtual Default row pinned at top, saved views list with active highlight, three-dot Dropdown menu (Rename / Duplicate / Delete). Replaces the TODO placeholder.',
        tasks: [
            [
                "Create PageEmployees_ViewsSidebar component",
                "New src/pages/Page_Employees/PageEmployees_ViewsSidebar/PageEmployees_ViewsSidebar.tsx. Props: organizationId + 4 action callbacks. Reads useQ_Tables_OrgEmployeeViews + useSearch + useNavigate.",
            ],
            [
                "Layout: header + search + New View button",
                'Header strong "Views" label + Input search with SearchOutlined prefix + Button type=dashed block "+ New View".',
            ],
            [
                "Rows: Default pinned + saved views list",
                'Virtual "Default" row at top (no menu, TableOutlined icon). Filtered saved views below. Active highlight via colorPrimaryBg. Click → navigate({ to: ., search: { viewId } }).',
            ],
            [
                "Three-dot menu (Rename / Duplicate / Delete)",
                "ANTD Dropdown with MoreOutlined trigger. Menu items wired to parent callbacks. Visible only on saved-view rows.",
            ],
            [
                "Replace placeholder with sidebar in ListView",
                "Stub callbacks added in PageEmployees_ListView — ready for Phase E/F to wire mutations.",
            ],
        ],
    },
    {
        letter: "E",
        name: "Shared name modal + Create/Rename wiring",
        desc: 'Reusable PageEmployees_ViewNameModal serves Create / Save-As / Rename. Update/Delete hooks refactored to mutate-time viewId so a single hook instance handles many rows. Wires "+ New View" → Create and three-dot Rename → Rename.',
        tasks: [
            [
                "Create PageEmployees_ViewNameModal component",
                "New src/pages/Page_Employees/PageEmployees_ViewNameModal/PageEmployees_ViewNameModal.tsx. Modal + Form + Input with autofocus, trim validation, async submitting gate, destroyOnHidden.",
            ],
            [
                "Wire + New View → Create flow with config snapshot",
                "mCreateView.mutateAsync({ organization_id, name, config: projectConfigFromToolState(toolState) }) → navigate to new viewId. Sync effect auto-hydrates the new view since lastHydratedViewIdRef pointed at null.",
            ],
            [
                "Wire Rename menu → Rename flow",
                "Rename modal triggers mUpdateView.mutateAsync({ viewId, name }). Sync effect skips re-hydration so dirty tool state survives.",
            ],
            [
                "Refactor Update/Delete hooks to mutate-time viewId",
                "Bible deviation: skill suggests hook-time { id }, but three-dot menu UX needs dynamic ids — so body shape becomes { viewId, ...patch } for Update and { viewId } for Delete. Single hook instance per component.",
            ],
        ],
    },
    {
        letter: "F",
        name: "Save / Save-as / Cancel + Duplicate + Delete",
        desc: 'Three provider-driven toolbar buttons (Save / Save as view / Cancel Changes) with dirty-state gating. Duplicate menu = silent "Copy of {name}" mutation. Delete menu = modal.confirm + navigate to Default if current. Stale-state fix updates savedConfig/savedName directly post-mutation.',
        tasks: [
            [
                "Wire Save / Save-as view / Cancel Changes toolbar",
                'Save (primary) enabled iff viewId && isDirty → mUpdateView({ viewId, config }). Save as view always enabled, opens name modal pre-filled "Copy of {savedName}" or empty. Cancel Changes visible only when dirty → resets toolState to savedConfig (preserves search).',
            ],
            [
                "Wire Duplicate menu — silent Copy of {name}",
                "mCreateView.mutateAsync({ name: `Copy of ${view.name}`, config: view.config }) + navigate. No prompt. Matches App_OnboardingFormsList.tsx:31 convention.",
            ],
            [
                "Wire Delete menu — confirm + delete + navigate",
                "modal.confirm({ okType: danger }) + mDeleteView.mutateAsync({ viewId }) + navigate to Default if the deleted view was current.",
            ],
            [
                "Stale-state fix: update savedConfig/savedName in-place after Save and Rename",
                "Without this, sync-effect refetch lands but lastHydratedViewIdRef guard skips re-hydration → savedConfig stays stale → isDirty stuck at true. Fix writes new values directly into provider state when current view is mutated.",
            ],
        ],
    },
    {
        letter: "G",
        name: "Drag-to-reorder + layout refactor + optimistic update + view-name display",
        desc: "Scope extension for drag-to-reorder + collapsible-sidebar layout. Two more migrations (sort_order column + reorder RPC). Optimistic update keeps UX instant. Toolbar restructured to span full width with hamburger toggle, current view name on the left, and absolute-centered tool cluster.",
        tasks: [
            [
                "Migration: add sort_order column + backfill + index",
                "20260415100726_ahr405_employee_views_sort_order.sql — sort_order INTEGER NOT NULL DEFAULT 0, backfill per-org with ROW_NUMBER * 100, index on (organization_id, sort_order).",
            ],
            [
                "Migration: reorder_employee_views RPC (SECURITY DEFINER)",
                "20260415100727_ahr405_employee_views_reorder_rpc.sql — validates ids exist + same org + caller is admin/owner, then renumbers each to (idx+1)*100. GRANT EXECUTE TO authenticated.",
            ],
            [
                "Create useM_EmployeeView_Reorder hook with optimistic update",
                "src/hooks/useM_EmployeeView_Reorder.ts — onMutate cancels in-flight queries, snapshots, writes optimistic order to cache; onError rolls back; onSettled invalidates. Body { organizationId, orderedIds }.",
            ],
            [
                "Update Create body + change query order",
                "useM_EmployeeView_Create body adds optional sort_order. useQ_Tables_OrgEmployeeViews orders by sort_order ASC then created_at ASC (tiebreak for midpoint collisions).",
            ],
            [
                "Sidebar: drag handle + HTML5 DnD + drop indicator",
                "PageEmployees_ViewsSidebar adds HolderOutlined per saved-view row, full HTML5 drag/drop with blue 2px drop-indicator bar. Default row pinned (not draggable, not a drop target). Drag disabled while filter active (cursor: not-allowed).",
            ],
            [
                "ListView wires reorder + insert-position helpers",
                "computeTopSortOrder (min - 100) for Create/Save-As; computeAfterSortOrder (midpoint or source+100) for Duplicate. handleReorderViews calls mReorderViews.mutate({ organizationId, orderedIds }).",
            ],
            [
                "Layout refactor: toolbar spans width, sidebar collapsible",
                'List branch root flips to flex-column. Toolbar moves to top with hamburger (MenuOutlined) on left toggling sidebarCollapsed state. Sidebar + table become siblings under a new flex-row below the toolbar. Sidebar "Views" header div removed (hamburger carries the affordance).',
            ],
            [
                "Add current view name + absolute-center middle cluster",
                'Typography.Text strong (savedName ?? "Default") next to hamburger, ellipsis with tooltip, maxWidth 240. Toolbar gets position:relative; middle tool cluster gets position:absolute + left 50% + translateX -50% so it centers on the viewport regardless of left/right cluster widths. Right cluster pinned via marginLeft: auto.',
            ],
        ],
    },
];

const PHASE_LETTER_ARG = process.argv[2];

(async () => {
    const results = {};
    for (const phase of PHASES) {
        if (PHASE_LETTER_ARG && phase.letter !== PHASE_LETTER_ARG) continue;
        const r = await processPhase(
            phase.letter,
            phase.name,
            phase.desc,
            phase.existingT3,
            phase.tasks
        );
        results[phase.letter] = r;
    }
    console.log("\n--- RESULTS JSON ---");
    console.log(JSON.stringify(results, null, 2));
})();
