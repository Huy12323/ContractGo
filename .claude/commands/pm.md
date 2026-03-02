---
name: /pm
description: Product management — vision, module creation, tier 2 breakdown, intake accept/triage, catch-up
---

# Product Management Command

**Manager role.** Plan features at the stakeholder level — modules and behaviors, NOT implementation details.

Always load `po` skill via `Skill("po")`.

---

## Input & Mode Detection

```
/pm [description]          → Agent infers protocol from content
/pm [tier 1 link]          → BREAKDOWN (tier 1 → tier 2 features)
/pm [triaged intake link]  → ACCEPT (pre-triaged intake → versioned work)
/pm [raw intake link]      → TRIAGE (unscoped intake → versioned work)
```

**Mode detection — infer from prompt content, not keywords:**

| Signal in prompt | Protocol |
|-----------------|----------|
| Link to a Plane work item (tier 1, no parent) | BREAKDOWN |
| Link to an intake item with "Technical Context" section (pre-triaged by `/triage`) | ACCEPT |
| Mentions intake items, client requests, change requests, or ad-hoc ideas needing triage | TRIAGE |
| Existing codebase with no PM foundation (no Plane modules, no Outline specs, no tier system) | CATCH-UP |
| New project idea, version description, feature planning, product vision | BASE |

When ambiguous, ask the user to clarify which protocol applies.

---

## BASE Protocol (New Version)

**Trigger:** `/pm` with project idea or version description

### Phase 1 — Discovery

1. Discuss idea with user, rounds of refinement
2. Expand and ask relevant questions for full picture
3. Present high-level, ordered feature set grouped by modules (ordered by implementation dependency)
4. For each proposed module, assess scope — if a feature area has multiple distinct sub-features, propose a **parent module** (container/routing/shared) with **sub-modules** (`:` scoped). See `po` skill for parent/sub-module hierarchy convention

### Phase 2 — Context Gathering

Ask for missing context:

- Version: **Run `node scripts/plane-latest-version.js`** to get the current latest version, then apply semver bump (patch/minor/major) from it. Never rely on memory or conversation context — the script is the source of truth. Versions are app-wide, not per-module — a new module gets the current app version, never its own v1.0.0
- Module deadlines (start = today, end = deadline). Modules can be grouped in deadline phases
- Lead user for each module (suggest from `po` skill members)
- Check for unfinished work items from previous versions — user must confirm: leave active or cancel

### Phase 3 — Confirm with user before proceeding.

### Phase 4 — Execute (if confirmed)

1. **Update `docs/index.md`** — Store Plane Project ID + link and Outline Root Doc ID + link

2. **Create Plane modules** — One per feature area:
    - `name`: Clean, human-readable (e.g., `3D Scene: Canvas`). No trailing colon.
    - `start_date`: today
    - `target_date`: deadline
    - `lead`: assigned lead user UUID
    - `status`: `planned`

3. **Create Outline documentation:**
    - **Module spec docs** under `Specifications/` — one per module. **Sub-module docs nest under their parent module doc using the short name** (part after `:` in the Plane name). Example: Plane module `3D Scene: Canvas` → Outline doc titled `Canvas`, created as child of the `3D Scene` doc. Never use the full colon-scoped name as the Outline doc title when nesting. Three sections per doc:
        - Non-Technical Description (concise, current state — 2-4 sentences + capability bullets)
        - Technical Implementation (note "To be populated during implementation" for new modules)
        - Version History (empty, populated by `/pp`)
    - **Version parent doc** under `Versions/` — e.g., `Versions/v1.0.0/`
    - **Version module docs** under `Versions/[vX.Y.Z]/` — one per module, flat (not nested). Use the full Plane module name as the doc title for easy scanning: `Versions/v3.0.0/3D Scene: Canvas`. Each doc includes **full context from the `/pm` session**: rationale, scope decisions, Figma links, affected files, QA outcomes. This is the primary context carrier for downstream `/p` and `/pp` — not a stub

4. **Write/update Product Bible (Specifications root doc):**
    - For existing Bible: use pull → Edit → push workflow (`node scripts/outline-pull.js bible` → Edit tool → `node scripts/outline-push.js temp/outline/<uuid>.md`). See `po` skill → Outline Scripts
    - For first-time Bible: use MCP `update_document` (full content, no existing doc to diff)
    - Rewrite the Specifications root doc with substantive content — NOT a stub or index
    - **Product Vision** — what the product is, who it's for, the problem it solves (from Phase 1 Discovery)
    - **Architecture Overview** — technology stack, infrastructure, auth model
    - **Module Map** — every module grouped by domain, 1-liner each + link to spec doc, cross-module dependencies
    - **User Journeys** — key workflows through the app from the user's perspective
    - The Phase 1 Discovery context **must flow into this document** — this is where the richest product understanding is persisted

5. **Cross-link Plane ↔ Outline:**
    - Update Plane module descriptions: `Spec: [Outline]({spec_doc_url})`
    - Update Outline spec docs: `> Module: [Plane]({module_url})`

