---
name: /pp
description: Push + condense — push tier 3+4 to Plane, auto-condense spec on Outline
---

# Push + Condense Command

Push completed implementation to **Plane** (tier 3+4 work items) and **auto-condense** the spec on **Outline**.

Always load `po` skill via `Skill("po")`.

**Cycle:** `/pm` (plan features) → `/p` (plan implementation) → `/s` (execute) → `/pp` (push + condense)

---

## Input

```
/pp [plan file path]     → Push from plan file
```

Read plan file → parse header (work item ID, module, spec link) + phases/tasks.

---

## Preconditions

- All tasks in plan file should be marked `[x]` (implementation complete)
- If unchecked tasks remain, warn user and ask whether to proceed or finish first
- Run `node scripts/plane-item-get.js {PROJECT_IDENTIFIER}-{N}` for tier 2 → verify requirements from saved description file, note cycle UUID and module UUID from output

---

## Step 1: Deep Research (HARD GATE)

**You MUST complete this step before proceeding. No exceptions.**

- Read every file listed in the plan file's `Tech:` context line
- Verify implementation matches the phases/tasks described
- For each phase: confirm the code path exists and works

```
Research Complete
Files: [found]/[listed] | Phases: [verified]/[total]
Discrepancies: [count]
[List each discrepancy if count > 0]
```

**Minor differences (code wins):** Renamed files, extra features, different patterns.

**Major contradictions (ask user):** Feature not implemented, fundamentally different approach.

---

## Step 2: Create Work Items on Plane

**Create tier 3 (phases) and tier 4 (tasks) — all in Done state.**

**Use `plane-item-create.js`** for all work item creation. This avoids MCP cascade failures and pydantic validation errors. The script returns `Created: {PROJECT_IDENTIFIER}-N (uuid)` — capture both for the plan file and for setting parent on child items.

**UUID resolution:** The tier 2 UUID comes from `plane-item-get.js` output (Preconditions). If resuming a partial run where some identifiers already exist in the plan file's Plane IDs section, run `plane-item-get.js` on those identifiers to get their UUIDs.

**Description for tier 3/4:** Write the description HTML to a temp file, then reference it via `--desc-file`:

```bash
# Write description to temp file
echo '<p>Version: <a href="...">Outline</a></p><p>Phase summary here</p>' > temp/plane/new-item.html

# Create with all fields in one call
node scripts/plane-item-create.js \
  --name "[Module | vX.Y.Z] Feature > Phase A - Name" \
  --state done --parent {PROJECT_IDENTIFIER}-{T2} \
  --desc-file temp/plane/new-item.html \
  --priority medium --assignees <uuid> \
  --start 2026-03-01 --due 2026-03-07 \
  --add-to-cycle <cycle-uuid> --add-to-module <module-uuid>
```

For each phase in plan file:

1. **Create tier 3** (phase) via `plane-item-create.js`:
    - `--name`: `[Module | version] Feature > Phase [X] - [Name]`
    - `--state done`
    - `--parent {PROJECT_IDENTIFIER}-{T2}` (resolves identifier to UUID)
    - `--desc-file`: temp file with `Version: [Outline]({version_doc_url})\n\n{phase summary}`
    - Clone from tier 2: `--priority`, `--start`, `--due`, `--assignees`, `--add-to-cycle`, `--add-to-module`

2. **Write identifier to plan file immediately** — update the plan file's Plane IDs section with the tier 3 identifier right after creation, before creating its tier 4 children. This ensures recoverability if the session is interrupted.

3. **Create tier 4** (tasks) under each tier 3 via `plane-item-create.js`:
    - `--name`: `[Module | version] Feature > Phase [X] > [Task]`
    - `--state done`
    - `--parent {PROJECT_IDENTIFIER}-{T3}` (the tier 3 identifier just created)
    - `--desc-file`: temp file with `Version: [Outline]({version_doc_url})\n\n{task description}`
    - Clone same properties from tier 2
    - Write each tier 4 identifier to plan file immediately after creation

