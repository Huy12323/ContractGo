---
name: /pm
description: Product management — vision, module creation, tier 2 breakdown, intake accept/triage/improve, catch-up
---

# Product Management Command

**Manager role.** Plan features at the stakeholder level — modules and behaviors, NOT implementation details.

Always load `po` skill via `Skill("po")`. Then load project-specific skills relevant to the modules being planned — run the `/load-skills` discovery process (discover → select → load → validate) to gain convention awareness for naming, paths, and architectural patterns.

---

## Input & Mode Detection

```
/pm [description]          → Agent infers protocol from content
/pm [tier 1 link]          → BREAKDOWN (tier 1 → tier 2 features)
/pm [triaged intake link]  → ACCEPT (pre-triaged intake → versioned work)
/pm [raw intake link]      → TRIAGE (unscoped intake → versioned work)
/pm [outline feature link] → ROADMAP (roadmap feature → versioned T1s)
/pm improve <intake link>  → IMPROVE (extend intake with new T1s)
```

**Mode detection — infer from prompt content, not keywords:**

| Signal in prompt | Protocol |
|-----------------|----------|
| Link to a Plane work item (tier 1, no parent) | BREAKDOWN |
| Link to an intake item with "Technical Context" section (pre-triaged by `/triage`) | ACCEPT |
| Outline URL to a feature doc (child of a roadmap module doc — has `Module:` and `Version:` fields) | ROADMAP |
| Mentions intake items, client requests, change requests, or ad-hoc ideas needing triage | TRIAGE |
| Explicit `improve` keyword + intake link, or intake in Done/Passed/Announced needing rework | IMPROVE |
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

- Version: **Run `node scripts/plane-latest-version.js`** to get the current latest version. **Present it to the user and ask:** bundle with current version, or bump? If bumping, confirm semver level (patch/minor/major). Never auto-assume the next version — the user decides. Versions are app-wide, not per-module — a new module gets the current app version, never its own v1.0.0
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
    - `title`: `[version | Module] Title` (e.g., `[v2.0.0 | Auth] Password reset flow`)
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
- **Read linked context** — check T1 description for context source (exactly one of these):
  - If `Intake: [PROJ-N](url)` → fetch the intake item via `node scripts/plane-intake-get.js {PROJ-N}` and read both sections:
    - **Intake Context** (business requirements) — treat as authoritative. This is the "who asked, why, and what they need" from the requester. Use this to derive pass/fail criteria for T2s.
    - **Technical Context** (triage findings) — treat as **preliminary hints only**. The triage was a point-in-time scan; code may have changed, file paths may be stale, module assignments may be wrong. Use as a starting direction, but independently verify against the current codebase before relying on any specific claim.
  - If `Roadmap Feature: [Title](outline_url)` → pull the feature doc from Outline:
    - **Description + Acceptance Criteria** — treat as authoritative business requirements (same role as Intake Context). Use to derive pass/fail criteria for T2s.
    - **Notes** (cross-module info) — treat as context. Check if work for this T1 overlaps with other modules.
    - Also read the parent **roadmap module doc** → get `Spec:` link + see sibling features for broader context.

### Process

1. Read module spec from Outline (both non-technical and technical sections)
2. Break into feature-level work items — **behavior + expectations, NOT implementation steps**. Use the intake's or roadmap feature's business context to inform requirements and acceptance criteria.
    - Tier 2 describes WHAT should work (pass/fail criteria), not HOW to build it
    - Example: "Google OAuth login with redirect to dashboard" NOT "Build auth hook, create login component"
3. Assign Fibonacci estimates (1, 2, 3, 5, 8):
    - If estimate would be 13 → split into multiple tier 2 items
    - Maximum allowed estimate is 8
4. Present breakdown to user with estimates and rationale
5. Confirm with user

### QA Persistence (after confirmation, before T2 creation)

During the breakdown session, the PM and agent discuss architectural choices, scope boundaries, and edge cases. These decisions MUST be persisted — they inform downstream `/p` and `/s` sessions and prevent repeated questions.