6. **Create Plane tier 1 seed work items** — One per module:
    - `title`: `[Module | version]` (e.g., `[Auth | v2.0.0]`)
    - `description`: `Version: [Outline]({version_module_doc_url})`
    - `state`: Backlog
    - `priority`: Medium
    - `assignees`: Module lead user
    - `start_date`: today
    - `due_date`: module deadline
    - `cycle`: current cycle
    - `module`: associated module

### Output

```
Created
Version: [vX.Y.Z]
Modules: [count] on Plane
Specs: [count] on Outline
Tier 1: [count] seed work items
```

---

## CATCH-UP Protocol (Existing Project Baseline)

**Trigger:** `/pm catch-up` — retroactively create PM foundation for an already-built project

### Phase 1 — Discovery

1. Explore the codebase — routes, components, database schema, edge functions
2. Identify logical modules from existing feature areas
3. Present proposed module breakdown to user

### Phase 2 — Context Gathering

Same as BASE — version number (the app-wide version at the time the project was first built — typically `v1.0.0` if no PM system existed before), lead user, Plane/Outline IDs if not already configured

### Phase 3 — Confirm with user before proceeding.

### Phase 4 — Execute (if confirmed)

Same artifacts as BASE, but everything is **already built**. Same sub-module nesting rules as BASE apply (short name, nested under parent):

1. **Create Plane modules** — status: `completed`
2. **Create Outline spec docs** — written from existing code, reflecting current state. Sub-module docs nest under parent using short name (see BASE Phase 4 step 3)
3. **Create version docs** — summary of what exists (no SPARK-N links — retroactive). Same nesting rule for sub-modules
4. **Write Product Bible (Specifications root doc)** — using the codebase exploration from Phase 1, write the full product overview: vision, architecture, module map, user journeys. This is the baseline Bible
5. **Create tier 1 seed work items** — state: **Done**
6. **Cross-link everything**

**No tier 2/3/4 items created** — this is a baseline snapshot. Future work starts with normal BREAKDOWN flow.

### Output

```
Baseline Created
Version: [vX.Y.Z] (retroactive)
Modules: [count] on Plane (completed)
Specs: [count] on Outline (from code)
Tier 1: [count] seed work items (Done)
```

---

## BREAKDOWN Protocol (Tier 1 → Tier 2)

**Trigger:** `/pm [link to tier 1 work item]`

### Preconditions

- Run `node scripts/plane-item-get.js {PROJECT_IDENTIFIER}-{N}` → verify tier 1 (Parent: none), state is NOT Done
- Read description from saved temp file → extract Outline version module doc link
- Note cycle UUID and module UUID from the output (for cloning to T2s)

### Process

1. Read module spec from Outline (both non-technical and technical sections)
2. Break into feature-level work items — **behavior + expectations, NOT implementation steps**
    - Tier 2 describes WHAT should work (pass/fail criteria), not HOW to build it
    - Example: "Google OAuth login with redirect to dashboard" NOT "Build auth hook, create login component"
3. Assign Fibonacci estimates (1, 2, 3, 5, 8):
    - If estimate would be 13 → split into multiple tier 2 items
    - Maximum allowed estimate is 8
4. Present breakdown to user with estimates and rationale
5. Confirm with user

### On Confirmation

Create tier 2 work items via `plane-item-create.js`. Write description HTML to temp file first, then:

```bash
node scripts/plane-item-create.js \
  --name "[Module | version] Feature description" \
  --desc-file temp/plane/new-t2.html \
  --state todo --priority medium --estimate 3 \
  --parent <T1-UUID> --assignees <uuid> \
  --start <date> --due <date> \
  --add-to-cycle <cycle-uuid> --add-to-module <module-uuid>
```

- Properties cloned from tier 1: `start_date`, `due_date`, `cycle`, `module` (from `plane-item-get.js` output)

### Post-Creation

- Update tier 1 status: `node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --state todo`
- Update tier 1 cycle to current week if needed: `node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --add-to-cycle <cycle-uuid>`

### Output

```
Breakdown Complete
Tier 1: [SPARK-N] → Todo
Tier 2: [count] features created
Total estimate: [sum] points
```

---

## ACCEPT Protocol (Triaged Intake → Versioned Work)

**Trigger:** `/pm [link to triaged intake item]` — intake item has both "Intake Context" and "Technical Context" sections (pre-processed by `/intake` + `/triage`).

This is the **preferred path** for intake items that went through the cross-system pipeline:

```
PA: /intake → Plane intake item with "Intake Context" (business context)
       ↓
Codebase: /triage → adds "Technical Context" (codebase analysis)
       ↓
Codebase: /pm ACCEPT → routes to module/version/tier (this protocol)
```

### Preconditions

- Retrieve the intake item from Plane
- Verify it has a "Technical Context" section (added by `/triage`)
- If no Technical Context → fall through to TRIAGE protocol instead

### Process

