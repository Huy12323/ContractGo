#!/usr/bin/env node
const PLANE_API_KEY = 'plane_api_2173f1bbcaeb406cb725369589adf627';
const BASE = 'https://plane.jimbui.dev';
const SLUG = 'aiur';
const PROJECT_ID = '53594a97-bd1d-4d52-bcb9-ebacadc41464';
const STATE_DONE = 'b78525a5-e6f0-439a-b0ab-5191a046b55c';
const ASSIGNEE = '34232675-13d1-4b23-b90c-d5abe8bfd83b';
const CYCLE = '0e5adea2-0792-4257-aa58-ab225d92665e';
const MODULE_UUID = '3fd67ea1-f53b-40dc-9382-ee2bc8234f58';
const VERSION_DOC_URL = 'https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802';
const T2_UUID = '373564ad-c065-4f03-b5f6-2e60f12cb961';
const PROJECT_IDENTIFIER = 'AHR';
const START = '2026-04-16';
const DUE = '2026-04-25';

const headers = { 'X-API-Key': PLANE_API_KEY, 'Content-Type': 'application/json' };
const projBase = `${BASE}/api/v1/workspaces/${SLUG}/projects/${PROJECT_ID}`;
const wrapDesc = (text) => `<p>Version: <a href="${VERSION_DOC_URL}">Outline</a></p><p>${text}</p>`;

