---
name: po
description: Product organization — Plane project management + Outline spec docs. Load for any Plane URL, module, work item, cycle, or Outline doc operation.
---

# Product Organization (PO)

Constants, conventions, and protocols for **Plane MCP** and **Outline MCP**.

Load this skill when working with Plane URLs, modules, work items, cycles, or Outline spec docs.

Reference: `docs/pm.md` for the full PM flow documentation.

---

## Config Enforcement

**Before any command execution:** If a required value from `config.json` is empty, missing, or still contains `${PLACEHOLDER}`, STOP and ask the user to provide the value before proceeding. Do not guess or skip — commands depend on accurate config values.

---

## Plane Constants

```
WORKSPACE_SLUG:     aiur
PROJECT_ID:         53594a97-bd1d-4d52-bcb9-ebacadc41464
PROJECT_IDENTIFIER: AHR
BASE_URL:           https://plane.jimbui.dev
PLANE_MCP_SERVER:   plane-aiur-hr
```

### Default Assignees

Two `.env` variables provide default assignees so agents don't ask every time:

| Variable | Used by | Purpose |
|----------|---------|---------|
| `DEFAULT_INTAKE_ASSIGNEE_UUID` | `/intake` | Default assignee for new intake items |
| `DEFAULT_ITEM_ASSIGNEE_UUID` | `/pm`, `/pp` | Default assignee for T1–T4 work items and cycle `owned_by` |

**Resolution order:**
1. If user explicitly says "assign to X" → use that person (look up via `get_project_members` MCP)
2. Else read the default from `.env`
3. If `.env` value is empty → **bootstrap**: call `get_project_members` MCP, list members to user, let them pick, then **append the chosen UUID to `.env`** so future runs use it automatically

### Members

Use `get_project_members` or `get_workspace_members` MCP to look up member UUIDs on demand. Do not hardcode member lists — they go stale.

### Work Item States

| State       | UUID                  |
| ----------- | --------------------- |
| Backlog     | 3d33956f-defb-47ad-9001-5852d9be63b9 |
| Todo        | b84178ec-e039-434f-b522-c21514c18434    |
| In Progress | f9a589dd-4202-4b99-a629-5e6e5bdcd178 |
| Done        | b78525a5-e6f0-439a-b0ab-5191a046b55c    |
| Passed      | 9e8b9431-3e64-4782-8ce4-9909ad2abcb8  |
| Announced   | 7e0938df-3ef4-47a7-8626-cb0fd8294e87 |
| Approved    | c4e7f4cd-e72f-4fb6-8e18-05a37a6b45bc |
| Deployed    | dbdefe79-3a53-4bcd-9f29-76a87d8219d2 |
| Cancelled   | bd5ea8ec-b09b-4e5b-9ed1-b11db662bd40 |

### Post-Completion Pipeline

After `/pp` marks T1 as Done, the PM manages four additional states:

```
Done → Passed → Announced → Approved → Deployed
       (manual)  (/pi)       (manual)   (manual)
```

Passed/Approved/Deployed are manual PM milestones. `/pi` handles Done→Announced with Outline task report + stakeholder email. Task reports live under `TASK_REPORTS_DOC_ID`.

### Module Statuses

`planned` → `in-progress` → `completed` | `paused` | `cancelled`

### Estimate Points (Fibonacci)

Estimate ID: `bd9495bc-8a0e-4884-b381-496bb33ba067`

| Value | UUID                    |
| ----- | ----------------------- |
| 1     | ba732032-b045-471b-bb72-1a67ed10408f      |
| 2     | 58f0c16d-32b2-4956-9104-754a344a58e3      |
| 3     | a1a9f1c5-e84a-4f7c-bfeb-dbd22f3b30c6      |
| 5     | 1965e92d-6da9-4b80-8bda-d6dbc7300744      |
| 8     | dcb59dc5-7298-4610-bfd8-dd940facd993      |
| 13    | ca085854-0a87-44f7-8432-a9621e1f8617     |

Use `estimate_point` field (UUID) on work items, NOT `point` (integer).

### Estimate Reassessment (`/pp`)

`/pp` always reassesses tier 2 estimates after implementation. If user approves an update:
- Store `Original Estimate: N points` in the tier 2 `description_html` (append after existing content)
- Update `estimate_point` to the new Fibonacci UUID
- `estimate_point` then reflects final (actual) points; original is preserved in description
- `/rp` script extracts both via regex: `Original Estimate:\s*(\d+)\s*points?`

---

## Outline Constants

```
OUTLINE_BASE_URL:       https://outline.jimbui.dev
ROOT_DOC_ID:            d910a242-9a26-482b-bfd0-97df5b894700
SPECIFICATIONS_DOC_ID:  d16c1c9e-5073-4f72-8953-e7fd5c1efeec
VERSIONS_DOC_ID:        0c30f2ab-6aae-49f8-a3e3-8b881266056c
CYCLES_DOC_ID:          351ed87e-5c5d-47f3-bbd4-d4e0ea6168ed
TASK_REPORTS_DOC_ID:    2ed55ba8-a64c-49bb-a87d-e03acb9ec2ad
ROADMAP_DOC_ID:         deac0d90-3175-4878-8a68-c060bfc6383c
COLLECTION_ID:          842bb492-0b21-4695-8470-dd337f44a5ac
```

---

## URL Construction

