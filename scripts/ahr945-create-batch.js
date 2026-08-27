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
const T2_UUID = "1d7f17f6-1b6b-4c24-bb2e-5ef180819dae";
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
    "[v0.0.1 | Employee Management] Table view UX overhaul — auto-save, field composer, drag-order columns > Contract template management in onboarding wizard + soft delete";

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
        name: "Soft delete migration",
        desc: "Add is_archived boolean to contract_templates so existing onboarding invitations survive when admins remove unused templates. Partial index on (organization_id, is_archived) WHERE is_archived = false keeps the active-templates lookup cheap.",
        tasks: [
            [
                "Migration creation",
                "20260417100002_ahr945_contract_templates_add_is_archived.sql — ALTER TABLE contract_templates ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT false plus a partial index on active rows.",
            ],
            [
                "Apply locally",
                "pnpm sb:dev:push — applied via Supabase CLI per bible-supabase-cli.",
            ],
            [
                "Regenerate types",
                'pnpm sb:dev:types — Tables<"contract_templates"> row type now includes is_archived: boolean.',
            ],
        ],
    },
    {
        letter: "B",
        name: "Hook updates",
        desc: "Rename the delete mutation to archive and switch from hard delete to is_archived = true. Default-hide archived rows from all consumers via the query hook.",
        tasks: [
            [
                "Rename hook file + export",
                "Rename src/hooks/useM_ContractTemplate_Delete.ts → useM_ContractTemplate_Archive.ts. Export becomes useM_ContractTemplate_Archive; params type UseM_ContractTemplate_Archive_Params.",
            ],
            [
                "Switch delete → update is_archived",
                'Replace .delete().eq("id", templateId) with .update({ is_archived: true }).eq("id", templateId). mutationKey now ["contractTemplates", "archive", ...].',
            ],
            [
                "Toast change",
                'message.success now reads "Template archived" (was "Template deleted").',
            ],
            [
                "Query filter is_archived = false",
                'useQ_Tables_ContractTemplates adds .eq("is_archived", false) to the SELECT chain so archived rows disappear from every consumer.',
            ],
            [
                "Update call sites",
                "Grep-verified no stale useM_ContractTemplate_Delete imports remain; wizard archive path uses the renamed hook.",
            ],
        ],
    },
    {
        letter: "C",
        name: "Wizard step 2 redesign",
        desc: 'Consolidate template create/pick/edit/archive into onboarding wizard step 2. Search input + Create button + hover-only Edit/Archive per card. Empty state becomes a centered Empty + "Create your first template" CTA.',
        tasks: [
            [
                "Wizard step 2 search + create row",
                'App_OnboardingWizardModal step 2 (line 221 area) gains a top row: Input with SearchOutlined prefix + allowClear, then a Button type="primary" icon=<PlusOutlined /> "Create template". Search wired to local templateSearch state and filters client-side by name (case-insensitive).',
            ],
            [
                "Per-row hover actions Edit + Archive",
                "Each template card renders a hover-only action group: pencil (Edit → opens App_FormBuilderModal in EDIT mode with templateId) + trash (Archive → modal.confirm then useM_ContractTemplate_Archive).",
            ],
            [
                "Empty state revamp",
                'Old "Create one via View Forms first" placeholder replaced with centered <Empty> + primary "Create your first template" button that opens form builder in CREATE mode.',
            ],
            [
                "Form builder modal mount inside wizard",
                "State added: builderOpen, editingTemplateId, templateSearch. <App_FormBuilderModal open={builderOpen} onClose={…} organizationId={organizationId} formId={editingTemplateId} /> mounted as a sibling of the wizard modal.",
            ],
        ],
    },
    {
        letter: "D",
        name: "Cleanup — delete old surfaces",
        desc: "Remove the standalone View Forms surface now that wizard step 2 owns template CRUD.",
        tasks: [
            [
                "Delete App_OnboardingFormsList",
                "src/components/employees/App_OnboardingFormsList.tsx deleted.",
            ],
            [
                "Delete App_ViewFormsModal",
                "src/components/employees/App_ViewFormsModal.tsx deleted.",
            ],
            [
                "Remove Page_Employees View Forms button",
                'Page_Employees.tsx — remove App_ViewFormsModal import, viewFormsOpen state, the "View Forms" header button, and the modal mount.',
            ],
        ],
    },
    {
        letter: "E",
        name: "Form button styling",
        desc: 'Drop size="small" on relocated buttons so wizard step 2 uses default-size primary buttons with global ANTD tokens; no inline borderRadius overrides.',
        tasks: [
            [
                'Drop size="small"',
                'New "+" button + "Create your first template" button use default size with token-driven styling.',
            ],
            [
                "Verify visual consistency",
                "Buttons match the size/radius of surrounding Select/Input controls in wizard step 2.",
            ],
        ],
    },
    {
        letter: "F",
        name: "Standalone Manage Templates entry + shared manager extraction",
        desc: 'Addendum: wizard-only path forced users through steps 1-2 just to CRUD a template. Added a direct "Manage Templates" button in App_OnboardingModal title bar and extracted the wizard step 2 body into a shared component so both surfaces stay in sync.',
        tasks: [
            [
                "Create App_ContractTemplatesManager",
                "src/components/employees/App_ContractTemplatesManager.tsx — shared body with search input + Create button, card grid with hover Edit/Archive, internally-mounted App_FormBuilderModal. Props: organizationId, selectedTemplateId?, onSelect?. Without onSelect, card click opens Edit mode.",
            ],
            [
                "Create App_ContractTemplatesManagerModal",
                'src/components/employees/App_ContractTemplatesManagerModal.tsx — thin standalone Modal (70vw, title "Manage Templates", FileTextOutlined) wrapping the shared manager.',
            ],
            [
                "Refactor wizard step 2 to shared manager",
                "App_OnboardingWizardModal step 2 delegates to <App_ContractTemplatesManager selectedTemplateId onSelect={setSelectedTemplateId} />. Dropped local state (templateSearch/builderOpen/editingTemplateId/hoveredTemplateId), filteredTemplates memo, handleArchiveTemplate/openBuilderCreate/openBuilderEdit callbacks, and the in-wizard App_FormBuilderModal mount.",
            ],
            [
                "Prune wizard imports",
                "Removed now-unused imports from App_OnboardingWizardModal: Card, Empty, SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined, App from antd, useM_ContractTemplate_Archive, App_FormBuilderModal.",
            ],
            [
                "Add Manage Templates button to App_OnboardingModal",
                'App_OnboardingModal title-bar action group now has two buttons: default "Manage Templates" (FileTextOutlined) left of primary "Onboard Employee". Added templatesManagerOpen state and mounted <App_ContractTemplatesManagerModal> as sibling.',
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