async function createIssue({ name, parentUuid, descText }) {
    const body = {
        name, state: STATE_DONE, priority: 'medium', parent: parentUuid,
        assignees: [ASSIGNEE], start_date: START, target_date: DUE,
        description_html: wrapDesc(descText),
    };
    const r = await fetch(`${projBase}/issues/`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Create failed: ${r.status} ${await r.text()}`);
    const issue = await r.json();
    const ident = `${PROJECT_IDENTIFIER}-${issue.sequence_id}`;
    await fetch(`${projBase}/cycles/${CYCLE}/cycle-issues/`, { method: 'POST', headers, body: JSON.stringify({ issues: [issue.id] }) }).catch(() => {});
    await fetch(`${projBase}/modules/${MODULE_UUID}/module-issues/`, { method: 'POST', headers, body: JSON.stringify({ issues: [issue.id] }) }).catch(() => {});
    return { ident, uuid: issue.id };
}

const PREFIX = '[v0.0.1 | Employee Management] Table view UX overhaul — auto-save, field composer, drag-order columns > Field composer modal + single_select type';

async function processPhase(letter, name, desc, tasks) {
    const t3 = await createIssue({ name: `${PREFIX} > Phase ${letter} - ${name}`, parentUuid: T2_UUID, descText: desc });
    console.log(`Phase ${letter} T3: ${t3.ident}`);
    const t4s = [];
    for (let i = 0; i < tasks.length; i++) {
        const [tn, td] = tasks[i];
        const t4 = await createIssue({ name: `${PREFIX} > Phase ${letter} > ${tn}`, parentUuid: t3.uuid, descText: td });
        t4s.push({ name: tn, ident: t4.ident });
        console.log(`  T4 ${i + 1}/${tasks.length}: ${t4.ident} — ${tn}`);
    }
    return { t3, t4s };
}

const PHASES = [
    {
        letter: 'A',
        name: 'ENUM migration',
        desc: 'Add single_select as a new variant of the employee_column_type Postgres enum so the field composer can store single-value select columns alongside existing multi_select.',
        tasks: [
            ['Migration creation', '20260417100001_ahr943_employee_column_type_add_single_select.sql — ALTER TYPE employee_column_type ADD VALUE "single_select". Runs outside a transaction because Postgres forbids ENUM adds inside BEGIN/COMMIT.'],
            ['Apply locally', 'pnpm sb:dev:push — applied via Supabase CLI per bible-supabase-cli.'],
            ['Regenerate types', 'pnpm sb:dev:types — Enums<"employee_column_type"> now includes "single_select".'],
        ],
    },
    {
        letter: 'B',
        name: 'Type updates',
        desc: 'Propagate the new enum value into the frontend field-type union and the filter operator map.',
        tasks: [
            ['FieldType union extend', 'src/types/employeeTable.types.ts — EmployeeTable_FieldType becomes "text" | "number" | "date" | "boolean" | "single_select" | "multi_select".'],
            ['Operators map entry', 'OPERATORS_BY_TYPE.single_select = [equals, not_equals, is_empty, is_not_empty] added in PageEmployees_ListView.tsx (single-value semantics, no "in"/"not in").'],
        ],
    },
    {
        letter: 'C',
        name: 'Edge function update',
        desc: 'Rename the create-column body field from options to choices, and branch to insert into employee_column_choices for both single_select and multi_select (no schema change needed — both reuse the same choices table).',
        tasks: [
            ['Edge function rename body field', 'supabase/functions/employee-management_create-column/index.ts — body field renamed options → choices, parsed before the column-type branch.'],
            ['Branch for both select types', 'if (type === "single_select" || type === "multi_select") → insert into employee_column_choices with sort_order matching the array index. CORS, env loading, and RLS untouched.'],
        ],
    },
    {
        letter: 'D',
        name: 'const_EmployeeColumnsTypeOptions update',
        desc: 'Extend the central type-options map so the composer Select picker lists the new enum value. The Record<Enums<"employee_column_type">, ...> constraint forces this.',
        tasks: [
            ['Type options map entry', 'src/hooks/const_EmployeeColumnsTypeOptions.ts — add single_select: { value: "single_select", label: "Single select", icon: <UnorderedListOutlined /> }.'],
        ],
    },
    {
        letter: 'E',
        name: 'Build composer modal',
        desc: 'New App_EmployeeFieldComposerModal replaces App_FieldManagerModal + App_CreateFieldModal. Handles CREATE + EDIT + choice management for all column types in a single 480px modal.',
        tasks: [
            ['Composer skeleton', 'New src/components/employees/App_EmployeeFieldComposerModal.tsx — props { open, onClose, organizationId, mode: "create" | "edit", columnId? }. Width 480px, centered (ANTD default).'],
            ['Form rows + conditional choices', 'Label Input, Type Select (sourced from const_EmployeeColumnsTypeOptions.options, disabled in edit mode). Choices section only rendered when type === "single_select" || type === "multi_select". Empty-label disables submit.'],
            ['EDIT mode hydration', 'Hydrates from useQ_Tables_EmployeeColumns for column metadata and useQ_Tables_EmployeeColumnChoices for choices.'],
            ['Submit logic create + update', 'CREATE calls the edge function with choices body field; EDIT updates column label via SDK direct and upserts choices via SDK. onSuccess invalidates QueryKeys.employee_columns.all() + QueryKeys.employee_column_choices.all(), closes modal, toasts "Field created" / "Field updated".'],
        ],
    },
    {
        letter: 'F',
        name: 'Choices editor (dnd-kit reorder)',
        desc: 'Sortable choice rows using @dnd-kit/core + @dnd-kit/sortable (already in the project via the view sidebar reorder). Drag updates local order; submit upsert loop writes sort_order = index.',
        tasks: [
            ['dnd-kit sortable choices', 'Each choice row: drag handle (HolderOutlined) left, label Input middle, delete text Button (MinusCircleOutlined) right. Reorder updates local choices state; submit preserves final index ordering.'],
            ['Add choice + delete row controls', '"+ Add choice" button at the bottom matches the old App_FieldManagerModal convention but uses consistent token styling.'],
        ],
    },
    {
        letter: 'G',
        name: 'Cleanup',
        desc: 'Remove the old field-management surfaces that the composer replaces.',
        tasks: [
            ['Delete App_FieldManagerModal', 'src/components/employees/App_FieldManagerModal.tsx deleted.'],
            ['Delete App_CreateFieldModal', 'src/components/employees/App_CreateFieldModal.tsx deleted (unused dead code).'],
            ['Remove Page_Employees Manage Fields entry', 'Page_Employees.tsx — remove App_FieldManagerModal import, fieldManagerOpen state, the "Manage Fields" button, and the modal mount.'],
            ['Replace form builder Manage button', 'App_FormBuilderModal.tsx — remove App_FieldManagerModal import + fieldManagerOpen state + modal mount; replace the "Manage" button with "+ Add field" that opens App_EmployeeFieldComposerModal in CREATE mode (no list/browse UI inside form builder).'],
        ],
    },
];

(async () => {
    const results = {};
    for (const phase of PHASES) {
        const r = await processPhase(phase.letter, phase.name, phase.desc, phase.tasks);
        results[phase.letter] = r;
    }
    console.log('\n--- RESULTS JSON ---');
    console.log(JSON.stringify(results, null, 2));
})();