1. Collect all QA decisions from the session — architectural choices, scope boundaries, rejected alternatives, edge case resolutions
2. Pull the version module doc from Outline (from T1's `Version:` link)
3. Append a `## Planning Decisions` section (or append to existing one) via Edit tool:

```markdown
## Planning Decisions

### [T1 Title] — Breakdown (YYYY-MM-DD)
- **Decision:** [What was decided]
  **Rationale:** [Why — rejected alternatives, constraints]
- **Scope boundary:** [What is explicitly NOT included and why]
```

4. Push version doc back: `node scripts/outline-push.js temp/outline/<uuid>.md`
5. Then proceed with T2 creation below

### On Confirmation

Create tier 2 work items via `plane-item-create.js`. Write description HTML to temp file (named by parent T1 identifier to avoid collisions), then:

```bash
node scripts/plane-item-create.js \
  --name "[vX.Y.Z | Module] T1 Title > Feature" \
  --desc-file temp/plane/{PROJECT_IDENTIFIER}-{T1}.html \
  --state todo --priority medium --estimate 3 \
  --parent <T1-UUID> --assignees <uuid> \
  --start <date> --due <date> \
  --add-to-cycle <cycle-uuid> --add-to-module <module-uuid>
```

- Properties cloned from tier 1: `start_date`, `due_date`, `cycle`, `module` (from `plane-item-get.js` output)

### Post-Creation

- Update tier 1 status: `node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --state todo`
- Update tier 1 cycle to current week if needed: `node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --add-to-cycle <cycle-uuid>`

### Execution Order

After all T2 items are created, determine and record the recommended execution order on the T1 description:

1. Analyze dependencies between the T2 items — which are foundational, which can be parallelized, which require others to complete first
2. Fetch the T1 description (if not already cached): `node scripts/plane-item-get.js {PROJECT_IDENTIFIER}-{N}`
3. Edit `temp/plane/{PROJECT_IDENTIFIER}-{N}.html` — add or replace an `## Execution Order` section at the end of the description:

```html
<h2>Execution Order</h2>
<ol>
<li>{PROJECT_IDENTIFIER}-{N1} (foundation)</li>
<li>{PROJECT_IDENTIFIER}-{N2} + {PROJECT_IDENTIFIER}-{N3} (parallel)</li>
<li>{PROJECT_IDENTIFIER}-{N4} (depends on {N1})</li>
<li>{PROJECT_IDENTIFIER}-{N5} + {PROJECT_IDENTIFIER}-{N6} (parallel — new features)</li>
</ol>
```

4. Push: `node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --desc`

**Rules:**
- Numbered steps = sequential dependency (step 2 requires all step 1 items Done)
- `+` within a step = items that can be done in parallel
- Parenthetical annotations explain the reason: `(foundation)`, `(parallel)`, `(depends on {N})`, `(cleanup)`, etc.
- Identifier-only format: `{PROJECT_IDENTIFIER}-{N}`, no titles
- If BREAKDOWN is re-run (T2s added later), the section is replaced (idempotent via HTML section find/replace)

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

2. **Identify ALL target modules** — use the Technical Context's "Affected Module(s)" field, cross-reference with Plane modules. A single intake item may span multiple modules — each gets its own T1. **ACCEPT processes one intake at a time.** Never merge multiple intakes into a single T1 — each T1 traces back to exactly one intake (or none if created outside the pipeline).

3. **For each affected module, check for active tier 1:**
   a. If module has an active (not Done) tier 1 → link intake to it (no new T1 needed)
   b. If no active tier 1 → **run `node scripts/plane-latest-version.js`** to get the latest version. **Present the latest version to the user and ask:** bundle this work into the current version, or bump to a new version? If bumping, confirm the semver level:
      - Patch: bug fix or small tweak
      - Minor: new feature, non-breaking
      - Major: breaking change or redesign
      Never auto-assume the next version number — the user decides.

4. **Resolve assignee** — the intake item must have an assignee before acceptance. If the intake already has one (set by `/intake`), verify it's correct. If not:
   - Read `DEFAULT_ITEM_ASSIGNEE_UUID` from `.env`
   - If set → use it
   - If empty → bootstrap: call `get_project_members` MCP, list members, let user pick, append to `.env`
   - If user explicitly requests a specific person → override the default
   - Set via `node scripts/plane-intake-update.js {INTAKE-IDENT} --assignees <uuid>`

5. **Confirm** with user — present module routing, version decision, and assignee

6. **Execute** (if confirmed):
   - If new version: create tier 1 seed + version doc on Outline:
     - `name`: `[vX.Y.Z | Module] Title` (e.g., `[v2.0.0 | Auth] Password reset flow`)
     - `description`: `Version: [Outline]({version_module_doc_url})\nIntake: [{INTAKE-IDENT}]({intake_browse_url})`
     - `state`: Backlog
     - `priority`: from intake urgency
     - `assignees`: resolved assignee (from step 4)
     - `start_date`: today
     - `cycle`: current cycle
     - `module`: target module
   - **Do NOT create tier 2 items** — ACCEPT only routes to T1 scope. Tier 2 breakdown is a separate step via `/pm [T1 link]` (BREAKDOWN), which requires technical design expertise.
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

Next: Run /pm [T1 link] to break down into tier 2 features.
```

---

## ROADMAP Protocol (Roadmap Feature → Versioned T1s)

**Trigger:** `/pm <outline-feature-doc-link>` — Outline URL pointing to a feature doc in the Roadmap tree. Detected by Outline URL + feature doc having `Module:` and `Version:` fields.

This is the planned-work path — parallel to ACCEPT (reactive intake path). Roadmap features replace intakes for proactively planned product work.

### Preconditions

- Retrieve the feature doc from Outline (use `outline-pull.js` or MCP `read_document`)
- Verify it has `Module:` and `Version:` fields (confirms it's a roadmap feature, not a spec doc)

### Process

1. **Read feature doc** — description, acceptance criteria, `## Notes` for cross-module dependencies
2. **Climb to parent module doc** (roadmap) — get `Spec:` link + sibling features for context
3. **Read spec module doc** via the `Spec:` link — current technical state (Non-Technical + Technical Implementation)
4. **Determine version** from feature doc's `Version:` field (e.g., `v0.3.0`)
5. **Check for active T1** in this module-version scope — if one exists, link feature to it instead of creating a new T1
6. **If no active T1 — version decision:**
   - The version is already determined by the roadmap (the feature lives under a specific version doc)
   - Verify this version exists on Plane — if not, create via `plane-latest-version.js` + `plane-item-create.js`
   - Confirm with user: module, version, assignee
7. **Resolve assignee** — same logic as ACCEPT (check `DEFAULT_ITEM_ASSIGNEE_UUID` from `.env`, or ask user)
8. **Confirm with user** — present module, version, feature summary

### On Confirmation

1. **Create T1(s)** via `plane-item-create.js`:
   - `--name`: `[vX.Y.Z | Module] Feature Title`
   - Description HTML includes:
     ```html
     <p>Version: <a href="[version_doc_url]">Outline</a></p>
     <p>Roadmap Feature: <a href="[outline_feature_url]">[Feature Title]</a></p>
     ```
   - `--state backlog`
   - `--priority`: medium (or user override)
   - `--assignees`: resolved assignee
   - `--cycle`: current cycle
   - `--module`: target module

   **Important:** The T1 description uses `Roadmap Feature:` (not `Intake:`) — this is the protocol signal. `/p` and `/pp` detect this to follow the roadmap path instead of the intake path.

2. **Update feature doc on Outline** — append T1 to `## T1s` section:
   ```markdown
   ## T1s
   - [WCLV1-60](plane_browse_url) [Module | vX.Y.Z] — Backlog
   ```
   Use pull → Edit → push workflow.

3. **Cross-module features** — if `## Notes` lists other affected modules, create additional T1s for those modules. Each T1 links to the SAME feature doc. All T1s are listed in the feature doc's `## T1s` section.

4. **No intake item created** — roadmap features bypass the intake pipeline entirely.

### Output

```
Roadmap T1 Created
Feature: [title] ([outline_url])
Version: vX.Y.Z
Module(s): [module names]
Tier 1: [count] created ([IDENT-N, ...])

Next: Run /pm [T1 link] to break down into tier 2 features.
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
    - Active tier 1 exists → link intake to it (no new T1 needed)
    - No active tier 1 → **run `node scripts/plane-latest-version.js`**, present the latest version, and ask user: bundle with current version or bump? If bumping, confirm semver level:
        - Patch: bug fix or small tweak
        - Minor: new feature, non-breaking
        - Major: breaking change or redesign
        Never auto-assume the next version number — the user decides.
4. **Confirm** version decision with user
5. **Execute:**
    - If new version: create tier 1 + version doc on Outline:
      - `name`: `[vX.Y.Z | Module] Title`
      - `description`: `Version: [Outline]({version_module_doc_url})\nIntake: [{INTAKE-IDENT}]({intake_browse_url})`
      - `state`: Backlog
      - `priority`: from intake urgency
      - `assignees`: `DEFAULT_ITEM_ASSIGNEE_UUID` from `.env` (or user-specified override)
      - `start_date`: today
      - `cycle`: current cycle
      - `module`: target module
    - **Do NOT create tier 2 items** — T2 breakdown is a separate step via `/pm [T1 link]`
    - Update spec doc if scope changes planned capabilities — use pull → Edit → push workflow (see `po` skill → Outline Scripts)
    - **Track intake → T1 linkage** — run `node scripts/plane-intake-handling.js <INTAKE-ID> add <T1-ID> [<T1-ID> ...]`
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

## IMPROVE Protocol (Extend Intake with New T1s)

**Trigger:** `/pm improve <intake-item-link-or-identifier>` — intake item is between Done and Announced (inclusive) and needs additional work.

**Use cases:**
- PM QA failure — work is Done but doesn't meet standard
- Mid-flight extension — new context discovered, additional T1(s) needed alongside existing work
- Stakeholder feedback — post-announcement, stakeholder requests changes (PM decides: bundle here or new intake)

### Preconditions

1. Retrieve the intake item: `node scripts/plane-intake-get.js <IDENTIFIER-N>`
2. Verify state is **Done**, **Passed**, or **Announced**
   - If **Approved** or **Deployed** → stop: "This intake is already approved. Create a new intake instead."
   - If **Todo**, **Backlog**, or **In Progress** → stop: "This intake has active work. Use `/pm accept` to add T1s, or wait for current work to complete."
3. Read the intake's `## Tracking` section to see existing T1(s) and their state

### Process

1. **Require a reason** — the PM must explain why the intake is being improved. If not provided in the prompt, **ask**:
   - "What's not up to standard, or what new context needs to be addressed?"
   - This reason becomes the primary context for the new T1(s)

2. **Review existing T1s** — for each T1 in the tracking checklist:
   - Fetch via `plane-item-get.js` → read description, version doc link
   - Understand what was already delivered
   - This prevents the new T1 from duplicating completed work

3. **Determine scope of new work:**
   - What specifically needs to change or be added?
   - Which module(s) are affected? (may be same or different from original T1s)
   - Present proposed T1(s) to user with rationale

4. **Confirm with user**

5. **Execute** (if confirmed):

   a. **Create new T1(s)** via `plane-item-create.js`:
      - `--name`: `[vX.Y.Z | Module] Title` (standard T1 naming)
      - Description includes:
        - `Version: [Outline]({version_module_doc_url})`
        - `Intake: [{INTAKE-IDENT}]({intake_browse_url})`
        - `Improves: [{ORIGINAL-T1-IDENT}]({t1_browse_url})` (reference to the T1 being improved upon)
        - PM's reason / new context
      - `--state backlog`
      - `--priority`: from intake or user override
      - `--assignees`: from intake or user override
      - `--cycle`: current cycle
      - `--module`: target module

   b. **Update intake tracking checklist:**
      `node scripts/plane-intake-handling.js <INTAKE-ID> add <NEW-T1-ID> [<NEW-T1-ID> ...]`

   c. **Roll intake back to Todo:**
      `node scripts/plane-item-update.js <INTAKE-IDENT> --state todo`

### Output

```
Improve Complete
Intake: [IDENT] [title] → Todo (rolled back from [previous state])
Reason: [PM's reason summary]
New T1(s): [count] created ([IDENT-N, ...])
Tracking: [total T1s] T1s on intake ([completed] done, [new] pending)

Next: Run /pm [T1 link] to break down new T1(s) into tier 2 features.
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
9. **T1 terminal state is Done** — post-completion states (Passed, Announced, Approved, Deployed) belong to the intake item, not T1s
10. **Improve, don't revert** — never drag a T1 backward; create new T1(s) via IMPROVE protocol

---

<!-- Command version: 3.0 — Added IMPROVE protocol, post-completion states belong to intake not T1 -->
