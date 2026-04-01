# Product Management Flow

Portable PM framework for AI-assisted development. Integrates **Plane** (task tracking) and **Outline** (documentation) through role-based commands.

> **To apply this flow to a new codebase:** Copy `.claude/skills/po/`, `.claude/commands/project/{pm,p,pp,s,rp}.md`, `scripts/plane-cycle-items.js`, `docs/pm.md`, and set up MCP servers. Update the `po` skill with project-specific constants.

---

## Table of Contents

1. [Roles & Commands](#roles--commands)
2. [Work Item Tier System](#work-item-tier-system)
3. [Outline Document Structure](#outline-document-structure)
4. [Manager Flow](#manager-flow)
5. [Intake & Triage](#intake--triage)
6. [Engineer Flow](#engineer-flow)
7. [Versioning](#versioning)
8. [Plane Conventions](#plane-conventions)
9. [Cycle Management](#cycle-management)
10. [Cycle Reporting](#cycle-reporting)
11. [Story Point Estimation](#story-point-estimation)
12. [Post-Completion Pipeline](#post-completion-pipeline)
13. [Module Naming](#module-naming)
14. [MCP Setup](#mcp-setup)

---

## Roles & Commands

| Role | Command | Purpose |
|------|---------|---------|
| Manager | `/pm` | Vision, module creation, tier 2 breakdown, intake triage, catch-up |
| Engineer | `/p` | Break tier 2 into implementation phases (tier 3+4) locally |
| Engineer | `/s` | Skills-aware task execution |
| Engineer | `/pp` | Push tier 3+4 to Plane, auto-condense spec on Outline, mark tier 2 done |
| PM | `/pi` | Post-intake: task report on Outline, stakeholder announcement |
| Reporter | `/rp` | Generate cycle reports from Plane data + Outline specs, publish to Outline |
| Reference | `po` skill | Plane/Outline constants, MCP tools, naming conventions |

---

## Work Item Tier System

Four tiers with clear ownership boundaries:

```
Tier 1: [vX.Y.Z | Module] Title
  └─ Tier 2: [vX.Y.Z | Module] Title > Feature
       └─ Tier 3: [vX.Y.Z | Module] Title > Feature > Phase X - Name
            └─ Tier 4: [vX.Y.Z | Module] Title > Feature > Phase X > Task
```

| Tier | Created by | Purpose | Estimate | Owner |
|------|-----------|---------|----------|-------|
| 1 | `/pm` base / catch-up / triage | Scope — tracks module version completion | Never | Manager |
| 2 | `/pm` breakdown / triage | Feature behavior & requirements | Fibonacci (agent determines, `/pp` reassesses) | Manager assigns |
| 3 | `/pp` (from temp file) | Implementation phase | Never | Engineer |
| 4 | `/pp` (from temp file) | Implementation task | Never | Engineer |

### Title Format

```
[...]        = metadata block (version + module) — always first
|            = separates version from module name inside brackets
>            = hierarchy separator — chains T1 title through all children
```

**Examples:**

```
Tier 1: [v2.0.0 | Auth] Password reset flow
Tier 2: [v2.0.0 | Auth] Password reset flow > Google OAuth login
Tier 3: [v2.0.0 | Auth] Password reset flow > Google OAuth login > Phase A - Auth layout
Tier 4: [v2.0.0 | Auth] Password reset flow > Google OAuth login > Phase A > Build two-panel grid
```

```
Tier 1: [v3.0.0 | 3D Scene: Timeline] Keyframe system overhaul
Tier 2: [v3.0.0 | 3D Scene: Timeline] Keyframe system overhaul > Curve editor
Tier 3: [v3.0.0 | 3D Scene: Timeline] Keyframe system overhaul > Curve editor > Phase A - Bezier controls
Tier 4: [v3.0.0 | 3D Scene: Timeline] Keyframe system overhaul > Curve editor > Phase A > Build control points
```

### Status Transitions

**Tier 1:**
| State | Trigger |
|-------|---------|
| Backlog | Created by `/pm` base protocol |
| Todo | `/pm` breakdown creates tier 2 items |
| In Progress | Engineer runs `/p` on any child tier 2 |
| Done | `/pp` auto-detects all tier 2 siblings Done → marks tier 1 Done |

**Version sealing rule:** Once a tier 1 is Done, that version-module scope is **sealed permanently**. New work on the same module requires a version bump and a new tier 1. While a tier 1 is still active (not Done), new tier 2 items can be added under it via `/pm` breakdown or triage.

**Tier 2:**
| State | Trigger |
|-------|---------|
| Todo | Created by `/pm` breakdown protocol |
| In Progress | Engineer runs `/p` to plan implementation |
| Done | `/pp` pushes tier 3+4 and marks tier 2 Done |

**Tier 3+4:**
| State | Trigger |
|-------|---------|
| Done | Created as Done by `/pp` (implementation already complete) |

### Priority Rules

| Tier | Allowed Priorities | Set By |
|------|-------------------|--------|
| 1 | Medium (default) | System |
| 2 | Medium, High, or Urgent only (no Low/None) | Manager |
| 3 | Clone from tier 2 parent | System |
| 4 | Clone from tier 2 parent | System |

### Property Cloning

Tier 2 → Tier 3 → Tier 4: The following properties clone from the tier 2 parent:
- `priority` (match or higher)
- `start_date`
- `due_date`
- `cycle`
- `module`
- `assignees`
- `labels`

Only `title`, `description`, and `parent` differ per tier.

---

## Outline Document Structure

Outline is the **single source of truth** for all specifications. No local spec files are maintained — Outline docs replace them entirely.

### Hierarchy

```
[Project Root Doc]              ← Stored in po skill as ROOT_DOC_ID
├── Specifications/             ← Current state of all modules (SPECIFICATIONS_DOC_ID)
│   ├── [Module A]/
│   │   └── [Sub-module]/
│   └── [Module B]/
├── Versions/                   ← Semver snapshots (VERSIONS_DOC_ID)
│   ├── v1.0.0/
│   │   ├── [Module A]/
│   │   └── [Module B]/
│   └── v1.1.0/
│       └── [Module A]/
└── Cycles/                     ← Weekly cycle reports (CYCLES_DOC_ID)
    ├── YYYY/WW/
    └── YYYY/WW/
```

### Module Spec Doc (Specifications/[Module])

Each module spec doc reflects the **current implementation state only**. Keep it concise — agents read these docs and context limits matter. When a version changes behavior, the spec doc is **rewritten** to reflect the new state, not appended to.

**Section 1 — Non-Technical Description** (stakeholder-readable):
- What this module does in plain language (2-4 sentences)
- Current capabilities as bullet points
- No historical context — just what exists today

**Section 2 — Technical Implementation** (engineer-readable):
- File paths and component tree
- Database schema (tables, columns, RLS)
- API endpoints and edge functions
- Key interactions and data flow
- Related modules (Outline links)

**Section 3 — Version History:**
- One-line links to version docs — kept minimal for agent context
- Format: `- [vX.Y.Z](outline_link) — one-line summary`

### Version Module Doc (Versions/[vX.Y.Z]/[Module])

The version module doc serves two roles across its lifecycle:

**At creation (`/pm`)** — Context carrier for breakdown and planning:
- Navigation links (back to spec doc + Plane module)
- Context & Rationale — why this version exists, what triggered it, discovery context
- Scope — what's in/out, decisions made during QA rounds
- Figma References — design links with node IDs (if applicable)
- Affected Files — current files that will be touched, with specific anti-patterns or gaps identified
- Design Decisions — outcomes from QA rounds, naming choices, convention decisions

**After implementation (`/pp`)** — Snapshot of what was delivered:
- Summary (3-5 bullets of what was implemented)
- Requirements (from tier 2 items)
- Implementation details (phases and tasks with SPARK-N work item links)
- New/changed files

**The `/pm` context sections persist** — `/pp` appends implementation details below them, it does not replace them. This ensures the full rationale chain is preserved: why → what → how.

### Traceability

| From | To | How |
|------|----|-----|
| Spec doc → Version docs | Version History section links forward | `- [v1.0.0: Summary](link)` |
| Version doc → Spec doc | Header links back | `> Spec: [Outline]({spec_url})` |
| Version doc → Plane | SPARK-N work item links in body | `[SPARK-42]({work_item_url})` |
| Plane module → Outline | Module description links to spec | `Spec: [Outline]({spec_url})` |
| Plane work item → Outline | Work item description links to version doc | `Version: [Outline]({version_url})` |

### Specifications Root Doc (Product Bible)

The Specifications root doc is the **Product Bible** — the single document any agent or stakeholder reads first to understand the entire product. It is NOT a stub or index page — it contains substantive content.

**Section 1 — Product Vision:**
- What the product is and who it's for (1 paragraph)
- The problem it solves and the value it delivers
- Current state summary (what's built vs. what's planned)

**Section 2 — Architecture Overview:**
- Technology stack (frontend, backend, infrastructure, hosting)
- Key infrastructure decisions and services
- Authentication and authorization model

**Section 3 — Module Map:**
- Every module grouped by domain (e.g., Core, Content Creation, 3D Scene, Infrastructure)
- Each module: 1-line description + link to spec doc
- Cross-module dependencies (which modules feed into which)

**Section 4 — User Journeys:**
- Key workflows through the app (e.g., login → org → production → scene → export)
- How modules connect in practice from the user's perspective

**Update triggers:**

| Trigger | Bible Action |
|---------|-------------|
| `/pm` base (new version) | Rewrite — full product context from Discovery phase |
| `/pm` catch-up | Initial write — from codebase exploration |
| `/pp` when tier 1 completes (version sealed) | Review & update — only changed sections |
| `/pm` triage (new version bump) | Review — if new module or major scope change |

---

## Manager Flow

### Overview

```
BASE        ─── /pm ──────────────────► Outline specs + Plane modules + tier 1 seeds + Bible
CATCH-UP    ─── /pm ─────────────────► Retroactive foundation for existing project (all Done)
BREAKDOWN   ─── /pm [tier 1 link] ────► Tier 2 work items with estimates
TRIAGE      ─── /pm ────────────────► Intake items → versioned tier 1 + tier 2
```

### Mode Detection

The agent infers the protocol from prompt content — users do not need to say keywords like "catch-up" or "triage":

| Signal in prompt | Protocol |
|-----------------|----------|
| Link to a Plane work item (tier 1, no parent) | BREAKDOWN |
| Mentions intake items, client requests, change requests, or ad-hoc feature ideas needing triage | TRIAGE |
| Existing codebase with no PM foundation (no Plane modules, no Outline specs, no tier system) | CATCH-UP |
| New project idea, version description, feature planning, product vision | BASE |

When ambiguous, the agent asks the user to clarify which protocol applies.

### Protocol: Base (New Project or New Version)

**Trigger:** `/pm` with project idea or version description

**Phase 1 — Discovery:**
1. Discuss idea with user, rounds of refinement
2. Agent expands and asks relevant questions for full picture
3. Present high-level, ordered feature set grouped by modules (ordered by implementation dependency)

**Phase 2 — Context Gathering:**
Agent must ask for missing context:
- Plane Project ID (or create new project)
- Outline Root Doc ID (the project node inside the collection)
- Module deadlines (start date is always today, end date is deadline). Modules can be grouped in different deadline phases
- Lead user for each module (suggest from known members)
- Version: updating latest app-wide version OR creating a new one? If new: patch, minor, or major bump from the latest app-wide version (versions are app-wide — see [Versioning](#versioning))
- **Important:** Check for unfinished module work items and ongoing work. User must confirm whether to create new version work items while leaving older version items active, or mark them as cancelled

**Phase 3 — Confirm with user before proceeding.**

**Phase 4 — Execute (if confirmed):**

1. **Update `docs/index.md`** — Store Plane Project ID + link and Outline Root Doc ID + link (thin pointer, not specs)

2. **Create Plane modules** — One per feature area, with:
   - `name`: Module naming convention (trailing colon)
   - `start_date`: today
   - `target_date`: deadline
   - `lead`: assigned lead user UUID
   - `status`: `planned`
   - `description`: `Spec: [Outline]({spec_doc_url})` (added after Outline doc is created)

3. **Create Outline documentation:**
   - **Module spec docs** under `Specifications/` — one per module, using the [Module Spec Doc format](#module-spec-doc-specificationsmodule)
   - **Version parent doc** under `Versions/` — e.g., `Versions/v1.0.0/`
   - **Version module docs** under `Versions/[vX.Y.Z]/` — one per module, with **full context from the `/pm` session**: rationale, scope decisions, Figma links, affected files, QA outcomes. See [Version Module Doc format](#version-module-doc-versionsvxyzmodule) — the `/pm` sections must be populated at creation, not left as stubs

4. **Write/update Product Bible (Specifications root doc):**
   - Rewrite the Specifications root doc using the [Product Bible format](#specifications-root-doc-product-bible)
   - The Phase 1 Discovery content **must flow into this document** — product vision, architecture, module relationships, user journeys
   - This is NOT a stub — the richest context from the `/pm` session belongs here
   - If modules already exist from a previous version, update the Module Map and User Journeys to reflect the new scope

5. **Cross-link Plane ↔ Outline:**
   - Update Plane module descriptions with Outline spec doc link
   - Update Outline spec docs with Plane module link

6. **Create Plane tier 1 seed work items** — One per module:
   - `title`: `[version | Module] Title` (e.g., `[v2.0.0 | Auth] Password reset flow`)
   - `description`: `Version: [Outline]({version_module_doc_url})`
   - `state`: Backlog
   - `priority`: Medium
   - `assignees`: Module lead user
   - `estimate`: none (tier 1 never has estimates)
   - `start_date`: today
   - `due_date`: module deadline
   - `cycle`: current cycle
   - `module`: associated module
   - `parent`: none

### Protocol: Breakdown (Tier 1 → Tier 2)

**Trigger:** `/pm [link to tier 1 work item]`

**Preconditions:**
- Verify work item is tier 1 (no parent)
- Read attached Outline version module doc link from description

**Process:**
1. Review the module spec from Outline (read both non-technical and technical sections)
2. Break down into feature-level work items (behavior + expectations, NOT implementation steps)
3. Assign Fibonacci estimates (see [Story Point Estimation](#story-point-estimation))
   - If estimate would be 13 → break into multiple tier 2 items
   - Maximum allowed estimate is 8
4. Present breakdown to user with estimates and rationale
5. Confirm with user

**On confirmation, create tier 2 work items:**
- `title`: `[version | Module] T1 Title > Feature` (e.g., `[v2.0.0 | Auth] Password reset flow > Google OAuth login`)
- `description`: `Version: [Outline]({version_module_doc_url})\n\nRequirements: [pass/fail criteria for this feature]`
- `state`: Todo
- `priority`: Manager dictates (Medium, High, or Urgent only)
- `assignees`: Manager assigns engineer
- Other properties cloned from tier 1 parent

**Post-creation:**
- Update tier 1 status: Backlog → Todo
- Update tier 1 cycle to current week (create cycle if needed)

**Execution order:**

After all T2 items are created, determine and record the recommended execution order on the T1 description:

1. Analyze dependencies between the T2 items — which are foundational, which can be parallelized, which require others to complete first
2. Fetch the T1 description: `plane-item-get.js` (saves to `temp/plane/`)
3. Edit the temp HTML file — add or replace an `## Execution Order` section at the end with the recommended sequence
4. Push back: `plane-item-update.js --desc`

Format rules:
- Numbered steps = sequential dependency (step 2 requires all step 1 items Done)
- `+` within a step = items that can be done in parallel
- Parenthetical annotations explain the reason: `(foundation)`, `(parallel)`, `(depends on N)`, `(cleanup)`, etc.
- Identifier-only format: `{PROJECT_IDENTIFIER}-{N}`, no titles
- Idempotent: if BREAKDOWN is re-run, the section is replaced via HTML section find/replace

Example:
```html
<h2>Execution Order</h2>
<ol>
<li>SPARK-2276 (foundation)</li>
<li>SPARK-2277 + SPARK-2278 (parallel)</li>
<li>SPARK-2279 (cleanup — removes shim)</li>
<li>SPARK-2280 + SPARK-2281 (parallel — new features)</li>
</ol>
```

The `/p` command reads this section when planning a T2 — it checks whether earlier-step prerequisites are Done and blocks/warns the engineer if not. It also reads completed earlier-step T2 plan files to understand what foundations are available.

### Protocol: Catch-Up (Existing Project Baseline)

**Trigger:** `/pm catch-up` — retroactively create the PM foundation for an already-built project

**When to use:** The project has working code but no Plane modules, no Outline specs, no tier system. This protocol creates the baseline so future work can follow the normal flow.

**Phase 1 — Discovery:**
1. Agent explores the codebase — routes, components, database schema, edge functions
2. Identify logical modules from the existing feature areas
3. Present proposed module breakdown to user for confirmation

**Phase 2 — Context Gathering:**
Same as Base protocol — Plane Project ID, Outline Root Doc ID, version number (the app-wide version at the time the project was first built — typically `v1.0.0` if no PM system existed before), lead user

**Phase 3 — Confirm with user before proceeding.**

**Phase 4 — Execute (if confirmed):**

Same artifacts as Base protocol, but with key differences:
1. **Create Plane modules** — status: `completed` (already built)
2. **Create Outline spec docs** — written from existing code, reflecting current state
3. **Create version docs** — summary of what exists (no SPARK-N links — retroactive)
4. **Write Product Bible (Specifications root doc)** — using the codebase exploration from Phase 1, write the full product overview following the [Product Bible format](#specifications-root-doc-product-bible). This is the baseline Bible — future `/pm` and `/pp` runs maintain it
5. **Create tier 1 seed work items** — state: **Done** (already built)
6. **Cross-link everything** — same as Base protocol

**No tier 2/3/4 items are created** — this is a baseline snapshot, not a history reconstruction. Future work starts from here with normal BREAKDOWN → `/p` → `/s` → `/pp` flow.

---

## Intake & Triage

### Overview

Plane's intake feature is the entry point for client requests, change requests, and ad-hoc feature ideas. Intake items are unversioned and unstructured — the manager triages them into the tier system. The **INTAKE label** enables cross-project visibility via Plane custom views.

### Intake Flow

```
Client request → Plane Intake (manual entry or /intake from PA)
                      ↓
/triage (optional) → adds Technical Context to item description
                      ↓
    ┌──────────────────────────────────────────────────────┐
    │ /pm ACCEPT (pre-triaged) or /pm TRIAGE (raw intake): │
    │                                                       │
    │ 1. Which module(s) does this touch?                   │
    │    (one intake may span multiple modules)             │
    │ 2. For each module: active tier 1?                    │
    │                                                       │
    │    YES → link intake to existing tier 1                 │
    │    NO  → ask user: bundle with current or bump?        │
    │          → new tier 1 + version doc                    │
    │                                                       │
    │ 3. Add T1(s) to intake Tracking checklist             │
    │    (plane-intake-handling.js add)                      │
    │ 4. Accept intake item from queue                      │
    └──────────────────────────────────────────────────────┘
                      ↓
/pp on T1 seal → tick checkbox (plane-intake-handling.js tick)
                      ↓
All T1s checked → intake item → Done
```

### Intake Tracking

Intake items use a **description-based tracking checklist** (not parent-child relations) to link to T1 work items. The `## Tracking` section sits at the top of the intake description:

```markdown
## Tracking
- [ ] [v3.7.0 | Production: Script](plane_url) SPARK-1217
- [x] [v3.7.0 | Scripts](plane_url) SPARK-1218
```

**Why not parent-child?** One intake can span multiple modules/T1s. Parent-child is 1:1. The tracking checklist is N:1 and gives stakeholders immediate visual status.

**Why not Plane relations API?** The blocking/blocked_by API is internal-only (session auth) — not exposed via the public API or MCP.

### Protocol: Triage

**Trigger:** `/pm triage` or `/pm triage [intake item link]`

**Process:**

1. **List pending intake items** — `list_intake_work_items` via MCP
2. **Present summary** to user — title, description, requester for each
3. **For each item (or batch)**, determine:
   - **Module scope** — which module(s) does this affect?
   - **Active tier 1?** — check if the module has a tier 1 that is not Done
   - **Version decision:**
     - If active tier 1 exists → propose linking intake to it (no version bump)
     - If no active tier 1 → **run `node scripts/plane-latest-version.js`**, present the latest version, and ask user: bundle with current version or bump? Never auto-assume the next version number
4. **Confirm** version decision and tier 2 breakdown with user
5. **Execute:**
   - If new version needed: create tier 1 seed (same as Base protocol step 6), create/update version doc on Outline
   - Create tier 2 work items under the appropriate tier 1 (same as Breakdown protocol)
   - If module spec doc needs updating for new capabilities → update Non-Technical and Technical sections to reflect planned state
   - **Track intake → T1 linkage** — run `plane-intake-handling.js add` to add T1(s) to the intake tracking checklist
   - **Accept intake item** — `update_intake_work_item` to mark as accepted, or `delete_intake_work_item` to remove from queue
   - If a new module was created or the scope change is significant → review and update the Product Bible (Specifications root doc)
6. **Report** — list created work items with version and module

### Batching

Manager should review ALL pending intake before triaging. Related requests for the same module should be **batched into one version bump** rather than creating individual version bumps per request. This keeps version history clean.

### MCP Tools for Intake

| Tool | Purpose |
|------|---------|
| `list_intake_work_items` | List all pending intake items |
| `retrieve_intake_work_item` | Read a specific intake item |
| `update_intake_work_item` | Accept/update an intake item |
| `delete_intake_work_item` | Remove from intake queue |

---

## Engineer Flow

### Overview

```
Step 1: PLAN    ─── /p [tier 2 link] ──► cycles/[cycle]/[module]/[tier1]/[tier2]-slug.md (plan file)
Step 2: EXECUTE ─── /s [task] ─────────► Implementation + plan file checkbox updates
Step 3: PUSH    ─── /pp ───────────────► Tier 3+4 on Plane + auto-condense spec on Outline
```

This loop repeats for each tier 2 work item assigned to the engineer.

### Command: `/p` (Plan)

**Trigger:** `/p [link to tier 2 work item]`

**Preconditions:**
- Verify work item is tier 2 (has parent, parent is tier 1)
- Read Outline version doc link from tier 2 description

**Process:**
1. Read tier 2 item from Plane (get requirements, version doc link)
2. Read tier 1 parent from Plane — get the overall module-version scope and state
3. Get sibling context — run `plane-work-items.js` to see all tier 2 items under the same tier 1 (their boundaries, state, estimates). This prevents overlap and guessing
4. **Resolve local state** — Plane status alone is unreliable for siblings worked in parallel (a T2 may be fully implemented locally but not yet pushed via `/pp`). Scan the `cycles/` directory for sibling plan files and determine **effective state** by combining Plane status + local plan file progress (all tasks `[x]` = Done locally pending /pp). Use effective state for the Siblings line and execution order checks
5. **Check execution order** — read the T1 description for an `## Execution Order` section. If present: identify which step this T2 is in, check if earlier-step T2s are all effectively Done (including "Done locally, pending /pp"). Read completed earlier-step T2 plan files to understand available foundations. If prerequisites are not effectively Done → warn/block the engineer (user can override)
6. Read version module doc from Outline — this is the primary context carrier with rationale, scope, Figma refs, affected files, and QA decisions from `/pm`
7. Read module spec from Outline (both non-technical and technical sections)
8. Read related module specs if referenced in the technical section
9. Assess feasibility — if not doable or needs discussion, surface to user
10. Break tier 2 into implementation phases (tier 3) and tasks within each phase (tier 4)
11. Create **plan file** at `cycles/[YYYY-WW]/[module-slug]/[TIER1-ID]/[TIER2-ID]-[feature-slug].md`
12. **User must confirm** before plan file creation

**Plan file format:**
```markdown
# [Tier 2 Title]

Work Item: [SPARK-N] ([plane_link])
Tier 1: [SPARK-N] [version | Module] Title ([state])
Module: [Module Name] ([plane_module_link])
Outline Spec: [outline_spec_link]
Version Doc: [outline_version_link]

## Context (from spec)
Non-tech: [1-2 sentence stakeholder description]
Tech: [key files, components, tables involved]
Related: [Module Name] ([outline_link]) - [why related]
Siblings: [N] total, [N] Done — [SPARK-X Feature (effective state), SPARK-Y Feature (effective state), ...]
Execution Order: Step [N] of [M] — [prerequisite status, using effective state]

## Phase A: [Phase Name]
- [ ] Task 1 description
- [ ] Task 2 description

## Phase B: [Phase Name]
- [ ] Task 1 description
- [ ] Task 2 description

---
## Plane IDs (populated by /pp)
Phase A: (pending)
  - Task 1: (pending)
  - Task 2: (pending)
Phase B: (pending)
  - Task 1: (pending)
  - Task 2: (pending)
```

**Status updates:**
- Tier 2: Todo → In Progress
- Tier 1: If still at Backlog/Todo → In Progress (traced via tier 2 parent ID)

### Command: `/s` (Execute)

**Trigger:** `/s [task description]` or `/s [temp file path] [phase] [task]`

**Process:**
1. Build skills map from `.claude/skills/*/SKILL.md`
2. Initial skill selection based on task
3. Research codebase if needed
4. Re-evaluate skills after research (mandatory)
5. Load all relevant skills (once each)
6. Validate against patterns (stop on conflicts)
7. Execute implementation
8. Update temp file: mark completed tasks `[x]`
9. Report applied skills

**Critical rules:**
- Never skip steps 1–5 — even if you think you know the patterns
- No MCP calls during `/s` — reads temp file only
- Do not load `po` skill (saves context tokens)
- Update temp file checkboxes after implementing

### Command: `/pp` (Push + Condense)

**Trigger:** `/pp [temp file path]`

**Preconditions:**
- All phases/tasks in temp file should be marked `[x]` (implementation complete)
- Verify against tier 2 requirements (pass/fail criteria from description)

**Process:**

1. **Read temp file** for phases, tasks, and context
2. **Deep research** — Read every file listed in the temp file's Tech context. Verify implementation matches phases/tasks. If discrepancies found, reconcile (code wins for minor differences; ask user for major contradictions)
3. **Create tier 3 work items** (phases) on Plane — state: **Done**
4. **Write SPARK-N to temp file immediately** after each tier 3 creation (before creating its tier 4 children) — ensures recoverability if session is interrupted
5. **Create tier 4 work items** (tasks) on Plane — state: **Done**, parent: tier 3. Write each tier 4 SPARK-N to temp file immediately after creation
6. All properties **cloned from tier 2 parent** (priority, dates, cycle, module, assignees)
7. **Reassess estimate** — compare actual work (phases, tasks, files, concerns) against tier 2 estimate using the same Fibonacci scale and estimation rules as `/pm`. Always present comparison to user. If user approves update: store `Original Estimate: N points` in tier 2 description, update `estimate_point` to new value. See [Estimate Reassessment](#estimate-reassessment-pp).
8. **Mark tier 2 work item as Done** on Plane
9. **Update tier 2 cycle** to current week

10. **Auto-condense spec doc on Outline:**
   - Read current spec doc from Outline
   - **Rewrite Non-Technical Description** to reflect current behavior (not append — replace with current state)
   - **Rewrite Technical Implementation** to reflect current files, components, schema (not append — replace with current state)
   - **Append** one-line version link to Version History section: `- [vX.Y.Z](link) — summary`
   - Keep both sections concise — agents read these and context limits matter

11. **Create/update version doc on Outline:**
    - At `Versions/[vX.Y.Z]/[Module]` — preserve `/pm` context sections, append implementation details below
    - Add summary + implementation details + SPARK-N work item links
    - Include navigation links back to spec doc and Plane module

12. **Auto-complete tier 1 if all siblings done:**
    - Run `plane-work-items.js` to get sibling status (see `po` skill → Plane Scripts), or check via MCP
    - If all tier 2 items under the same tier 1 are Done: mark tier 1 as Done, update Plane module status to `completed`

13. **Bible review (on version seal only):**
    - **Only triggered when step 12 marks a tier 1 as Done** (version sealed)
    - Read the Specifications root doc (Product Bible)
    - Review whether the completed version introduced: new modules, changed user journeys, altered cross-module relationships, or shifted the product scope
    - If any changes apply: update only the affected sections of the Bible (Module Map, User Journeys, Architecture Overview, or Product Vision)
    - This is a **targeted review**, not a full rewrite — only update what the sealed version changed

**Output:**
```
Published
Work Items: [X] tier 3 + [Y] tier 4 created (Done)
Tier 2: [SPARK-N] marked Done | Estimate: [kept N / updated N→N]
Spec updated: [module name] — [files added/changed count]
Version doc: [created/updated] at Versions/[vX.Y.Z]/[Module]
Tier 1: [Done / still in progress — N of M tier 2 complete]
Bible: [updated — sections changed / no update needed / tier 1 still in progress]
```

---

## Versioning

### Semver Convention

**Versions are app-wide, not per-module.** The entire application shares a single version timeline (`v1.0.0` → `v2.0.0` → `v3.0.0` → `v3.0.1`). A module does NOT have its own independent version — it participates in whatever app version is current. A new module introduced during v3.0.0 development gets `v3.0.0` (or a bump like `v3.0.1`), never its own `v1.0.0`.

Format: `vMAJOR.MINOR.PATCH` (e.g., `v1.0.0`, `v1.1.0`, `v2.0.0`)

| Bump | When |
|------|------|
| Patch | Bug fixes, minor adjustments within existing features |
| Minor | New features added, non-breaking changes |
| Major | Breaking changes, significant redesign, new product direction |

**Determining the next version:** Always run `plane-latest-version.js` to get the latest app-wide version. **Present it to the user and ask:** bundle with current version, or bump? If bumping, confirm semver level. Never auto-assume the next version — the user decides. If the latest version is `v3.0.0`, the next patch is `v3.0.1`, the next minor is `v3.1.0`, etc.

### Version Lifecycle

```
/pm base      → declare version scope → modules + tier 1 seeds + spec docs + version docs
/pm breakdown → create tier 2 features with estimates
/p → /s → /pp   loop per tier 2
All tier 2 done → /pp auto-marks tier 1 Done → version sealed
```

### Version Sealing

**A completed version is sealed permanently.** Once a tier 1 reaches Done, no new tier 2 items can be added under it. Any new work on that module — whether a bug fix, feature addition, or behavior change — requires a version bump and a new tier 1.

| Tier 1 State | Can add tier 2? | How |
|---|---|---|
| Backlog / Todo / In Progress | Yes | `/pm` breakdown or triage |
| Done | No — version is sealed | Must create new version (bump) with new tier 1 |

This ensures every version is a clean, traceable snapshot. The spec doc always reflects the latest state, and version docs capture what each version changed.

### Outline Version Docs

Only modules that change in a version get a sub-doc under `Versions/[vX.Y.Z]/`:

```
Versions/
├── v1.0.0/
│   ├── Navigation/      (changed in v1.0.0)
│   ├── Components/      (changed in v1.0.0)
│   └── Infrastructure/  (changed in v1.0.0)
├── v1.1.0/
│   └── Navigation/      (only Nav changed in v1.1.0)
└── v2.0.0/
    ├── Navigation/       (redesigned in v2.0.0)
    └── Spark Shot/       (new module in v2.0.0)
```

---

## Plane Conventions

### Module Properties

| Property | Value |
|----------|-------|
| Name | Clean, human-readable (e.g., `3D Scene: Canvas`). No trailing colon. |
| Status | `planned` → `in-progress` → `completed` |
| Start Date | Today (on creation) |
| Target Date | Deadline |
| Lead | Assigned user UUID |
| Description | `Spec: [Outline]({spec_doc_url})` |

### Work Item States

| State | Group | UUID |
|-------|-------|------|
| Backlog | Backlog | *(project-specific — set in po skill)* |
| Todo | Unstarted | *(project-specific)* |
| In Progress | Started | *(project-specific)* |
| Done | Completed | *(project-specific)* |
| Passed | Completed | *(project-specific)* |
| Announced | Completed | *(project-specific)* |
| Approved | Completed | *(project-specific)* |
| Deployed | Completed | *(project-specific)* |
| Cancelled | Cancelled | *(project-specific)* |

### SPARK-N Identifier Convention

All local storage (temp files, conversation output) uses **SPARK-N identifiers** (e.g., `SPARK-504`), not UUIDs. SPARK-N identifiers are compact (~9 chars) and survive context compaction intact, while UUIDs (36 chars) get truncated.

**Resolution:** Use `retrieve_work_item_by_identifier(project_identifier, issue_identifier)` to resolve SPARK-N → full UUID on demand. The `project_identifier` is the project prefix string (e.g., `"SPARK"`), and `issue_identifier` is the integer (e.g., `504`). Always pass `expand=assignees` to avoid pydantic validation errors.

**Where SPARK-N is stored locally:**
- Plan file header: `Work Item: SPARK-503 (plane_url)`
- Plan file path: `cycles/[YYYY-WW]/[module-slug]/[TIER1-ID]/SPARK-503-feature-slug.md`
- Plan file Plane IDs section: `Phase A: SPARK-504` / `Task 1: SPARK-519`
- Command output: `Tier 2: SPARK-503 → In Progress`

**When UUID is needed:** All Plane write operations require UUIDs. Resolve from SPARK-N or extract from URLs before calling MCP tools.

### URL Construction

```
Plane module:    {BASE_URL}/{WORKSPACE_SLUG}/projects/{PROJECT_ID}/modules/{module_id}/
Plane work item: {BASE_URL}/{WORKSPACE_SLUG}/projects/{PROJECT_ID}/work-items/{work_item_id}/
Outline doc:     {OUTLINE_BASE_URL}/doc/{doc_id}
```

### Navigation Links

**Plane module description:**
```markdown
Spec: [Outline]({spec_doc_url})
```

**Plane work item description (tier 1):**
```markdown
Version: [Outline]({version_module_doc_url})
```

**Plane work item description (tier 2):**
```markdown
Version: [Outline]({version_module_doc_url})

Requirements: [pass/fail criteria]
```

**Outline spec docs:**
```markdown
> Module: [Plane]({module_url})
```

**Outline version docs:**
```markdown
> Spec: [Outline]({spec_url}) | Module: [Plane]({module_url})
```

---

## Cycle Management

### Naming Convention

Format: `YYYY/WW` (week number, zero-padded)

Example: `2026/07` = Week 7 of 2026

### Current Week Calculation

Cross-platform (Node.js):
```bash
node -e "const d=new Date(),y=d.getFullYear(),j=new Date(y,0,1),w=Math.ceil(((d-j)/864e5+j.getDay()+1)/7);console.log(y+'/'+String(w).padStart(2,'0'))"
```

### Cycle Rules

1. **On creation:** Assign work items to current week's cycle (create cycle if not exists)
2. **On status change to Done:** Update work item's cycle to current week (create if needed)
3. **Company cadence:** One-week cycles
4. **Planning ahead:** After creation, users can manually reassign work items to future cycles
5. **Cycle range:** Sunday 00:00:00 → Saturday 23:59:59 (matches Plane's UTC+0 Dublin setting)

### Cycle Creation Protocol

1. Calculate current `YYYY/WW`
2. `list_cycles` → check if cycle with matching name exists
3. If found → reuse cycle ID
4. If not found → `create_cycle` with name `YYYY/WW`, appropriate date range, `owned_by` (not `lead`)

---

## Cycle Reporting

### Overview

The `/rp` command generates cycle reports from completed work and publishes them to Outline. Reports are **done-only** — no in-progress or backlog items. Story points from tier 2 estimates provide velocity metrics.

```
/rp                    → report current cycle
/rp [YYYY/WW]         → report specific cycle (e.g., 2026/09)
```

### Data Pipeline

```
Step 1: EXTRACT  ─── scripts/plane-cycle-items.js ──► cycles/YYYY-WW/cycle-report-data.md
Step 2: ENRICH   ─── Read Outline spec docs ────────► Non-Technical + Technical content
Step 3: GENERATE ─── Assemble report markdown ──────► Structured cycle report
Step 4: PUBLISH  ─── Create/update Outline doc ─────► Cycles/YYYY-WW
```

### Extraction Script

`scripts/plane-cycle-items.js` reads `.env` for Plane API credentials and fetches cycle data directly via REST API, bypassing MCP token limits:

1. Finds the target cycle by name (`YYYY/WW`)
2. Fetches all cycle work items in one API call
3. Filters to **Done state only**
4. Identifies tier 1 (no parent) and tier 2 (parent is Done tier 1)
5. Maps `estimate_point` UUIDs to Fibonacci values (1, 2, 3, 5, 8, 13)
6. Outputs structured markdown with points summary, module breakdown, and Outline links

### Report Structure

The cycle report has five sections:

1. **Header** — Period, versions, total points/modules/features
2. **Executive Summary** — 3-5 sentence overview (past tense, includes points)
3. **Points Summary** — Table of modules × features × points (sorted by points descending)
4. **What Was Delivered** — Per module: Non-Technical Description from spec doc + features with points. Major modules get full sections; baselines and renames are grouped
5. **Technical Changes** — Per module: Technical Implementation from spec doc (routes, components, hooks, DB, edge functions)
6. **Cycle Statistics** — Summary metrics table

### Outline Structure

Reports publish under `Cycles/` in the Outline hierarchy:

```
[CYCLES_DOC_ID] Cycles/         ← Parent doc with summary table
├── 2026/09/                     ← Individual cycle report
├── 2026/10/
└── ...
```

The Cycles parent doc maintains a summary table:

```markdown
| Cycle | Period | Versions | Points | Modules | Features | Report |
|-------|--------|----------|--------|---------|----------|--------|
| YYYY/WW | Mon DD – Mon DD | vX.Y.Z | N | N | N | [View](link) |
```

### Grouping Rules

- **Major modules** (3+ features): full description + features + technical section
- **Minor modules** (1-2 non-trivial features): condensed individual section
- **Namespace/rename modules**: grouped under one heading
- **Baseline modules** (catch-up, 0 features): single grouped paragraph

### Points Tracking

Only **tier 2** items carry story point estimates (Fibonacci scale). The report aggregates:
- Total points per cycle
- Points by version
- Points by module (sorted highest first)
- Points per individual feature

This enables velocity tracking across cycles.

---

## Story Point Estimation

Fibonacci scale: **1, 2, 3, 5, 8, 13**

Only assigned to **tier 2** work items. Agent determines during `/pm` breakdown; `/pp` reassesses after implementation.

### Stack Context

Remove or customize this section per project. Example for TypeScript full-stack:

> TypeScript full-stack: React 19 + TanStack Router (frontend), Supabase (backend: Postgres, RLS, Edge Functions, Auth, Realtime). Engineers use AI-assisted coding (Claude Code). Points reflect **total human effort: planning + review + debugging**, not lines of code.

### Point Scale

| Points | Complexity | What it touches |
|--------|-----------|-----------------|
| 1 | Single concern | One file, one table, or one component. No new patterns. |
| 2 | Two connected concerns | A backend change + a frontend change consuming it, or a new route with a simple page reading existing data. |
| 3 | One end-to-end slice | A new feature through one vertical: e.g. new table + RLS + edge function + new component, or a new form writing to a new table. |
| 5 | Multiple coordinated slices | New DB schema + RLS + edge functions + new route + multiple components with state management + error handling. |
| 8 | Cross-cutting or high-uncertainty | Changes spanning auth, middleware, multiple routes, and policies. New architectural patterns (e.g. realtime subscriptions with optimistic UI). High debug risk. |
| 13 | Too large | Multiple 5-point tasks hiding inside. **Must decompose before estimating.** |

### Estimation Rules

1. Count the **distinct concerns** the task touches (DB schema, RLS policies, edge functions, routes, components, state management, third-party integrations)
2. Assess **debug risk**: auth, RLS, race conditions, and realtime patterns increase risk by +1-2 points over what code volume alone suggests
3. Assess **novelty**: if the task introduces a pattern the codebase doesn't already have, bump +1 point
4. If the estimate lands at 13, recommend how to split it into smaller tasks
5. Output estimate as: `**Estimate: X points**` followed by a brief rationale listing the concerns and any risk/novelty factors

### Estimate Reassessment (`/pp`)

The `/pm` estimate is a prediction based on high-level understanding. By `/pp` time, the engineer has completed planning (`/p`) and implementation (`/s`), revealing the true complexity. `/pp` **always** reassesses using the same Point Scale and Estimation Rules above.

**Process:**

1. `/pp` counts the actual phases, tasks, files changed, and concerns touched
2. Applies the same Fibonacci scale and estimation rules that `/pm` uses
3. Presents comparison to the user:
   ```
   Estimate check: SPARK-675 estimated 3 points
   Actual: 2 phases, 14 tasks, 5 files, 3 concerns → suggests 5 points
   Update estimate? [keep 3 / update to 5]
   ```
4. **User decides** — the engineer does not silently override the original estimate

**If user approves the update:**

1. Store the original estimate in the tier 2 description: `Original Estimate: 3 points`
2. Update the `estimate_point` field on Plane to the new value
3. The `estimate_point` field now reflects the **final** (actual) points

**If user keeps the original:** No changes — `estimate_point` stays as-is, no `Original Estimate` line added.

**Why both values matter:**
- **Final points** (`estimate_point`) → accurate velocity in cycle reports
- **Original points** (from description) → estimation accuracy tracking (were we good at predicting?)

**Description format after reassessment:**
```markdown
Version: [Outline]({version_module_doc_url})

Requirements: [pass/fail criteria]

Original Estimate: 3 points
```

---

## Post-Completion Pipeline

After `/pp` marks a T1 as Done and all T1s under an intake are complete, the intake moves to Done. The PM then manages the post-completion pipeline on the **intake item** — sign-off, announcement, stakeholder approval, and deployment tracking.

**T1 terminal state is Done.** All states beyond Done (Passed, Announced, Approved, Deployed) are tracked on the **intake item** only — never on T1s.

### States (Intake Item)

```
Done → Passed → Announced → Approved → Deployed
       (manual)  (/pi)       (manual)   (manual)
```

| State | Who | How | Purpose |
|-------|-----|-----|---------|
| **Done** | Auto | `/pp` auto | All T1s complete, intake auto-closed |
| **Passed** | PM | Manual drag | PM reviewed demo/staging, confirmed QA pass |
| **Announced** | PM | `/pi` command | Task report created on Outline, stakeholders notified via email |
| **Approved** | PM | Manual drag | Stakeholder acknowledged within feedback window, ready to deploy |
| **Deployed** | PM | Manual drag | Deployed to production, lifecycle complete |

**Passed** is optional — `/pi` can shortcut from Done directly to Announced.

### `/pi` Command Flow

1. PM confirms engineer's work passes QA (demo, staging, code review)
2. PM runs `/pi <intake-link>` in the PA codebase
3. `/pi` gathers context (all T1s, their T2s, version docs, spec docs) and creates a **Task Report** on Outline under the Task Reports folder
4. PM pastes screenshots/evidence into the report
5. `/pi` asks PM to confirm recipient list and acknowledgement window (default 24 hours)
6. `/pi` sends announcement email via workspace comms MCP with Outline + Plane links
7. Intake moves to **Announced**

### Post-Announcement

- **Next cycle**: PM checks Announced intakes. If stakeholder acknowledged (or 24hrs passed with no objection) → drag to **Approved**
- **Approved intakes**: PM tells engineer to deploy → engineer deploys → PM drags to **Deployed**
- **Stakeholder feedback**: If stakeholder requests changes, PM uses `/pm improve` to extend the intake with new T1(s). See [Improve Path](#improve-path-rejection--extension)

### Improve Path (Rejection / Extension)

When work is Done but not up to standard, or new context arrives, the PM can extend the intake with additional T1(s) instead of creating a separate intake item.

**Eligible states:** Done, Passed, Announced. Once **Approved**, work is considered final — create a new intake instead.

```
Done/Passed/Announced
        ↓ (PM determines work is insufficient or new context arrived)
/pm improve <intake-id>
        ↓
Intake → Todo (rolled back)
New T1(s) created under same intake
Tracking checklist updated
        ↓
Normal pipeline: /pm breakdown → /p → /s → /pp
        ↓
All T1s complete → Intake → Done (again)
```

**Optional enrichment before improve:**
- `/intake <existing-id>` (PA) — append business context from emails/chat/meetings
- `/triage <existing-id>` (project) — append/update technical context for new modules

See `/pm` IMPROVE protocol for full command details.

### Outline Task Reports

Reports live under `Task Reports/` in the Outline document hierarchy:

```
[ROOT_DOC_ID] Project
├── [SPECIFICATIONS_DOC_ID] Specifications/
├── [TASK_REPORTS_DOC_ID] Task Reports/
│   ├── [Intake Title] — Task Report
│   └── [Intake Title] — Task Report
├── [VERSIONS_DOC_ID] Versions/
└── [CYCLES_DOC_ID] Cycles/
```

Task reports are stakeholder-facing — written in non-technical language with screenshots and a summary of what was delivered. When an intake cycles back through `/pi` after improve, the existing report is updated (appended), not duplicated.

---

## Module Naming

### Convention

Clean, human-readable names. Use `:` for sub-scoping within a name (e.g., `3D Scene: Canvas`). No trailing colon required on module names.

### Parent / Sub-Module Hierarchy

When a feature area is too large for a single module, split it into a **parent module** and **sub-modules**:

```
3D Scene                  ← parent: page container, provider, routing, shared code
3D Scene: Canvas          ← sub-module: 3D viewport and object rendering
3D Scene: Timeline        ← sub-module: timeline editor and playback
3D Scene: Properties      ← sub-module: inspector panel
3D Scene: Nav             ← sub-module: scene navigation bar
```

**Parent module** covers the top-level page container, provider, routing, and shared utilities that don't belong to any specific sub-module. Sub-modules use `:` scoping for specific feature areas within the parent.

**Agent assessment rule:** When an agent receives work on a parent module, they **must first assess all sub-modules** under that parent and route the work to the most specific sub-module that fits. Only work that genuinely spans the container level (page layout, provider, routing, shared hooks) stays on the parent module.

**When to split:** If a parent module's scope grows too large (multiple unrelated feature areas), break it into new sub-modules. The parent module should remain lean — primarily container-level concerns.

### Recommendation: Feature-Area Modules

Organize modules by **product feature**, not technical layer:

**Recommended:**
```
Auth
Home
Organization
Production
3D Scene                  ← parent module
3D Scene: Canvas          ← sub-module
3D Scene: Timeline        ← sub-module
Atlas
Files
```

**Not recommended (for frontend-heavy projects):**
```
Front End
Supabase
Infrastructure
```

**Rule of thumb:** A module should map to something a non-engineer can understand as "done" or "not done."

For full-stack projects with significant backend complexity, use hybrid naming:
```
Auth                      ← cross-cutting feature
Dashboard: Analytics      ← feature area
Infrastructure: CI/CD     ← infra-only module
```

### Module Rename Protocol

When a module is renamed (e.g., `Scripts` → `Atlas`):

1. Rename Outline spec doc (retitle under Specifications/)
2. Rename Plane module
3. New version work items use new name: `[v3.0.0 | Atlas] ...`
4. Old version items keep original names (historical accuracy): `[v2.0.0 | Scripts] ...`
5. Spec doc Non-Technical section notes the rename

### Naming in Work Item Titles

The version and module name go inside the `[...]` metadata block (version first) in work item titles:

```
Module:  "3D Scene: Canvas"
Tier 1:  [v2.0.0 | 3D Scene: Canvas] Object placement system
Tier 2:  [v2.0.0 | 3D Scene: Canvas] Object placement system > Gizmo controls
Tier 3:  [v2.0.0 | 3D Scene: Canvas] Object placement system > Gizmo controls > Phase A - Transform gizmo
Tier 4:  [v2.0.0 | 3D Scene: Canvas] Object placement system > Gizmo controls > Phase A > Build rotation handle
```

---

## MCP Setup

### Prerequisites

- Python `uvx` (for MCP server execution)
- Plane instance with API access
- Outline instance with API access

### Environment Setup

1. Copy `.env.example` to `.env.dev`:
   ```bash
   cp .env.example .env.dev
   ```

2. Fill in API keys in `.env.dev`:
   ```
   PLANE_API_KEY=your_plane_api_key
   PLANE_WORKSPACE_SLUG=your_workspace
   PLANE_BASE_URL=https://your-plane-instance.com
   OUTLINE_API_KEY=your_outline_api_key
   OUTLINE_API_URL=https://your-outline-instance.com/api
   ```

3. Apply environment and generate MCP config:
   ```bash
   pnpm env:apply dev
   pnpm mcp:gen
   ```

This generates `.mcp.json` at project root with two MCP servers:
- `plane-[project]` — Plane MCP server (`uvx plane-mcp-server stdio`)
- `outline-[project]` — Outline MCP server (`uvx mcp-outline`)

### MCP Tools Reference

**Plane:** `create_module`, `retrieve_module`, `update_module`, `delete_module`, `list_work_items`, `retrieve_work_item`, `retrieve_work_item_by_identifier`, `create_work_item`, `update_work_item`, `delete_work_item`, `search_work_items`, `add_work_items_to_module`, `add_work_items_to_cycle`, `list_cycles`, `create_cycle`, `list_states`, `list_intake_work_items`, `retrieve_intake_work_item`, `update_intake_work_item`, `delete_intake_work_item`

**Outline:** `create_document`, `read_document`, `update_document`, `search_documents`, `get_document_id_from_title`

### First-Time Project Setup

After MCP is configured, the first `/pm` run will:
1. Ask for Plane Project ID (or create new)
2. Ask for Outline Root Doc ID (project node inside the collection)
3. Record all state UUIDs in the `po` skill
4. Verify `Specifications/` and `Versions/` docs exist under root (create if missing)

---

## Files Reference

| File | Purpose |
|------|---------|
| `docs/pm.md` | This document — portable PM flow |
| `docs/index.md` | Thin pointer — Plane Project ID + Outline Root Doc ID |
| `.claude/skills/po/SKILL.md` | Project-specific constants, MCP tools, naming conventions |
| `.claude/commands/project/pm.md` | Manager command — vision, breakdown |
| `.claude/commands/project/p.md` | Engineer command — tier 2 → rich temp file |
| `.claude/commands/project/pp.md` | Engineer command — push tier 3+4 + auto-condense |
| `.claude/commands/project/s.md` | Engineer command — skills-aware implementation |
| `.claude/commands/project/rp.md` | Reporter command — cycle reports to Outline |
| `.claude/commands/pa/pi.md` | PM command — post-intake: task report + stakeholder announcement |
| `scripts/plane-cycle-items.js` | Plane API data extractor for cycle reports |
| `scripts/plane-work-items.js` | Plane API — work item context (tier 1 parent + sibling tier 2s) |
| `cycles/**/*.md` | Plan files and cycle data (version-controlled) |

<!-- PM Flow v3.3 — Sibling context in /p, plane-work-items.js script -->