---

## Step 3: Estimate Reassessment

**Always compare actual work against the tier 2 estimate.** Use the same Fibonacci scale and estimation rules as `/pm`:

| Points | Complexity | What it touches |
|--------|-----------|-----------------|
| 1 | Single concern | One file, one table, or one component |
| 2 | Two connected concerns | Backend + frontend, or new route with simple page |
| 3 | One end-to-end slice | New table + RLS + edge function + component |
| 5 | Multiple coordinated slices | Schema + RLS + edge functions + route + multiple components |
| 8 | Cross-cutting or high-uncertainty | Auth, middleware, multiple routes, new patterns |

1. Count actual phases, tasks, files changed, and distinct concerns
2. Apply the estimation rules: count concerns, assess debug risk, assess novelty
3. Present comparison to user:

```
Estimate check: {ID}-N estimated [N] points
Actual: [N] phases, [N] tasks, [N] files, [N] concerns → suggests [N] points
Update estimate? [keep N / update to N]
```

4. **User decides** — never silently override

**If user approves update:**
- Edit `temp/plane/{PROJECT_IDENTIFIER}-{N}.html` to append `Original Estimate: [N] points`
- Run: `node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --desc --estimate {new_value}`

**If user keeps original:** No changes needed.

---

## Step 4: Mark Tier 2 Done

```bash
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --state done
```

---

## Step 5: Auto-Condense Spec on Outline

**Rewrite the module spec doc (under Specifications/) to reflect current state.**

Spec docs must stay concise — agents read these and context limits matter.

Use pull → Edit → push workflow (see `po` skill → Outline Scripts):

```bash
node scripts/outline-pull.js <spec-doc-id>     # pull to temp/outline/<uuid>.md
```

1. Read the pulled file with Read tool
2. **Rewrite Non-Technical Description** — Edit tool to replace with current behavior (not append). 2-4 sentences + capability bullets reflecting what exists NOW after this tier 2's changes
3. **Rewrite Technical Implementation** — Edit tool to replace with current files, components, schema. Include changes from this tier 2's implementation alongside what already existed
4. **Append** to Version History (one line only) via Edit tool:
    - `- [vX.Y.Z](version_doc_link) — one-line summary`

```bash
node scripts/outline-push.js temp/outline/<uuid>.md   # push back to Outline
```

---

## Step 6: Create/Update Version Doc on Outline

At `Versions/[vX.Y.Z]/[Module]`:

**Version doc was created by `/pm` with context sections** (rationale, scope, Figma refs, affected files, design decisions). `/pp` must **preserve these sections and append implementation details below them**.

**If version doc exists with `/pm` context** (expected case):

Use pull → Edit → push workflow:

```bash
node scripts/outline-pull.js <version-doc-id>
```

1. Read the pulled file — it has context from `/pm`
2. Append feature implementation section below the existing content via Edit tool:

```markdown
## [Feature Name]

### Summary

- [3-5 bullets of what was implemented]

### Implementation

[Phases and tasks with identifier links]

### Files Changed

[List of new/modified files]
```

3. Push back — never replace `/pm` context sections:

```bash
node scripts/outline-push.js temp/outline/<uuid>.md
```

**If version doc doesn't exist** (edge case — `/pm` didn't create it):

1. Find or create version parent doc (e.g., `Versions/v1.0.0/`) under VERSIONS_DOC_ID
2. Create module version doc with nav links + implementation section. Use the full Plane module name as the doc title, flat under the version doc (not nested): `Versions/v3.0.0/3D Scene: Canvas`

---

## Step 7: Auto-Complete Tier 1

Check if ALL tier 2 items under the same tier 1 parent are Done or Cancelled. A tier 1 is complete when every tier 2 child has reached a terminal state (Done or Cancelled).

