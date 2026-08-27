#!/usr/bin/env node
const PLANE_API_KEY = "plane_api_2173f1bbcaeb406cb725369589adf627";
const BASE = "https://plane.jimbui.dev";
const SLUG = "aiur";
const PROJECT_ID = "53594a97-bd1d-4d52-bcb9-ebacadc41464";
const STATE_DONE = "b78525a5-e6f0-439a-b0ab-5191a046b55c";
const ASSIGNEE = "34232675-13d1-4b23-b90c-d5abe8bfd83b";
const CYCLE = "0e5adea2-0792-4257-aa58-ab225d92665e";
const MODULE_UUID = "3fd67ea1-f53b-40dc-9382-ee2bc8234f58";
const VERSION_DOC_URL = "https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802";
const T2_UUID = "0919f1ac-ef7e-415e-9090-a4ac33fc4390";
const PROJECT_IDENTIFIER = "AHR";
const START = "2026-04-16";
const DUE = "2026-04-25";

const headers = { "X-API-Key": PLANE_API_KEY, "Content-Type": "application/json" };
const projBase = `${BASE}/api/v1/workspaces/${SLUG}/projects/${PROJECT_ID}`;
const wrapDesc = (text) => `<p>Version: <a href="${VERSION_DOC_URL}">Outline</a></p><p>${text}</p>`;

