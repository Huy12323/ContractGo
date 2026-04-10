# [v0.0.1 | Employee Management] Contract composer template builder > Contract composer editor

Work Item: [AHR-467](https://plane.jimbui.dev/aiur/browse/AHR-467/)
Tier 1: [AHR-464] [v0.0.1 | Employee Management] Contract composer template builder (In Progress)
Module: [Employee Management](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: [Employee Management](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd)
Version Doc: [Employee Management](https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802)

## Context (from spec)

Non-tech: Replace the drag-and-drop field grid form builder with a TipTap rich text editor. Admins compose contract templates mixing static text (headings, paragraphs, lists) with inline dynamic field placeholders. Saved as TipTap JSON; existing string[][] layouts auto-migrate on load.
Tech: `src/components/employees/App_FormBuilderModal.tsx` — full rewrite (697 lines DnD → TipTap). New TipTap packages. Custom `FieldInput` inline node extension. Existing query/mutation hooks reused. `onboarding_forms.layout` column unchanged (JSONB, richer shape).
Related: [Database](https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b) — base schema. [Organization](https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — org context, App_OrgSettingsModal.
Siblings: 4 total, 0 Done — [AHR-467 Contract composer editor (this), AHR-468 Contract template preview (Not started), AHR-469 employee_contracts table (Done local, pending /pp), AHR-470 Organization soft delete (Cancelled)]
Execution Order: Step 2 of 3 — AHR-469 done (local) ✓

## Phase A: TipTap setup + custom FieldInput extension

- [x] Install TipTap packages (@tiptap/react, @tiptap/starter-kit, @tiptap/pm, @tiptap/core)
- [x] Create FieldInput custom inline node extension — inline atom with attrs (fieldKey, fieldLabel, fieldType), renders as uniform styled chip (label + type text), non-editable
- [x] Create utils_FormBuilder_migrateLayout utility — converts string[][] (old DnD format) to TipTap ProseMirror JSON (one paragraph per row, FieldInput nodes per key)

## Phase B: Rewrite App_FormBuilderModal as TipTap contract composer

- [x] Replace DnD grid with TipTap EditorContent + formatting toolbar above editor (H1-H3 dropdown, bold, italic, ordered/unordered lists, horizontal rule)
- [x] Field palette sidebar — searchable list of universal + custom fields, click inserts FieldInput node at current cursor position
- [x] Load handler — detect layout format (Array.isArray → old, object with type:'doc' → TipTap), auto-migrate string[][], initialize editor with JSON content
- [x] Save handler — extract editor JSON via editor.getJSON(), store in onboarding_forms.layout
- [x] Preview mode — toggle to read-only TipTap view with field chips as styled placeholders

## Phase C: @dnd-kit cleanup

- [x] Uninstall @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities + remove from package.json and pnpm-lock.yaml

---

## Plane IDs (populated by /pp)

Phase A: AHR-477
- Task 1: AHR-478
- Task 2: AHR-479
- Task 3: AHR-480

Phase B: AHR-481
- Task 1: AHR-482
- Task 2: AHR-483
- Task 3: AHR-484
- Task 4: AHR-485
- Task 5: AHR-486

Phase C: AHR-487
- Task 1: AHR-488