| Service         | Pattern                                                                        | Use                     |
| --------------- | ------------------------------------------------------------------------------ | ----------------------- |
| Outline doc     | `{OUTLINE_BASE_URL}/doc/{uuid}`                                                | All Outline links       |
| Plane module    | `{BASE_URL}/{WORKSPACE_SLUG}/projects/{PROJECT_ID}/modules/{module_id}/`       | Module links            |
| Plane browse    | `{BASE_URL}/{WORKSPACE_SLUG}/browse/{PROJECT_IDENTIFIER}-{N}/`                 | Work item links in UI   |
| Plane API item  | `{BASE_URL}/{WORKSPACE_SLUG}/projects/{PROJECT_ID}/work-items/{work_item_id}/` | API calls only (not UI) |

**Always use the browse URL for human-facing links** (descriptions, tracking checklists, docs). The projects/work-items/ URL is for API calls only — it 404s in the browser.

---

## Navigation Links

**Outline spec docs:**

```markdown
> Module: [Plane]({module_url})
```

**Outline version docs:**

```markdown
> Spec: [Outline]({spec_url}) | Module: [Plane]({module_url})
```

**Plane module description:**

```markdown
Spec: [Outline]({spec_doc_url})
```

**Plane work items (tier 1+2):**

```markdown
Version: [Outline]({version_doc_url})
```

**Identifier IDs in version docs:**

```markdown
- Phase A: Build grid [{PROJECT_IDENTIFIER}-42]({work_item_url})
```

---

## Outline Document Hierarchy

Outline is the **single source of truth**. No local spec files.

```
[ROOT_DOC_ID] Project
├── [SPECIFICATIONS_DOC_ID] Specifications/
│   ├── Module A/                          ← doc title: "Module A"
│   │   └── Sub-feature/                   ← doc title: "Sub-feature" (Plane name: "Module A: Sub-feature")
│   └── Module B/
├── [TASK_REPORTS_DOC_ID] Task Reports/
│   ├── [T1 Title] — Task Report/      ← created by /pi
│   └── [T1 Title] — Task Report/
├── [VERSIONS_DOC_ID] Versions/
│   ├── v1.0.0/
│   │   ├── Module A/                      ← flat, full Plane name
│   │   ├── Module A: Sub-feature/         ← flat, full Plane name (NOT nested under Module A)
│   │   └── Module B/
│   └── v1.1.0/
│       └── Module A/
└── [CYCLES_DOC_ID] Cycles/
    ├── YYYY/WW/
    └── YYYY/WW/
```

**Sub-module naming rule (Specifications only):** Spec docs use the **short name** (part after `:`) and nest under their parent. The parent doc provides scope — repeating it in the title is redundant. **Version docs stay flat** with the full Plane name for easy scanning. See Module Conventions → "Naming across systems" for examples.

### Specifications Root Doc (Product Bible)

The Specifications root doc (`SPECIFICATIONS_DOC_ID`) is the **Product Bible** — the first document any agent reads to understand the entire product. Contains:

1. **Product Vision** — what the product is, who it's for, the problem it solves
2. **Architecture Overview** — technology stack, infrastructure, auth model, repos
3. **Production Domains / Deployment** — domain → app mapping, deployment process, dormant/inactive apps
4. **External Integrations** — third-party services, payment processors, APIs, partner systems
5. **Module Map** — every module grouped by domain, 1-liner + link to spec doc, cross-module dependency diagram (mermaidjs)
6. **User Journeys** — key workflows through the app

**Update triggers:** `/pm` base (rewrite), `/pm` catch-up (initial write), `/pp` on version seal (targeted review), `/pm` triage on new module/major scope change (review).

### Spec Doc Format (under Specifications/)

Three sections per module:

1. **Non-Technical Description** — stakeholder-readable: current state only, concise (2-4 sentences + capability bullets). Include **Users** line (who uses this module). For inherited/maintenance systems, include **Known Issues / Feature Requests** bullets.
2. **Technical Implementation** — engineer-readable: current state only (file paths, components, schema, related modules). Include **Known Issues** for legacy debt. If module spans multiple repos, list each repo and what it contributes.
3. **Version History** — one-line links: `- [vX.Y.Z](outline_link) — summary`

Both sections 1 and 2 are **rewritten** (not appended) on each `/pp` to reflect current state. Keep concise for agent context limits.

### Version Doc Format (under Versions/vX.Y.Z/)

Two-phase document — created by `/pm` with context, completed by `/pp` with implementation details:

**Created by `/pm`:**
- Navigation links (spec doc + Plane module)
- Context & Rationale — why this version exists, discovery context
- Scope — in/out decisions from QA rounds
- Figma References — design links (if applicable)
- Affected Files — files to be touched, with identified issues
- Design Decisions — QA outcomes, convention choices

**Appended by `/pp`:**
- Summary (3-5 implementation bullets)
- Requirements (from tier 2)
- Implementation details (phases + tasks with identifier links)
- New/changed files

`/pp` appends below `/pm` context — never replaces it.

---

## Work Item Tier System

**Versioning is app-wide, not per-module.** All modules share a single version timeline (e.g., `v1.0.0` → `v2.0.0` → `v3.0.0` → `v3.0.1`). A new module added mid-development uses the current or next app-wide version, never its own `v1.0.0`. Always bump from the latest app-wide version.

**Baseline versioning (inherited systems):** When onboarding an existing/legacy codebase, `v1.0.0` represents the "maintenance baseline" — the current state as-inherited with no features. Modules are created with specs documenting the current state. No tier 1 work items are needed until actual work begins. Bug fixes and data changes enter as intake items, get triaged to the right module, and become tier 2 items under `v1.0.0`. Patch bumps (`v1.0.1`) apply when meaningful work ships.

