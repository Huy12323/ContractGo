---
name: /p
description: Engineer planning — break a tier 2 work item into phases and tasks inside a local plan file
---

# Engineer Planning Command

Plan implementation for a **tier 2 work item**. Creates a **local plan file** whose body becomes the T2 description body at `/pp` time (1:1 minus the stripped `## Context` section).

Always load `po` skill via `Skill("po")`. Then load project-specific skills relevant to the tier 2 being planned — run the `/load-skills` discovery process (discover → select → load → validate) to gain convention awareness for file paths, component patterns, and architectural rules.

**Cycle:** `/pm` (plan features) → `/p` (plan implementation) → `/s` (execute) → `/pp` (push + condense)

---

## Input

```
/p [link to tier 2 work item]     → Plan from Plane work item
/p [plan file path]                → Resume existing plan
```

---

## PLAN Mode (New Plan File)

### Preconditions

- Parse Plane URL → extract work item identifier
- Run `node scripts/plane-item-get.js {PROJECT_IDENTIFIER}-{N}` → verify it's tier 2 (has parent, parent is tier 1)
- Read Outline spec doc link from tier 2 description (saved to `temp/plane/{IDENT}.html`)

### Process

1. **Read tier 2** via `plane-item-get.js` — get title, state, estimate, module, cycle, parent UUID. Read description from saved temp file for requirements and spec link
2. **Read tier 1 parent** via `plane-item-get.js {PARENT-IDENT}` — get the overall module-version scope, state, and **cycle** (the `Cycle:` line shows `YYYY/WW` — convert to `YYYY-WW` for folder path). Also get **module UUID** (the `Modules:` line) for later use
3. **Read linked context** — check T1 description for context source (exactly one of these):
   - If `Intake: [PROJ-N](url)` → fetch it via `node scripts/plane-intake-get.js {PROJ-N}`:
     - **Intake Context** (business requirements) — authoritative. Understand who asked, why, and what they need. This informs implementation priorities and edge cases.
     - **Technical Context** (triage findings) — **preliminary hints only**. Use as a starting direction for affected files/areas, but verify against the current codebase. Code may have changed since triage.
   - If `Roadmap Feature: [Title](outline_url)` → pull the feature doc from Outline:
     - **Description + Acceptance Criteria** — authoritative business requirements (same role as Intake Context). Understand what should work and the pass/fail criteria.
     - **Notes** — cross-module dependencies and constraints.
     - **T1s list** — see other T1s for the same feature (may be in other modules).
     - Also pull the parent **roadmap module doc** → read `Spec:` link (for step 7 below) + sibling features to understand the full version scope for this module.
4. **Get sibling context** — run `plane-work-items.js` (see `po` skill → Plane Scripts) to see all tier 2 items under the same tier 1. Pass `--cycle` from the tier 1's cycle. Read the output file to understand what other features are planned, their boundaries, and progress. This prevents overlap and guessing.
   ```bash
   node scripts/plane-work-items.js {PROJECT_IDENTIFIER}-{N} --cycle {YYYY/WW}
   ```
5. **Resolve local state** — Plane status alone is unreliable for siblings being worked in parallel. A T2 can be fully implemented locally but not yet pushed via `/pp` (Plane still shows In Progress). Scan the `cycles/[YYYY-WW]/[module-slug]/[TIER1-ID]/` directory for sibling plan files and determine **effective state** by combining Plane + local signals:

    | Plane State | Local Plan File | Effective State |
    |---|---|---|
    | Done | (any) | Done |
    | In Progress | All tasks `[x]` | **Done (local, pending /pp)** |
    | In Progress | Some tasks `[x]` | In Progress (partially implemented) |
    | In Progress | No tasks `[x]` or no plan file | In Progress (planned only) |
    | Todo/Backlog | Plan file exists | Planned (local) |
    | Todo/Backlog | No plan file | Not started |

    Use the **effective state** (not raw Plane state) for the `Siblings:` line in the plan file `## Context` section and for execution order checks in step 6.

6. **Check execution order** — read the T1 description HTML (saved in step 2 at `temp/plane/{PARENT-IDENT}.html`) for an `## Execution Order` section. If present:
    - Identify which step this T2 belongs to in the ordered list
    - Cross-reference sibling **effective states** from step 5 to check if all T2s in **earlier steps** are Done (including "Done (local, pending /pp)" — locally complete work counts as done for ordering purposes)
    - Collect context from completed earlier-step T2s: read their plan files (from `cycles/` directory) OR their Plane T2 descriptions (post-`/pp`) to understand what was built — the two are 1:1 minus Context, so either source works
    - If prerequisites are NOT all effectively Done → **warn the user**: list which items must complete first and their current state. Do not proceed unless the user explicitly overrides
    - If execution order section is absent → no blocking, proceed normally
7. **Read version module doc** from Outline — primary context carrier with rationale, scope, Figma refs, affected files, and Planning Decisions from `/pm`
8. **Read module spec** from Outline — both Non-Technical Description and Technical Implementation sections
9. **Read related module specs** if referenced in the technical section (follow Outline links)
10. **Assess feasibility** — if not doable or needs discussion, surface to user
11. **Q&A rounds** until implementation approach is clear:
    - Component architecture, state management, data flow
    - Schema changes needed
    - Edge cases and error handling
    - Phase ordering and dependencies
    - Boundaries with sibling tier 2 items (avoid overlap)
