---
name: /p
description: Engineer planning — break tier 2 work item into implementation phases via plan file
---

# Engineer Planning Command

Break a **tier 2 work item** into implementation phases (tier 3) and tasks (tier 4). Creates a **plan file** locally.

Always load `po` skill via `Skill("po")`.

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
3. **Get sibling context** — run `plane-work-items.js` (see `po` skill → Plane Scripts) to see all tier 2 items under the same tier 1. Pass `--cycle` from the tier 1's cycle. Read the output file to understand what other features are planned, their boundaries, and progress. This prevents overlap and guessing.
   ```bash
   node scripts/plane-work-items.js {PROJECT_IDENTIFIER}-{N} --cycle {YYYY/WW}
   ```
4. **Read version module doc** from Outline — this is the primary context carrier with rationale, scope, Figma refs, affected files, and QA decisions from `/pm`
5. **Read module spec** from Outline — both Non-Technical Description and Technical Implementation sections
6. **Read related module specs** if referenced in the technical section (follow Outline links)
7. **Assess feasibility** — if not doable or needs discussion, surface to user
8. **Q&A rounds** until implementation approach is clear:
    - Component architecture, state management, data flow
    - Schema changes needed
    - Edge cases and error handling
    - Phase ordering and dependencies
    - Boundaries with sibling tier 2 items (avoid overlap)
9. **Break tier 2** into phases (tier 3) and tasks within each phase (tier 4)
10. **Create plan file** at `cycles/[YYYY-WW]/[module-slug]/[TIER1-ID]/[TIER2-ID]-[feature-slug].md` where `YYYY-WW` comes from the **tier 1's Plane cycle** (not the current calendar week). See `po` skill → Cycles Directory Convention for path construction and module slug sanitization
11. **User must confirm** before plan file creation

### Plan File Format

```markdown
# [Tier 2 Title]

Work Item: [{PROJECT_IDENTIFIER}-N] ([plane_link])
Tier 1: [{PROJECT_IDENTIFIER}-N] [Module | version] ([state])
Module: [Module Name] ([plane_module_link])
Outline Spec: [outline_spec_link]
Version Doc: [outline_version_link]

## Context (from spec)

Non-tech: [1-2 sentence stakeholder description]
Tech: [key files, components, tables involved]
Related: [Module Name] ([outline_link]) - [why related]
Siblings: [N] total, [N] Done — [{PROJECT_IDENTIFIER}-X Feature (state), {PROJECT_IDENTIFIER}-Y Feature (state), ...]

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

### Status Updates (on Plane via scripts)

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
3. **Process request**: update phases, add tasks, mark tasks, adjust approach
4. **Write back** to plan file
5. **STOP**

---

## Critical Rules

1. **PLANNING ONLY** — never execute code implementation
2. **Rich context required** — plan file must include Non-tech, Tech, and Related sections from the Outline spec
3. **Confirm before creation** — user approves the plan
4. **Update Plane status** — tier 2 → In Progress, tier 1 → In Progress
5. **One plan file per tier 2** — never merge multiple tier 2 items into one file
6. **Phases are lettered** — A, B, C (simple letters, no version prefix)

---

<!-- Command version: 2.3 — Script-first: use plane-item-get.js for reads, plane-item-update.js for state updates -->
