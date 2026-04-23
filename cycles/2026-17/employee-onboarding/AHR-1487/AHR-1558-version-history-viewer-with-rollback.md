# Version history viewer with rollback

Work Item: [AHR-1558](https://plane.jimbui.dev/aiur/browse/AHR-1558/)
Tier 1: [AHR-1487](https://plane.jimbui.dev/aiur/browse/AHR-1487/) [v0.0.1 | Employee Onboarding] Contract template versioning + archive-only lifecycle (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: HR can see a template's full edit history (who changed what, when) and roll back to any earlier version. Rollback creates a new version matching the target — no history is destroyed.

Tech: pure frontend work — two new hooks (`useQ_Tables_ContractTemplateVersions`, `useM_ContractTemplate_Restore`), one new drawer component (`App_ContractTemplateVersionsDrawer`), and one wiring change to `App_FormBuilderModal.tsx` (history button in toolbar + imperative editor reset on restore). No schema / edge function / RPC changes — the AHR-1489 trigger already handles new version writes.

Related: AHR-1488 (versions table + RLS), AHR-1489 (auto-versioning trigger). These provide the entire backend surface this T2 consumes.

Siblings: 5 total, 4 Done (local, pending /pp) — AHR-1488 (Done local), AHR-1489 (Done local), AHR-1490 (Done local), AHR-1491 (Done local)
Execution Order: Step 4 of 4 — prerequisites AHR-1488 + AHR-1489 Done ✓ (local). Independent of AHR-1490/1491 (snapshot paths).

## Phase A: Data hooks

- [x] Create `frontend/vite/src/hooks/useQ_Tables_ContractTemplateVersions.ts`:
  - Input: `{ templateId: string }`
  - Query: `supabase.from("contract_template_versions").select("id, template_id, version_number, type, layout, pdf_file_path, mandatory_field_keys, content_hash, created_at, created_by, profiles(id, full_name, email, avatar_url)").eq("template_id", templateId).order("version_number", { ascending: false })`
  - QueryKey: `[...QueryKeys.contract_template_versions.list(), { templateId }]`
  - `enabled: !!templateId` (guard against empty templateId)
  - Export `Tables_ContractTemplateVersions_QueryData` type alias (Awaited return type) and the hook
- [x] Create `frontend/vite/src/hooks/useM_ContractTemplate_Restore.ts`:
  - Input: `{ templateId: string }`
  - `mutationFn`: accepts `{ layout: Json; type: 'tiptap' | 'pdf'; pdf_file_path: string | null; mandatory_field_keys: Json; versionNumber: number }`, calls `supabase.from("contract_templates").update({ layout, type, pdf_file_path, mandatory_field_keys }).eq("id", templateId).select().single()`
  - `onSuccess`: `message.success(\`Restored to v${versionNumber}\`)`, `invalidateQueries({ queryKey: QueryKeys.contract_templates.all() })`, `invalidateQueries({ queryKey: QueryKeys.contract_template_versions.all() })`
  - `onError`: `console.error`, `message.error("Failed to restore version")`
  - Returns `{ mutation }` (matches existing hook shape)

## Phase B: History drawer component

- [x] Create `frontend/vite/src/components/employees/App_ContractTemplateVersionsDrawer.tsx`
- [x] Props: `{ open: boolean; onClose: () => void; templateId: string; organizationId: string; onRestored: (body: { layout: JSONContent; type: 'tiptap' | 'pdf'; pdf_file_path: string | null; mandatory_field_keys: string[] }) => void }`
- [x] Imports: `Drawer, List, Button, Typography, Tag, Avatar, Tooltip, App, theme` from `antd`, `HistoryOutlined`/`UndoOutlined` from `@ant-design/icons`, `dayjs` with `relativeTime` plugin extended once at module top
- [x] Layout: `<Drawer width={900} placement="right" open={open} onClose={onClose} title="Version history" destroyOnClose={false}>`
- [x] Body: flex row — left pane (width 320, `borderRight: 1px solid token.colorBorderSecondary`, overflowY auto) + right pane (flex 1, overflow auto, padded)
- [x] Data: `useQ_Tables_ContractTemplateVersions({ templateId })` for list, `useM_ContractTemplate_Restore({ templateId })` for action
- [x] Selection state: `const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)`; default to latest on mount/refresh via `useEffect`
- [x] List rows (ANTD `List` + `List.Item`):
  - Header line: `v{version_number}` + (on top row only) `<Tag color="blue">Latest</Tag>`
  - Secondary line: `{absolute_timestamp}` · `{relative_timestamp}` via `dayjs(created_at).format('YYYY-MM-DD HH:mm')` and `dayjs(created_at).fromNow()`
  - Author: `<Avatar src={profiles?.avatar_url} size="small" />` + `{profiles?.full_name ?? profiles?.email ?? 'Unknown'}`
  - Non-latest rows: a borderless `Button type="text" size="small" icon={<UndoOutlined />}` labeled "Restore" on the right
  - Entire row is clickable to select (sets `selectedVersionId`); apply selected styling (`backgroundColor: token.colorPrimaryBg`) when matched
- [x] Preview pane (right): renders the selected version's layout via `<App_ContractFiller mode="review" layout={selected.layout as JSONContent} fieldValues={{}} prefilledValues={{}} columns={qColumns.columns} choices={qChoices.choices} onChange={() => {}} />`. Use `useQ_Tables_EmployeeColumns` and `useQ_Tables_EmployeeColumnChoices` hooks with the `organizationId` prop (same pattern as `App_OnboardingReviewModal`)
- [x] Restore flow:
  - `handleRestore(v)` → `modal.confirm({ title: \`Restore v${v.version_number}?\`, content: "This creates a new version with the content of this snapshot. Your current unsaved draft will be lost.", okText: "Restore", onOk: () => mutate({ layout: v.layout, type: v.type, pdf_file_path: v.pdf_file_path, mandatory_field_keys: v.mandatory_field_keys, versionNumber: v.version_number }) })`
  - After `mutation.isSuccess`: call `onRestored({ layout: v.layout, type: v.type, pdf_file_path: v.pdf_file_path, mandatory_field_keys: v.mandatory_field_keys })` then `onClose()`. Easiest: put these in a `useEffect([mutation.isSuccess])` after capturing the restored version in ref so the effect has the body
  - Disable the Restore button and show a spinner in its place while `mutation.isPending`
- [x] Empty state: if templates has only v1 (nothing to restore to), show the list with just the Latest row and no action buttons. Not an error state

## Phase C: Wire into FormBuilderModal

- [x] Open `frontend/vite/src/components/employees/App_FormBuilderModal.tsx`
- [x] Add local state: `const [historyOpen, setHistoryOpen] = useState(false)`
- [x] Add imports: `HistoryOutlined` from `@ant-design/icons`, the new `App_ContractTemplateVersionsDrawer` component
- [x] Add History button to the row containing the Segmented view switcher (line ~546), BEFORE the `<Segmented>` element:
  ```tsx
  <Tooltip title={formId ? 'Version history' : 'Save the template first to see history'}>
    <Button
      type="text"
      size="small"
      icon={<HistoryOutlined />}
      disabled={!formId}
      onClick={() => setHistoryOpen(true)}
    />
  </Tooltip>
  ```
- [x] Implement `handleRestored(body)` — imperatively sync the editor:
  - `editor?.commands.setContent(body.layout as JSONContent)` to replace the TipTap document
  - `setMandatorySet(new Set(body.mandatory_field_keys))` to sync mandatory state
  - Update `initialStateRef.current` so dirty comparison resets (use the same serialization as existing dirty detection — `JSON.stringify(body.layout)` and `JSON.stringify(body.mandatory_field_keys)`)
  - `setIsDirty(false)` (template now matches the restored server state)
  - Do NOT touch `formName` (restore doesn't change it)
- [x] Render the drawer at the end of the modal JSX (sibling of main content):
  ```tsx
  <App_ContractTemplateVersionsDrawer
    open={historyOpen}
    onClose={() => setHistoryOpen(false)}
    templateId={formId ?? ''}
    organizationId={organizationId}
    onRestored={handleRestored}
  />
  ```
  (ANTD handles z-index so Drawer sits above the Modal)
- [x] Typecheck: `pnpm tsc --noEmit` from `frontend/vite/` — no new errors

## Phase D: Smoke test (manual — end-to-end)

- [ ] Dev server up: `pnpm dev`
- [ ] Create a new template (don't save): History button is disabled with tooltip "Save the template first to see history"
- [ ] Save + reopen an existing template with multiple versions: History button enabled
- [ ] Click History → drawer opens with versions listed newest-first; top row has "Latest" tag; each row shows absolute + relative time + author
- [ ] Click different version rows → preview pane updates to show that version's content (read-only)
- [ ] Click "Restore" on a non-latest row → confirm modal appears → click Restore → toast "Restored to v{N}" appears, drawer closes, editor content updated to match the restored version
- [ ] DB check: new version row exists with same `content_hash` as the target version, new `version_number`, `created_by` = current user
- [ ] Reopen History: the new version is at the top with "Latest" tag; the original target version is still in the list unchanged
- [ ] Dirty indicator: after restore, editor shows "not dirty" (no unsaved-changes warning on close)

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Query hook: (pending)
- Restore hook: (pending)

Phase B: (pending)

- Drawer component: (pending)

Phase C: (pending)

- FormBuilderModal wiring: (pending)

Phase D: (pending)

- Smoke test: (pending)