```
Tier 1: [vX.Y.Z | Module] Title                                   ← /pm creates (Backlog → Todo → In Progress → Done)
  Tier 2: [vX.Y.Z | Module] Title > Feature                       ← /pm creates (Todo → In Progress → Done)
    Tier 3: [vX.Y.Z | Module] Title > Feature > Phase X - Name    ← /pp creates (Done)
      Tier 4: [vX.Y.Z | Module] Title > Feature > Phase X > Task  ← /pp creates (Done)
```

### Title Format

```
[...]  = metadata block (version + module) — always first
|      = separates version from module name inside brackets
>      = hierarchy separator — chains T1 title through all children
```

### Title Examples

```
Tier 1: [v2.0.0 | Auth] Password reset flow
Tier 2: [v2.0.0 | Auth] Password reset flow > Google OAuth login
Tier 3: [v2.0.0 | Auth] Password reset flow > Google OAuth login > Phase A - Auth layout
Tier 4: [v2.0.0 | Auth] Password reset flow > Google OAuth login > Phase A > Build two-panel grid
```

### Version Sealing

Once a tier 1 is Done, that version-module scope is sealed. New work = version bump + new tier 1.

### Property Cloning (Tier 2 → Tier 3 → Tier 4)

Clone: `priority`, `start_date`, `due_date`, `cycle`, `module`, `assignees`

### Work Item Descriptions

**Tier 1:**

```markdown
Version: [Outline]({version_module_doc_url})
```

When created from an intake item, add an Intake line:

```markdown
Version: [Outline]({version_module_doc_url})
Intake: [{PROJ-N}]({intake_browse_url})
```

**Tier 2:**

```markdown
Version: [Outline]({version_module_doc_url})

Requirements: [pass/fail criteria]
```

**Tier 3 (phase):**

```markdown
Version: [Outline]({version_doc_url})

{Phase description}
```

**Tier 4 (task):**

```markdown
Version: [Outline]({version_doc_url})

{Task description}
```

---

## Module Conventions

**Naming:** Clean, human-readable. Use `:` for sub-scoping (e.g., `3D Scene: Canvas`). No trailing colon.

**Naming across systems:** Plane is flat (no nesting) — the full colon-scoped name carries context (e.g., `3D Scene: Canvas`). Outline Specifications and Versions handle sub-modules differently:

| Context | Sub-module doc title | Structure | Why |
|---------|---------------------|-----------|-----|
| **Specifications/** | Short name (`Canvas`) | Nested under parent | Parent provides scope; avoids redundancy |
| **Versions/** | Full Plane name (`3D Scene: Canvas`) | Flat under version | Easy scanning at a glance |

**Specifications examples:**

| Plane module name | Spec doc title | Spec path |
|-------------------|---------------|-----------|
| `Auth` | `Auth` | `Specifications/Auth` |
| `3D Scene` | `3D Scene` | `Specifications/3D Scene` |
| `3D Scene: Canvas` | `Canvas` | `Specifications/3D Scene/Canvas` |
| `Production: Script` | `Script` | `Specifications/Production/Script` |

**Versions examples:** `Versions/v3.0.0/3D Scene: Canvas` (flat, full name).

**Parent / sub-module hierarchy:** When a feature area is too large for one module, create a parent module (e.g., `3D Scene`) covering the page container, provider, routing, and shared code. Sub-modules (e.g., `3D Scene: Canvas`) cover specific feature areas. When assigned work on a parent module, always assess sub-modules first — route work to the most specific sub-module that fits. Only container-level work stays on the parent.

**Multi-repo modules:** When a module spans multiple repositories (e.g., backend API + separate frontend), the spec doc Technical Implementation section lists each repo and its role. Plan files and version docs note which repo each change targets. Work items can reference both repos in their description.

**Rename protocol:** Rename Outline spec doc + Plane module. New version items use new name; old items keep original.

**Creation by /pm:** name, `start_date`: today, `target_date`: deadline, `lead`: assigned user, `status: "planned"`, `description`: `Spec: [Outline]({spec_doc_url})`

**Warning:** `update_module` rejects `members` field (HTTP 400) — use `lead` only.

### Intake Tracking

Intake items are tracked via the **INTAKE label** (not a module). This enables cross-project Plane views — Plane views can't filter by module, but can filter by label.

**Tracking checklist:** Each intake item has a `## Tracking` section at the top of its description with checkbox entries for each linked T1:

```markdown
## Tracking
- [ ] [v3.7.0 | Production: Script](plane_url) SPARK-1217
- [x] [v3.7.0 | Scripts](plane_url) SPARK-1218
```

**Lifecycle:**
1. `/intake` creates the intake item with INTAKE + type labels
2. `/triage` adds Technical Context
3. `/pm` ACCEPT creates T1(s) and runs `plane-intake-handling.js add` to add them to the tracking checklist
4. `/pp` on T1 seal runs `plane-intake-handling.js tick` to check off the T1. If all T1s are checked → intake → Done

**Note:** Intake items are NOT children of T1s. The tracking checklist is the linkage mechanism, not parent-child relations. One intake can span multiple T1s across different modules and versions.

**Cardinality:** Intake → T1 is 1:N (one intake can have many T1s). T1 → Intake is N:1 (each T1 references at most one intake via its `Intake:` description line). Never merge multiple intakes into a single T1.

---

## Cycle Conventions

**Naming:** `"YYYY/WW"` (week number, zero-padded). **Range:** Sunday 00:00:00 UTC → Saturday 23:59:59 UTC (matches Plane's UTC+0 Dublin setting).

**Current week number (UTC-safe, Sun-Sat):**

```bash
node -e "const d=new Date(),u=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())),y=u.getUTCFullYear(),j=new Date(Date.UTC(y,0,1)),w=Math.ceil(((u-j)/864e5+j.getUTCDay()+1)/7);console.log(y+'/'+String(w).padStart(2,'0'))"
```

**Cycle Sunday/Saturday dates for creation (UTC-safe):**

```bash
node -e "const d=new Date(),u=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));const dow=u.getUTCDay();const sun=new Date(u);sun.setUTCDate(u.getUTCDate()-dow);const sat=new Date(sun);sat.setUTCDate(sun.getUTCDate()+6);const f=d=>d.toISOString().split('T')[0];console.log(f(sun)+'T00:00:00Z');console.log(f(sat)+'T23:59:59Z')"
```

**Protocol:**

1. Calculate current week name (`YYYY/WW`) using the formula above
2. `list_cycles` → find cycle where `name` matches
3. If found → use its `id`
4. If missing → calculate Sunday/Saturday dates → `create_cycle` with:
    - `name`: `"YYYY/WW"`
    - `start_date`: Sunday `YYYY-MM-DDT00:00:00Z`
    - `end_date`: Saturday `YYYY-MM-DDT23:59:59Z`
    - `owned_by`: use `DEFAULT_ITEM_ASSIGNEE_UUID` from `.env` (bootstrap if empty)

**API notes:** Use `owned_by` (not `lead`), `end_date` (not `target_date`). Cycle dates cannot be in the past.

---

## URL Parsing

**Pattern:** `{BASE_URL}/{WORKSPACE_SLUG}/projects/{project_id}/{resource_type}/{resource_id}/`

Split path by `/` → extract `project_id`, resource type (`modules`|`cycles`|`work-items`), resource UUID.

---

## Script vs MCP Decision Table

**Scripts are the default for work item operations.** They bypass MCP token limits, pydantic validation errors, and cascade failures. Use MCP only for operations without a script equivalent.

### Plane Work Items

| Operation | **Use Script** | **MCP fallback** |
|-----------|---------------|-----------------|
| **Read work item** (fields + desc) | `plane-item-get.js` — prints all fields including cycle, module | Never — script is reliable |
| **Update work item** (fields + desc) | `plane-item-update.js` — all PATCH fields + add-to-cycle/module | Never |
| **Create work item** | `plane-item-create.js` — POST with all fields + add-to-cycle/module | Only if script unavailable |
| **Delete work item** | MCP `delete_work_item` | — (rare, no script needed) |
| **Read intake item** | `plane-intake-get.js` — fields + desc, or `--list` for all | Never |
| **List intake items** | `plane-intake-get.js --list` — grouped by status | Never |
| **Update intake item** | `plane-intake-update.js` — desc, priority, state, name, assignees, labels | Never |
| **Create intake item** | MCP `create_intake_work_item` | — (no script yet) |
| **Resolve identifier → UUID** | `plane-item-get.js` — accepts SPARK-N or UUID, prints all fields | MCP `retrieve_work_item_by_identifier` |
| **Sibling context** | `plane-work-items.js` — condensed output to file | Never |
| **Cycle report data** | `plane-cycle-items.js` — condensed output to file | Never |
| **Latest version** | `plane-latest-version.js` — scans all T1s | Never |
| **Description edit** | Pull → Edit → Push (`plane-intake-get.js` / `plane-item-get.js` + `plane-intake-update.js` / `plane-item-update.js --desc`) | Never |
| **Intake tracking** | `plane-intake-handling.js` — checklist management | Never |

### Plane Other (MCP only — no script equivalent)

| Operation | MCP tool |
|-----------|----------|
| Module CRUD | `create_module`, `update_module`, `retrieve_module` |
| Cycle list/create | `list_cycles`, `create_cycle` |
| List work items (filtered) | `list_work_items` |
| Accept/reject intake | `update_intake_work_item` (intake status only) |

### Outline

| Operation | Method | Why |
|-----------|--------|-----|
| **Read only** | MCP `read_document` | Same token cost, simpler (1 call) |
| **Edit existing doc** | Pull → Edit → Push scripts | Edit tool sends diff, not full doc |
| **Create new doc** | MCP `create_document` | No existing doc to diff against |
| **Search docs** | MCP `search_documents` | — |

### MCP Tool Loading (when MCP is needed)

Load tools via `ToolSearch("select:mcp__{PLANE_MCP_SERVER_NAME}__<name>")` or `ToolSearch("select:mcp__outline__<name>")`.

---

## Cycles Directory Convention

All working files (implementation plans, context files, report data) are organized under `cycles/` by cycle → module → tier 1:

```
cycles/
└── YYYY-WW/
    ├── cycle-report-data.md                              ← /rp extraction output
    └── module-name/
        └── {TIER1-ID}/
            ├── context.md                                ← plane-work-items.js output
            ├── {TIER2-ID}-feature-slug.md                ← /p plan file
            └── {TIER2-ID}-another-feature.md             ← /p plan file
```

**Path construction:** `cycles/{YYYY-WW}/{module-slug}/{TIER1-ID}/{TIER2-ID}-{feature-slug}.md`

**`YYYY-WW` source:** Derived from the **tier 1's assigned Plane cycle** (not the current calendar week). Read the tier 1 work item's cycle → get cycle name (`YYYY/WW`) → convert slash to hyphen (`YYYY-WW`). This keeps all work for a tier 1 grouped in the same folder regardless of when tasks are started.

**Module slug sanitization:** Lowercase, replace spaces and colons with hyphens, collapse multiple hyphens:
- `Auth` → `auth`
- `3D Scene: Canvas` → `3d-scene-canvas`
- `Design System` → `design-system`

**Cycle directory name:** Use `YYYY-WW` (hyphen, not slash): `2026-09`, `2026-10`

---

## Identifier Convention

Plan files store **{PROJECT_IDENTIFIER}-N identifiers** (e.g., `SPARK-504`), not UUIDs. Identifiers are compact (~9 chars) and survive context compaction, while UUIDs (36 chars) get truncated.

**Resolution:** Run `node scripts/plane-item-get.js {PROJECT_IDENTIFIER}-504` — the output includes `UUID: <uuid>`. For bulk resolution during `/pp`, `plane-item-create.js` returns the created identifier + UUID directly. **All scripts also accept raw UUIDs** — when you already have a UUID (e.g., from a `parent` field in an API response), pass it directly instead of looking up the identifier first.

**Where identifiers are stored:**
- Plan file header: `Work Item: {PROJECT_IDENTIFIER}-503 (plane_url)`
- Plan file path: `cycles/YYYY-WW/module/{PROJECT_IDENTIFIER}-500/{PROJECT_IDENTIFIER}-503-feature-slug.md`
- Plan file Plane IDs section: `Phase A: {PROJECT_IDENTIFIER}-504` / `Task 1: {PROJECT_IDENTIFIER}-519`

**When UUID is needed:** All scripts accept UUIDs directly alongside `{PROJECT_IDENTIFIER}-N`. For MCP write operations that still require UUIDs, resolve via `plane-item-get.js` first.

---

## Intake Item Properties

### Labels (Type Classification)

Every intake item gets **two labels**: INTAKE (always) + one type label. Labels are project-specific — UUIDs come from `config.json`.

| Label | Color | When to use |
|-------|-------|-------------|
| INTAKE | `#abb8c3` | **Always** — applied to every intake item for cross-project view filtering |
| BUG | `#eb144c` | Something is broken, incorrect behavior, error, regression |
| FEATURE | `#00d084` | New capability, enhancement, new workflow |
| TWEAK | `#0693e3` | Small adjustment, config change, UX improvement, wording fix |
| IDEA | `#f78da7` | Research, investigation, exploration, no concrete deliverable yet |
| INQUIRY | `#fcb900` | Investigation/question — self-contained, no T1/T2 |

**Labels are mandatory on all intake items.** Never leave labels empty.

### Label Bootstrap Protocol

If `LABEL_INTAKE_UUID` (or any type label UUID) is missing from `config.json`:

1. **Check existing labels** — `list_labels` via MCP to see what's already created
2. **Create missing labels** — `create_label` for each missing label with the standard name + color above
3. **Update config** — write the new UUIDs back to the project config file (or project constants markdown for PA consumers)
4. **Proceed** — use the newly created label UUIDs

Plane rejects non-existent label UUIDs with HTTP 400 — labels MUST exist before assignment.

### Priority

| Priority | When to use |
|----------|-------------|
| `urgent` | Blocking operations, data loss, security issue |
| `high` | Significant impact, time-sensitive, executive ask |
| `medium` | Standard request, normal workflow |
| `low` | Nice-to-have, no time pressure |
| `none` | Informational, parking lot |

### Setting Properties on Intake Items

**`create_intake_work_item` does NOT support priority or labels.** After creating the intake item, use `plane-intake-update.js` to set priority, labels, assignees, and state:

```bash
node scripts/plane-intake-update.js {PROJECT_IDENTIFIER}-23 --priority high --labels <uuid> --assignees <uuid>
```

The intake response has two IDs:
- `id` — the intake wrapper ID (do NOT use for updates)
- `issue` (or `issue_detail.id`) — the actual work item UUID (scripts resolve this automatically)

---

## API Quirks

- **Intake endpoints**: Plane v1 REST API uses `/intake-issues/` (NOT `/inbox-issues/`). GET `/work-items/{id}/` returns 404 for pending intake items, but PATCH `/work-items/{id}/` works for both regular and intake items
- **Intake priority/labels**: Use `update_work_item` (not `update_intake_work_item`) to set priority and labels on intake items
- **`update_intake_work_item` MCP**: Uses `data` parameter (not `params`). Description must be nested under `issue` key: `data: {"issue": {"name": "<name>", "description_html": "<html>"}}`. The `name` field is required. Passing `description_html` at the top level is silently ignored
- `update_module` rejects `members` — HTTP 400
- `create_cycle` uses `end_date` (not `target_date`) and `owned_by` (not `lead`)
- Cycle dates cannot be in the past
- Sibling MCP calls cascade-fail — if one parallel call fails, retry individually
- `list_cycle_work_items` typically exceeds token limits and auto-saves to file
- `retrieve_work_item` requires `expand=assignees` — without it, pydantic validation fails (expects dict, gets string)
- `search_work_items` is broken — returns empty results for all queries. Use `retrieve_work_item_by_identifier` or `list_work_items` instead
- `list_work_item_relations` / `create_work_item_relation` — relations API is internal-only (session auth), not exposed via public API or MCP. Use description-based tracking (`plane-intake-handling.js`) instead
- **Cycle/module membership not on work items**: The work item response has no cycle or module fields. `expand=cycle,module` is silently ignored. No reverse endpoint exists (`/work-items/{id}/cycles/` → 404). Use `lib/plane-api.js` utilities for reverse lookups — they use `fields=id` + `per_page=500` for minimal payload. Never fetch cycle/module items with full fields just to check membership
- **`cycle-issues` field filtering**: `?fields=id` returns only `{ id }` per item (~45 bytes vs ~1,475 full). `per_page` accepts at least 1000. Always use `fields=id` for membership checks

---

## Config Script

### `config-get.js` — Get project configuration values

```bash
node scripts/config-get.js                                    # dump all key=value pairs
node scripts/config-get.js PLANE_PROJECT_ID                   # single key → just the value
node scripts/config-get.js PLANE_PROJECT_ID STATE_TODO_UUID   # multiple keys → key=value
node scripts/config-get.js --json                             # full resolved config as JSON
node scripts/config-get.js --workspace lc                     # target specific workspace
```

Uses the shared `lib/config.js` loader — resolves workspace/project from `config.json` and env vars from `.env`. **Always use this script instead of ad-hoc JSON parsing.** Supports `--workspace` and `--project` flags like all other scripts.

---

## Plane Scripts

Pre-fetch and condense Plane data to avoid MCP token limits and cascade failures. **All scripts accept UUIDs, `{PROJECT_IDENTIFIER}-N` identifiers, and bare numbers** — auto-detected via shared `scripts/lib/plane-parse-id.js`.

**Env required:** `PLANE_API_KEY`, `PLANE_BASE_URL`, `PLANE_WORKSPACE_SLUG` in root `.env`

### `lib/plane-api.js` — Shared Plane API utilities

Paginated fetch helpers for cycle/module item listing and reverse lookups. The Plane v1 API does not return cycle or module membership on work items — these utilities handle the lookup efficiently using `fields=id` (45 bytes/item vs 1,475 bytes full) and `per_page=500`.

| Function | Purpose | Used by |
|----------|---------|---------|
| `fetchAllPages(url, headers, opts)` | Generic paginated fetch with `fields` and `perPage` | All below |
| `fetchCycleItems(projBase, headers, cycleId, opts)` | All items in a cycle | `plane-cycle-items.js` |
| `fetchModuleItems(projBase, headers, moduleId, opts)` | All items in a module | (available) |
| `findCycleForItem(projBase, headers, itemUuid)` | Reverse lookup: item → cycle | `plane-item-get.js` |
| `findModulesForItem(projBase, headers, itemUuid)` | Reverse lookup: item → modules | `plane-item-get.js` |

**`opts`:** `{ fields: "id,name,state", perPage: 500 }` — `fields` controls which item fields are returned (default: all); `perPage` controls page size (default: 500).

### `plane-cycle-items.js` — Cycle report data

```bash
node scripts/plane-cycle-items.js              # current cycle
node scripts/plane-cycle-items.js 2026/09      # specific cycle
```

Output: `cycles/YYYY-WW/cycle-report-data.md` — Done tier 1 items grouped by version, their tier 2 children with estimates, points summary. Used by `/rp`.

### `plane-latest-version.js` — Latest app-wide version

```bash
node scripts/plane-latest-version.js            # prints latest version
node scripts/plane-latest-version.js --all       # all versions with state
```

Output: `Latest: vX.Y.Z` + `Active: vX.Y.Z — Module (State)`. Scans all tier 1 work items, parses version from title (`[vX.Y.Z | Module] Title`), sorts by semver. **Agents MUST run this before creating new versions** — never rely on memory or conversation context for the current version number. **Never auto-assume the next version** — present the latest to the user and ask whether to bundle or bump.

### `plane-work-items.js` — Work item context (siblings)

```bash
node scripts/plane-work-items.js {PROJECT_IDENTIFIER}-675 --cycle 2026/09   # with tier 1's cycle
node scripts/plane-work-items.js 675 --cycle 2026/09                         # bare number
node scripts/plane-work-items.js <uuid> --cycle 2026/09                      # by UUID
node scripts/plane-work-items.js 675                                          # fallback: current week
```

Output: `cycles/YYYY-WW/module-slug/{TIER1-ID}/context.md` — tier 1 parent + all sibling tier 2 items with state, estimates, done/total summary. Auto-detects tier 1 vs tier 2 input. Creates the nested directory structure automatically. `--cycle` accepts `YYYY/WW` or `YYYY-WW` and determines the output folder (falls back to current week if omitted). Used by `/pp` (Step 7: auto-complete check) and `/p` (sibling context).

### `plane-item-get.js` — Get work item (all fields + description)

```bash
node scripts/plane-item-get.js {PROJECT_IDENTIFIER}-34   # by identifier
node scripts/plane-item-get.js 34                         # bare number
node scripts/plane-item-get.js <uuid>                     # by UUID
```

Fetches a work item by identifier (workspace endpoint) or UUID (project endpoint). Prints **all fields** to stdout: name, identifier, UUID, state, priority, estimate, parent, assignees, start, due, **cycle** (name + UUID), **modules** (name + UUID), **labels**, browse URL. Saves `description_html` to `temp/plane/{IDENT}-{N}.html` for editing. Returns 404 for pending intake items — use `plane-intake-get.js` instead.

**Cycle/module resolution:** The Plane API does not return cycle or module membership on work items. The script resolves these by iterating all cycles and modules to find which ones contain the item. This adds 2-5 API calls but provides complete context.

### `plane-item-update.js` — Update work item (all fields + cycle/module)

```bash
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --desc                    # push description
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --state todo              # update state (backlog|todo|in-progress|done|passed|announced|approved|deployed|cancelled)
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --priority high           # update priority
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --estimate 3              # update estimate
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --name "New title"        # update name
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --parent {PROJECT_IDENTIFIER}-100  # set parent
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --assignees uuid1,uuid2   # set assignees
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --start 2026-03-01        # set start date
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --due 2026-03-07          # set due date
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --labels uuid1,uuid2      # set labels
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --add-to-cycle <uuid>     # add to cycle
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --add-to-module <uuid>    # add to module
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --desc --state done       # multiple
```

First argument accepts `{PROJECT_IDENTIFIER}-N`, bare number, or UUID. PATCH flags update work item fields directly. `--add-to-cycle` and `--add-to-module` POST to separate endpoints. `--parent` accepts identifiers or UUIDs. At least one flag required. For pending intake items, use `plane-intake-update.js`.

### `plane-item-create.js` — Create work item (all fields + cycle/module)

```bash
node scripts/plane-item-create.js --name "Title" --state done
node scripts/plane-item-create.js --name "Title" --state done --parent {PROJECT_IDENTIFIER}-100 \
  --desc {PROJECT_IDENTIFIER}-200 --priority medium --estimate 3 \
  --assignees uuid1 --start 2026-03-01 --due 2026-03-07 \
  --add-to-cycle <cycle-uuid> --add-to-module <module-uuid>
```

Creates a work item via POST with all fields in one call. `--name` is required; all other flags optional. `--desc <IDENT-N>` reads description from `temp/plane/{IDENT-N}.html`; `--desc-file <path>` reads from arbitrary file. `--parent` accepts identifiers or UUIDs. Returns `Created: {PROJECT_IDENTIFIER}-1234 (uuid)` — use this to capture the identifier and UUID for plan files.

**Key use case:** `/pp` creates many T3/T4 items in sequence. Using this script instead of MCP `create_work_item` avoids cascade failures and pydantic validation errors.

### `plane-intake-get.js` — Get intake item (fields + description)

```bash
node scripts/plane-intake-get.js {PROJECT_IDENTIFIER}-23   # get specific + save desc
node scripts/plane-intake-get.js 23                         # bare number
node scripts/plane-intake-get.js <uuid>                     # by work item UUID
node scripts/plane-intake-get.js --list                     # list all intake items by status
```

Fetches intake items via the project intake-issues endpoint. Shows intake-specific fields (wrapper ID, intake status: Pending/Snoozed/Accepted/Declined). `--list` mode groups all items by status — useful for triage. Saves `description_html` to `temp/plane/{IDENT}-{N}.html`.

### `plane-intake-update.js` — Update intake item (all fields)

```bash
node scripts/plane-intake-update.js {PROJECT_IDENTIFIER}-23 --desc                  # push description
node scripts/plane-intake-update.js {PROJECT_IDENTIFIER}-23 --priority high         # update priority
node scripts/plane-intake-update.js {PROJECT_IDENTIFIER}-23 --state todo            # update state
node scripts/plane-intake-update.js {PROJECT_IDENTIFIER}-23 --name "New title"      # update name
node scripts/plane-intake-update.js {PROJECT_IDENTIFIER}-23 --assignees uuid1,uuid2 # set assignees
node scripts/plane-intake-update.js {PROJECT_IDENTIFIER}-23 --labels uuid1,uuid2    # set labels
node scripts/plane-intake-update.js {PROJECT_IDENTIFIER}-23 --desc --priority medium --state todo # multiple
```

First argument accepts `{PROJECT_IDENTIFIER}-N`, bare number, or UUID. Resolves intake item → work item UUID, then uses `PATCH /work-items/{uuid}/` (works for intake items). `--state` sets the work item state (Backlog, Todo, etc.), NOT the intake status (Pending/Accepted). At least one flag required. For accepted items accessible via work-items endpoint, `plane-item-update.js` also works.

### `plane-intake-handling.js` — Intake tracking checklist

```bash
node scripts/plane-intake-handling.js {ID}-1216 add {ID}-1217 {ID}-1218   # add T1s to tracking
node scripts/plane-intake-handling.js {ID}-1216 tick {ID}-1217             # check off a T1
node scripts/plane-intake-handling.js {ID}-1216 status                     # report completion
```

All identifiers accept `{PROJECT_IDENTIFIER}-N`, bare number, or UUID. Manages the `## Tracking` checklist at the top of an intake item's description. Used by `/pm` ACCEPT (add) and `/pp` Step 7 (tick). Outputs completion status — "All complete" when every T1 checkbox is ticked. Tracking links use the browse URL format (`/browse/{IDENT}-{N}/`).

### Edit workflow (pull → edit → push)

Same pattern as Outline scripts — reliable alternative to MCP for description edits:

```
1. node scripts/plane-item-get.js {PROJECT_IDENTIFIER}-34           → temp/plane/{PROJECT_IDENTIFIER}-34.html
2. Read tool: temp/plane/{PROJECT_IDENTIFIER}-34.html               → content in context
3. Edit tool: old_string → new_string                               → diff only
4. node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-34 --desc → updated on Plane
```

For intake items, use `plane-intake-get.js` / `plane-intake-update.js` instead.

---

## Outline Scripts

Pull Outline documents to local `.md` files, edit with the Edit tool (diff-only), then push back. Saves ~90% output tokens vs MCP `update_document` which requires full document regeneration.

**Env required:** `OUTLINE_API_KEY`, `OUTLINE_API_URL` in root `.env`

### When to use scripts vs MCP

| Operation | Method | Why |
|-----------|--------|-----|
| **Read only** | MCP `read_document` | Same token cost, simpler (1 call) |
| **Edit existing doc** | Pull → Edit → Push | Edit tool sends diff, not full doc |
| **Create new doc** | MCP `create_document` | No existing doc to diff against |

### `outline-pull.js` — Download document

```bash
node scripts/outline-pull.js <doc-id>           # by UUID
node scripts/outline-pull.js <outline-url>      # by URL
node scripts/outline-pull.js bible              # alias → Specifications root
node scripts/outline-pull.js versions           # alias → Versions root
node scripts/outline-pull.js cycles             # alias → Cycles root
```

Output: `temp/outline/<uuid>.md` — pure markdown, ready for Edit tool.

Aliases resolved from `config.json` Outline doc IDs.

### `outline-push.js` — Upload edited document

```bash
node scripts/outline-push.js temp/outline/<uuid>.md
```

Reads the UUID from the filename, pushes file content to Outline.

### `outline-upload.js` — Upload file as attachment

```bash
node scripts/outline-upload.js <file-path> [--doc <doc-uuid>]
```

Uploads a file to Outline via the two-step `attachments.create` API. Returns attachment ID, URL, and markdown embed syntax. For videos, auto-detects dimensions via `ffprobe` and includes `WxH` in the link text (required for Outline's inline video player).

**Markdown output formats:**
- Images: `![filename](/api/attachments.redirect?id=<uuid>)`
- Videos: `[filename WxH](/api/attachments.redirect?id=<uuid>)`

**Attachment URLs are reusable across docs** — the same `/api/attachments.redirect?id=...` link works in any Outline document without re-uploading. This enables `/pp` to upload media to version docs and `/rp` to inline the same links in cycle reports.

**Env required:** `OUTLINE_API_KEY`, `OUTLINE_API_URL` in root `.env`. Also `BIBLE_RECORDINGS_DIR` and `BIBLE_SCREENSHOTS_DIR` for `/pp` media collection (not used by the script directly, but by the agent when finding files).

### Edit workflow

```
1. node scripts/outline-pull.js bible          → temp/outline/<uuid>.md
2. Read tool: temp/outline/<uuid>.md           → content in context
3. Edit tool: old_string → new_string          → diff only (~5 lines output)
4. node scripts/outline-push.js temp/outline/<uuid>.md  → updated on Outline
```

---

## Intake Item Description Format

When intake items go through `/pm` ACCEPT, a `## Tracking` section is prepended at the top of the description. The remaining sections follow the original two-section format from the `/intake` → `/triage` pipeline.

```markdown
## Tracking
- [ ] [vX.Y.Z | Module](plane_t1_url) {PROJECT_IDENTIFIER}-N
- [x] [vX.Y.Z | Module](plane_t1_url) {PROJECT_IDENTIFIER}-N

---

## Intake Context
<!-- Written by /intake (Personal Assistant) -->

**Source:** [email, chat, meeting, direct ask]
**Requested by:** [person name and role]
**Date:** [when request was made]
**Urgency:** [Low / Medium / High / Critical]

### Summary

[2-3 sentence summary]

### Details

[Full context from communications]

### Related Context

[Related projects, decisions, people from PA memory]

---

## Technical Context
<!-- Written by /triage in project codebase -->

**Affected Module(s):** [module names]
**Complexity Estimate:** [N] points — [reasoning]

### Affected Areas

- [file/path] — [why affected]

### Related Modules

- [Module] — [impact]

### Existing Work Items

- [ID] [title] ([state]) — [relationship]

### Technical Notes

[Architecture notes, risks, migration needs]
```

`/pm` ACCEPT reads both sections to make the module/version/tier routing decision.

Items submitted directly in Plane (not through `/intake`) may lack the Intake Context section — `/triage` still adds Technical Context, and `/pm` TRIAGE handles inline processing.

---

## Common Mistakes

- Creating Plane work items during `/p` (only `/pp` creates them)
- Calling MCP during `/s` (all updates are local)
- Creating duplicate cycles — MUST `list_cycles` first and reuse existing
- Missing module/cycle assignment on new work items
- Using `Backlog` instead of `Done` for tier 3+4 items (they're always Done)
- Missing navigation links in work item descriptions or module description
- Forgetting to rewrite BOTH Non-Technical and Technical spec doc sections after `/pp`
- Adding tier 2 under a Done tier 1 (version is sealed — must bump version)
- Using old naming format (`v1.0.0: Module: Feature` or `[Module | v1.0.0]`) instead of `[v1.0.0 | Module] Title`
- Overwriting Intake Context when running `/triage` — always preserve and append below
- Using parent-child relations for intake tracking — intake items use a `## Tracking` checklist, NOT parent binding to T1

- Using projects/work-items/ URL format for human-facing links — use browse URL (`/browse/{IDENT}-{N}/`) instead
- Using MCP `retrieve_work_item` / `update_work_item` / `create_work_item` when scripts exist — always use `plane-item-get.js` / `plane-item-update.js` / `plane-item-create.js` instead. Scripts bypass MCP token limits, pydantic errors, and cascade failures

<!-- Template version: 2.0 — Unified config: config.json replaces project-config.json + pa-config.json. Workspace/project two-level resolution. -->
