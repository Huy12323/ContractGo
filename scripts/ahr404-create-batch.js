#!/usr/bin/env node
const PLANE_API_KEY = 'plane_api_2173f1bbcaeb406cb725369589adf627';
const BASE = 'https://plane.jimbui.dev';
const SLUG = 'aiur';
const PROJECT_ID = '53594a97-bd1d-4d52-bcb9-ebacadc41464';
const STATE_DONE = 'b78525a5-e6f0-439a-b0ab-5191a046b55c';
const ASSIGNEE = '34232675-13d1-4b23-b90c-d5abe8bfd83b';
const CYCLE_2026_16 = '0e5adea2-0792-4257-aa58-ab225d92665e';
const MODULE_EMP_MGMT = '3fd67ea1-f53b-40dc-9382-ee2bc8234f58';
const VERSION_DOC_URL = 'https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802';
const T2_AHR404_UUID = 'fe8dda0c-aab1-4986-ba83-1788f4b6b085';

const headers = { 'X-API-Key': PLANE_API_KEY, 'Content-Type': 'application/json' };
const projBase = `${BASE}/api/v1/workspaces/${SLUG}/projects/${PROJECT_ID}`;
const wrapDesc = (text) => `<p>Version: <a href="${VERSION_DOC_URL}">Outline</a></p><p>${text}</p>`;

async function createIssue({ name, parentUuid, descText }) {
    const body = {
        name, state: STATE_DONE, priority: 'medium', parent: parentUuid,
        assignees: [ASSIGNEE], start_date: '2026-04-07',
        description_html: wrapDesc(descText),
    };
    const r = await fetch(`${projBase}/issues/`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Create failed: ${r.status} ${await r.text()}`);
    const issue = await r.json();
    const ident = `AHR-${issue.sequence_id}`;
    await fetch(`${projBase}/cycles/${CYCLE_2026_16}/cycle-issues/`, {
        method: 'POST', headers, body: JSON.stringify({ issues: [issue.id] }),
    }).catch(() => {});
    await fetch(`${projBase}/modules/${MODULE_EMP_MGMT}/module-issues/`, {
        method: 'POST', headers, body: JSON.stringify({ issues: [issue.id] }),
    }).catch(() => {});
    return { ident, uuid: issue.id };
}

const PHASE_PREFIX = '[v0.0.1 | Employee Management] Employees page — saved views > Create employee_views table';

const PHASE = {
    letter: 'A',
    name: 'Migration',
    desc: 'Single migration creating the employee_views table with mixed RLS (SELECT via is_org_member, CUD via is_admin_or_owner). config stays Json — TypeScript override deferred to AHR-405.',
    tasks: [
        ['Create migration file with employee_views schema', 'supabase/migrations/20260414113009_ahr404_create_employee_views.sql — id TEXT PK DEFAULT generate_id(\'evw\'), organization_id TEXT NOT NULL FK (CASCADE), created_by UUID FK to profiles (SET NULL), name TEXT NOT NULL, config JSONB NOT NULL DEFAULT \'{}\'\'::jsonb, is_default BOOLEAN DEFAULT false, created_at + updated_at timestamps. Index on organization_id.'],
        ['Add 4 RLS policies (mixed: SELECT org_member, CUD admin_or_owner)', 'org_members_can_view_employee_views (SELECT via is_org_member), admin_or_owner_can_insert/update/delete_employee_views (CUD via is_admin_or_owner). Saved views are a shared org asset — HR curates them, employees pick from them.'],
        ['Apply migration locally + lint + regen types', 'pnpm sb:dev:push, supabase db lint --local, pnpm sb:dev:types. Verified employee_views appears in database.types.ts with config: Json (override comes in AHR-405).'],
    ],
};

(async () => {
    const t3 = await createIssue({
        name: `${PHASE_PREFIX} > Phase ${PHASE.letter} - ${PHASE.name}`,
        parentUuid: T2_AHR404_UUID,
        descText: PHASE.desc,
    });
    console.log(`Phase ${PHASE.letter} T3 created: ${t3.ident}`);
    const t4s = [];
    for (let i = 0; i < PHASE.tasks.length; i++) {
        const [n, d] = PHASE.tasks[i];
        const t4 = await createIssue({
            name: `${PHASE_PREFIX} > Phase ${PHASE.letter} > ${n}`,
            parentUuid: t3.uuid,
            descText: d,
        });
        t4s.push({ name: n, ident: t4.ident });
        console.log(`  T4 ${i + 1}/${PHASE.tasks.length}: ${t4.ident} - ${n}`);
    }
    console.log('\n--- RESULTS ---');
    console.log(JSON.stringify({ t3, t4s }, null, 2));
})();