12. **QA Persistence** — after Q&A rounds complete and approach is agreed:
    a. Collect all decisions made during the session (architectural choices, scope boundaries, rejected alternatives, edge case resolutions)
    b. Pull the version module doc from Outline (from step 7's Version Doc link)
    c. Append to `## Planning Decisions` section (create if absent) via Edit tool:
       ```markdown
       ### [T2 Title] — Planning (YYYY-MM-DD)
       - **Decision:** [What was decided]
         **Rationale:** [Why — constraints, rejected alternatives]
       - **Scope boundary:** [What is explicitly excluded]
       ```
    d. Push version doc back: `node scripts/outline-push.js temp/outline/<uuid>.md`
    e. This preserves decisions for future agent sessions — prevents repeated questions when different agents work on sibling T2s or during `/pp`. Plan files are local-only and ephemeral; Outline is the durable documentation layer.
13. **Break tier 2** into phases and tasks (narrative + checkbox list per phase — no Plane work items; phases/tasks live inside the plan file and eventually the T2 description)
14. **Create plan file** at `cycles/[YYYY-WW]/[module-slug]/[TIER1-ID]/[TIER2-ID]-[feature-slug].md` where `YYYY-WW` comes from the **tier 1's Plane cycle** (not the current calendar week). See `po` skill → Cycles Directory Convention for path construction and module slug sanitization
15. **User must confirm** before plan file creation

### Plan File Format

The plan file structure is 1:1 with what will become the T2 description body at `/pp` push time, plus a trailing `## Context` section for agent orientation that gets stripped on push.

```markdown
# [Tier 2 Title]

> Version: [Outline]({version_doc_url}) | Tier 1: [{PROJECT_IDENTIFIER}-N]({plane_browse_url}) | Module: [Plane]({plane_module_url})

## Requirements

- Pass/fail criterion 1
- Pass/fail criterion 2

## Scope boundaries

- What is explicitly NOT in this T2 and why
- Deferred items pointing to follow-up T2s/T1s

## Decisions

- **Decision:** [What was decided]
  **Rationale:** [Why — constraints, rejected alternatives]
- **Decision:** ...

## Implementation

### Phase A — [Phase Name]

Short narrative (1-3 sentences): what this phase does, why it's a phase.

- [ ] Task 1 description
- [ ] Task 2 description

### Phase B — [Phase Name]

Short narrative.

- [ ] Task 1 description
- [ ] Task 2 description

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during `/s` and for sibling awareness during concurrent `/p` sessions._

Non-tech: [1-2 sentence stakeholder description]
Tech: [key files, components, tables involved]
Related: [Module Name]({outline_link}) - [why related]
Siblings: [N] total, [N] Done — [{PROJECT_IDENTIFIER}-X Feature (effective state), ...]
Execution Order: Step [N] of [M] — [prerequisite status, e.g., "all done ✓" or "BLOCKED: {IDENT}-N (effective state)"]
Outline Spec: [outline_spec_link]
Roadmap Feature: [Feature Title]({outline_feature_url})   ← only if T1 has Roadmap Feature link
```

### Post-Creation (automatic — no user confirmation needed)

Update Plane status immediately after writing the plan file:

- Tier 2: `node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --state in_progress`
- Tier 1 (parent): If at Backlog/Todo → `node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --state in_progress`

### Output

```
Plan created: cycles/[YYYY-WW]/[module]/[TIER1-ID]/[filename].md
Phases: [count] | Tasks: [count]
Tier 2: [{PROJECT_IDENTIFIER}-N] → In Progress
```

---

## RESUME Mode (Existing Plan File)

1. **Read plan file** → show progress summary (checked vs unchecked tasks)
2. **Check drift** → compare plan file vs codebase, flag discrepancies
3. **Process request**: update phases, add tasks, mark tasks, adjust approach, expand phase narratives as work ships
4. **Write back** to plan file
5. **STOP**

---

## Critical Rules

1. **PLANNING ONLY** — never execute code implementation
2. **No Plane work items created** — phases and tasks live inside the plan file and eventually the T2 description body (T3/T4 are removed from the framework)
3. **Plan file body = future T2 description body** — maintain the 1:1 structure (minus the `## Context` section which is stripped on `/pp` push). Other agents reading the Plane T2 or the plan file see the same content in the same order
4. **Confirm before creation** — user approves the plan
5. **Update Plane status** — tier 2 → In Progress, tier 1 → In Progress
6. **One plan file per tier 2** — never merge multiple tier 2 items into one file
7. **Phases are lettered** — A, B, C (simple letters, no version prefix)
8. **Planning Decisions persist to Outline** — the version doc's `## Planning Decisions` section is the source of truth for the "why"; plan files are ephemeral local state

---

<!-- Command version: 3.0 — T3/T4 removed from framework. Plan file body is 1:1 with T2 description body (minus stripped Context section). No Plane IDs section. Unified Requirements/Scope/Decisions/Implementation/Context structure. -->