async function createIssue({ name, parentUuid, descText }) {
    const body = {
        name,
        state: STATE_DONE,
        priority: "medium",
        parent: parentUuid,
        assignees: [ASSIGNEE],
        start_date: START,
        target_date: DUE,
        description_html: wrapDesc(descText),
    };
    const r = await fetch(`${projBase}/issues/`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Create failed: ${r.status} ${await r.text()}`);
    const issue = await r.json();
    const ident = `${PROJECT_IDENTIFIER}-${issue.sequence_id}`;
    await fetch(`${projBase}/cycles/${CYCLE}/cycle-issues/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ issues: [issue.id] }),
    }).catch(() => {});
    await fetch(`${projBase}/modules/${MODULE_UUID}/module-issues/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ issues: [issue.id] }),
    }).catch(() => {});
    return { ident, uuid: issue.id };
}

const PREFIX =
    "[v0.0.1 | Employee Management] Table view UX overhaul — auto-save, field composer, drag-order columns > Auto-save view config + toolbar overhaul";

async function processPhase(letter, name, desc, tasks) {
    const t3 = await createIssue({
        name: `${PREFIX} > Phase ${letter} - ${name}`,
        parentUuid: T2_UUID,
        descText: desc,
    });
    console.log(`Phase ${letter} T3: ${t3.ident}`);
    const t4s = [];
    for (let i = 0; i < tasks.length; i++) {
        const [tn, td] = tasks[i];
        const t4 = await createIssue({
            name: `${PREFIX} > Phase ${letter} > ${tn}`,
            parentUuid: t3.uuid,
            descText: td,
        });
        t4s.push({ name: tn, ident: t4.ident });
        console.log(`  T4 ${i + 1}/${tasks.length}: ${t4.ident} — ${tn}`);
    }
    return { t3, t4s };
}

const PHASES = [
    {
        letter: "A",
        name: "Schema split — promote config sub-keys to columns",
        desc: "Drop employee_views.config JSONB and add six typed columns (filter, sort, group_by, hidden_keys, field_order, field_widths) so toolbar interactions can issue surgical per-column updates instead of whole-config reads + writes.",
        tasks: [
            [
                "Migration creation",
                "20260417100000_ahr941_employee_views_split_config.sql — ADD COLUMN for filter/sort/group_by/hidden_keys/field_order (JSONB NOT NULL DEFAULT []) and field_widths (JSONB NOT NULL DEFAULT {}), then DROP COLUMN config (pre-launch wipe of any nested filters).",
            ],
            [
                "Apply locally",
                "pnpm sb:dev:push — applied via Supabase CLI per bible-supabase-cli.",
            ],
            [
                "Regenerate types",
                "pnpm sb:dev:types — employee_views row type now exposes the 6 new columns.",
            ],
        ],
    },
    {
        letter: "B",
        name: "Type updates",
        desc: "Flatten filter shape from nested group/condition discriminated union to a flat FilterCondition[] with implicit AND. Propagate new config shape to query/projection types.",
        tasks: [
            [
                "Filter type flatten",
                'src/types/employeeTable.types.ts — drop EmployeeTable_FilterGroup + EmployeeTable_FilterNode + the "kind" discriminator on EmployeeTable_FilterCondition. EmployeeView_Config becomes { filter: FilterCondition[], sort, group_by, hidden_keys, field_order, field_widths } with snake_case keys mirroring DB columns.',
            ],
            [
                "Query projection update",
                "useQ_Tables_OrgEmployeeViews SELECT list extended to include the 6 new columns; Tables_OrgEmployeeViews_QueryData row shape aligns with new schema.",
            ],
        ],
    },
    {
        letter: "C",
        name: "Mutation hook for partial patches",
        desc: "Refactor useM_EmployeeView_Update so every toolbar interaction sends only the keys it mutates, and success toast is suppressed for silent config-only autosaves.",
        tasks: [
            [
                "Mutation hook upgrade",
                'useM_EmployeeView_Update body now { viewId, name?, filter?, sort?, group_by?, hidden_keys?, field_order?, field_widths? }. Mutation fn passes patch (minus viewId) directly to .update(patch).eq("id", viewId); Supabase drops undefined keys. Invalidates QueryKeys.employee_views.all() per hybrid policy.',
            ],
            [
                "Toast suppression",
                'Suppress success toast when only config-shaped keys are present in the patch (silent autosave). Keep "View renamed" toast when the patch carries name alone.',
            ],
        ],
    },
    {
        letter: "D",
        name: "Provider deletion + ListView refactor",
        desc: "Remove Provider_Page_Employees_List entirely — view query data becomes the single source of truth. PageEmployees_ListView reads the active view directly and drops all Save/Save-As/Cancel machinery + dirty-diff logic.",
        tasks: [
            [
                "Provider delete",
                "Delete src/providers/employees/Provider_Page_Employees_List.tsx and remove the <Provider_Page_Employees_List> wrapper from Page_Employees.tsx.",
            ],
            [
                "ListView read-from-query refactor",
                "PageEmployees_ListView.tsx drops every useProvider_Page_Employees_List / pList.* reference and Utils_EmployeeView_CleanConfig import. Projects active view fields onto local read-only consts (filter, sort, groupBy, hiddenKeys, fieldOrder, fieldWidths) via qViews.views.find(v => v.id === search.viewId).",
            ],
            [
                "Save/Cancel handler removal",
                "Drop handleSaveCurrentView / handleSaveAs / handleCancelChanges callbacks + the hydration useEffect that synced savedConfig from server — server is now the only state.",
            ],
        ],
    },
    {
        letter: "E",
        name: "Toolbar UI rework",
        desc: "Right-aligned tool cluster with labelled buttons, count phrases when active, and primary-tint active styling. Removes Search / Save / Save As / Cancel Changes entirely.",
        tasks: [
            [
                "Toolbar layout to right",
                "Remove the absolute-positioned middle cluster. Tools live in a right-aligned cluster via marginLeft: auto after the left cluster (sidebar toggle + view name).",
            ],
            [
                "Reorder buttons",
                "Order is now Hide Fields → Filters → Groups → Sort. Each is a labelled <Button> with icon (no Tooltip-only icons).",
            ],
            [
                "Active state styling",
                "Active state uses { background: token.colorPrimaryBg, color: token.colorPrimary, borderColor: token.colorPrimaryBg } so it follows the ANTD theme instead of hardcoded colors.",
            ],
            [
                "Count phrase labels",
                'Active label replaces base label with count: "Hide fields" ↔ "{N} hidden", "Filters" ↔ "Filtered by {N}", "Groups" ↔ "Grouped by {N}", "Sort" ↔ "Sorted by {N}".',
            ],
            [
                "Search/Save/Save-As/Cancel removal",
                'Search button + popover + toolState.search + filter-by-search logic removed. Save / Save As / Cancel Changes buttons + handlers + the "Save view as" nameModal variant removed. PageEmployees_ViewNameModal kept for sidebar Create / Rename flows only.',
            ],
        ],
    },
    {
        letter: "F",
        name: "Wire toolbar interactions to surgical mutations",
        desc: "Every interaction fires a partial-patch mutation against the active view. Filter text/number inputs are debounced so fast typing collapses to one PATCH.",
        tasks: [
            [
                "Sort wiring",
                "Sort popover updateSortEntry / removeSortEntry / drag-reorder each call mUpdateView.mutate({ viewId, sort: nextSort }).",
            ],
            [
                "Filter wiring + debounce",
                "Filter editor rendered as flat condition list (no nested groups). add/remove/edit calls mUpdateView.mutate({ viewId, filter: nextFilter }). Value commits for text/number filters debounced 400ms via local useDebouncedCallback.",
            ],
            [
                "Group wiring",
                "Group popover changes fire mUpdateView.mutate({ viewId, group_by: nextGroupBy }).",
            ],
            [
                "Hide Fields wiring",
                "Checkbox toggles in the Hide Fields popover fire mUpdateView.mutate({ viewId, hidden_keys: nextHiddenKeys }).",
            ],
            [
                "Operators map update",
                "OPERATORS_BY_TYPE in PageEmployees_ListView updated to drop kind/combinator references and match the flat FilterCondition shape.",
            ],
        ],
    },
];

(async () => {
    const results = {};
    for (const phase of PHASES) {
        const r = await processPhase(phase.letter, phase.name, phase.desc, phase.tasks);
        results[phase.letter] = r;
    }
    console.log("\n--- RESULTS JSON ---");
    console.log(JSON.stringify(results, null, 2));
})();