1. **Read both context sections:**
   - **Intake Context** — who asked, why, urgency, business background (from PA)
   - **Technical Context** — affected modules, files, complexity estimate, risks (from `/triage`)

2. **Identify ALL target modules** — use the Technical Context's "Affected Module(s)" field, cross-reference with Plane modules. A single intake item may span multiple modules — each module gets its own T1/T2 scope.

3. **For each affected module, check for active tier 1:**
   a. If module has an active (not Done) tier 1 → add tier 2 under it
   b. If no active tier 1 → **run `node scripts/plane-latest-version.js`** to get the latest version, then determine semver bump:
      - Patch: bug fix or small tweak
      - Minor: new feature, non-breaking
      - Major: breaking change or redesign

4. **Draft tier 2 work items** — use Technical Context for scoping, Intake Context for requirements:
   - Title: `[Module | version] Feature description`
   - Description: `Version: [Outline]({version_module_doc_url})\n\nRequirements: [pass/fail criteria derived from intake context]`
   - Estimate: start from `/triage`'s complexity estimate, adjust based on PM judgment
   - State: Todo
   - Properties: cloned from tier 1 (start_date, due_date, cycle, module)

5. **Confirm** with user — present module routing, version decision, tier 2 breakdown with estimates

6. **Execute** (if confirmed):
   - If new version: create tier 1 seed + version doc on Outline
   - Create tier 2 work items (same as BREAKDOWN)
   - Update spec doc if scope changes planned capabilities — use pull → Edit → push workflow
   - **Track intake → T1 linkage** — run `node scripts/plane-intake-handling.js <INTAKE-ID> add <T1-ID> [<T1-ID> ...]` to add all T1s to the intake item's Tracking checklist. The script places a `## Tracking` section at the top of the intake description with checkbox entries linking to each T1. If the intake already has a Tracking section (from a previous ACCEPT), new T1s are appended to the existing list (duplicates are skipped).
   - Accept intake item from queue (change status from pending to accepted)
   - If a new module was created or scope change is significant → review and update the Product Bible

### Output

```
Accept Complete
Intake: [title] → accepted
Modules: [module names]
Version: [vX.Y.Z] [new/existing]
Tier 1: [count] linked ([SPARK-N, ...])
Tier 2: [count] features created
Total estimate: [sum] points
```

---

## TRIAGE Protocol (Raw Intake → Versioned Work)

**Trigger:** `/pm triage` or `/pm triage [intake item link]` — for intake items that were NOT pre-processed by `/intake` + `/triage` (e.g., manually submitted by ops staff directly in Plane).

For items that went through the `/intake` → `/triage` pipeline, use **ACCEPT** protocol instead.

### Process

1. **List pending intake items** — `list_intake_work_items` via MCP
2. **Present summary** — title, description for each item
3. **For each item (or batch of related items):**
   a. Identify which module(s) this affects
   b. Check if module has an **active** (not Done) tier 1
   c. **Version decision:**
    - Active tier 1 exists → add tier 2 under it (no version bump needed)
    - No active tier 1 → **run `node scripts/plane-latest-version.js`** to get the latest version, then determine semver bump:
        - Patch: bug fix or small tweak
        - Minor: new feature, non-breaking
        - Major: breaking change or redesign
4. **Confirm** version decision and tier 2 breakdown with user
5. **Execute:**
    - If new version: create tier 1 seed + version doc on Outline
    - Create tier 2 work items (same as BREAKDOWN)
    - Update spec doc if scope changes planned capabilities — use pull → Edit → push workflow (see `po` skill → Outline Scripts)
    - Accept/remove intake item from queue
    - If a new module was created or scope change is significant → review and update the Product Bible via pull → Edit → push
6. **Report**

### Batching

Review ALL pending intake before triaging. Batch related requests for the same module into one version bump.

### Output

```
Triage Complete
Intake processed: [count] items
New versions: [list or "none"]
Tier 2 created: [count] features
```

---

## Version Sealing

**A completed version is sealed permanently.** Once a tier 1 reaches Done, no new tier 2 items can be added under it.

| Tier 1 State                 | Can add tier 2? | Action                          |
| ---------------------------- | --------------- | ------------------------------- |
| Backlog / Todo / In Progress | Yes             | BREAKDOWN or TRIAGE adds tier 2 |
| Done                         | No              | Must bump version → new tier 1  |

---

## Critical Rules

1. **Tier 2 is behavior, not implementation** — describe what works, not how to build it
2. **Always confirm** before creating anything
3. **Max estimate is 8** — split 13-point items
4. **Cross-link everything** — Plane ↔ Outline bidirectional
5. **Check for existing work** — don't create duplicate modules or version docs
6. **Versions are sealed** — Done tier 1 = no new tier 2 under it
7. **Batch intake items** — group related requests into one version bump
8. **Spec docs are current state** — concise, rewritten (not appended) on each update

---

<!-- Command version: 2.7 — Script-first: use plane-item-create.js for T1/T2 creation, plane-item-get.js for reads, plane-item-update.js for state changes -->