Run `plane-work-items.js` to get sibling status (see `po` skill → Plane Scripts). Pass `--cycle` from the tier 1's Plane cycle (read from tier 2's parent):

```bash
node scripts/plane-work-items.js {PROJECT_IDENTIFIER}-{N} --cycle {YYYY/WW}
```

Read output file → check "All Complete" field.

1. If all are Done or Cancelled:
    - Mark tier 1 as Done: `node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --state done`
    - **Tick intake tracking checklist** — run `node scripts/plane-intake-handling.js <INTAKE-ID> tick <T1-ID>` to check off this T1 on any linked intake item. The script reads the intake's `## Tracking` section, ticks the T1's checkbox, and reports completion status. If all T1s on the intake are now checked, the script outputs "All complete" — in that case, mark intake item as Done via `node scripts/plane-item-update.js <INTAKE-IDENT> --state done`.
      - **Finding the intake item:** The T1's SPARK-N appears in tracking sections of intake items. Check the Intakes module (`INTAKES_MODULE_ID` from `project-config.json`) for items whose description contains this T1's identifier. Use MCP `list_work_items` filtered by the Intakes module, then search descriptions for the T1's SPARK-N.
    - Update Plane module status to `completed` and `target_date` to today (MCP `update_module`)
    - **Proceed to Step 8 (Bible Review)**
2. If not all complete:
    - Report: `Tier 1: [N] of [M] tier 2 complete ([D] Done, [C] Cancelled)`
    - Skip Step 8

---

## Step 8: Bible Review (Version Seal Only)

**Only triggered when Step 7 marks a tier 1 as Done** (version sealed). Skip this step if tier 1 is still in progress.

Use pull → Edit → push workflow:

```bash
node scripts/outline-pull.js bible
```

1. Read the pulled Bible file
2. Review whether the completed version introduced:
    - New modules not yet in the Module Map
    - Changed user journeys or workflows
    - Altered cross-module relationships
    - Shifted product scope or capabilities
3. If any changes apply: Edit tool to update only the affected sections (Product Vision, Architecture Overview, Module Map, or User Journeys)
4. This is a **targeted review**, not a full rewrite — only update what the sealed version changed

```bash
node scripts/outline-push.js temp/outline/<uuid>.md
```

---

## Output

```
Published
Work Items: [X] tier 3 + [Y] tier 4 created (Done)
Tier 2: [{ID}-N] marked Done | Cycle: [YYYY/WW]
Spec updated: [module name]
Version doc: [created/updated] at Versions/[vX.Y.Z]/[Module]
Tier 1: [Done | N of M tier 2 complete]
Bible: [updated — sections changed / no update needed / tier 1 still in progress]
```

---

## Critical Rules

1. **ALWAYS deep research (HARD GATE)** — verify implementation before publishing
2. **CODE WINS** for minor discrepancies
3. **ASK** for major contradictions
4. **All tier 3+4 in Done state** — implementation already complete
5. **Clone properties from tier 2** — priority, dates, cycle, module, assignees
6. **Rewrite spec doc** — both Non-Technical and Technical sections reflect current state (not append)
7. **Version doc accumulates** — each tier 2 adds a section, not a new doc
8. **Reassess estimate** — always compare actual work against tier 2 estimate, user decides
9. **Auto-complete tier 1** — check sibling tier 2s after every push; Done + Cancelled both count as complete
10. **Bible review on version seal** — when tier 1 → Done, review and update Product Bible (Specifications root doc) for any changed sections
11. **Incremental writes** — write identifier to plan file after each tier 3/4 creation, not deferred
12. **Identifiers over UUID** — plan files store project identifiers (e.g., `SPARK-504`), not UUIDs. Resolve to UUID on demand via `retrieve_work_item_by_identifier`

---

<!-- Command version: 3.0 — Script-first: use plane-item-create.js for T3/T4, plane-item-update.js for state changes, plane-item-get.js for reads -->
