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
/pp [plan]                              → Push from plan file
/pp [plan] [MM] [Nre|reN] [Nsc|scN]    → + upload media (all optional, any order)
```

**Examples:**

| Input | Meaning |
|---|---|
| `/pp plan` | No media |
| `/pp plan re` | 1 latest recording, no time filter |
| `/pp plan 5 2re` | 2 latest recordings not older than :05 |
| `/pp plan sc3` | 3 latest screenshots, no time filter |
| `/pp plan 10 re2 3sc` | 2 recordings + 3 screenshots not older than :10 |

Read plan file → parse header (work item ID, module, spec link) + phases/tasks.

### Media argument parsing

All media tokens are optional and can appear in any order after the plan file path.

- **`MM`** — standalone number (not attached to `re`/`sc`). Clock minute floor — filters to files with timestamp at or after the most recent occurrence of `:MM`. If MM > current minute of the hour, it refers to the previous hour. If omitted, no time filter — just get the absolute latest file(s).
  - Example: current time 17:08, `MM=5` → filter to files >= 17:05
  - Example: current time 17:08, `MM=50` → filter to files >= 16:50
  - Example: current time 17:08, `MM=10` → filter to files >= 16:10 (10 > 08, so previous hour)
- **`Nre` or `reN`** — recording count. Number before OR after `re`. No number = count 1. **Reject if numbers on both sides** (e.g., `2re5` is invalid — stop and tell user).
- **`Nsc` or `scN`** — screenshot count. Same rules as recording.

---

## Media Collection (if `re` or `sc` provided)

**Env vars required:** `BIBLE_RECORDINGS_DIR`, `BIBLE_SCREENSHOTS_DIR` in root `.env`. If missing, **STOP and ask the user** for the directory path, then append to `.env` before proceeding.

### Validation

**Reject immediately** if a media token has numbers on both sides of the code (e.g., `2re5`, `3sc1`). Stop and tell the user the format is invalid — count goes on one side only.

### Finding files

Parse timestamps from filenames:

- Recordings: `Screen Recording YYYY-MM-DD HHMMSS.mp4` in `BIBLE_RECORDINGS_DIR`
- Screenshots: `Screenshot YYYY-MM-DD HHMMSS.png` in `BIBLE_SCREENSHOTS_DIR`

**Time filter (if MM provided):** Compute the floor timestamp — the most recent clock time where the minute equals MM. If MM > current minute, use the previous hour. Filter to files whose parsed timestamp >= floor timestamp.

**No MM:** No time filter — consider all files.

**Sort** all matching files by timestamp descending, then take the **N latest** (where N = count from the media token, default 1). If fewer than N files match, take all that match and warn the user.

### Uploading

Use `outline-upload.js` to upload **each** file to the version doc:

```bash
node scripts/outline-upload.js "<file-path>" --doc <version-doc-uuid>
```

The script auto-detects video dimensions via `ffprobe` and includes `WxH` in the markdown link text (required for Outline's inline video player). Capture the `MARKDOWN=` output line from each upload — these are the embed syntax lines to insert in Step 6.

**Hold the markdown embeds** — they are inserted during Step 6 (Version Doc), grouped under the T2's section.

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

**Description for tier 3/4:** Write the description HTML to a temp file (named by parent T2 identifier to avoid collisions) using the **Write tool** (never `echo`/`cat` in Bash), then reference it via `--desc-file`:

```
# Write tool → temp/plane/{PROJECT_IDENTIFIER}-{T2}.html
<p>Version: <a href="...">Outline</a></p><p>Phase summary here</p>

# Then create with all fields in one call
node scripts/plane-item-create.js \
  --name "[vX.Y.Z | Module] Title > Feature > Phase A - Name" \
  --state done --parent {PROJECT_IDENTIFIER}-{T2} \
  --desc-file temp/plane/{PROJECT_IDENTIFIER}-{T2}.html \
  --priority medium --assignees <uuid> \
  --start 2026-03-01 --due 2026-03-07 \
  --add-to-cycle <cycle-uuid> --add-to-module <module-uuid>
```

For each phase in plan file:

1. **Create tier 3** (phase) via `plane-item-create.js`:
    - `--name`: `[version | Module] T1 Title > Feature > Phase [X] - [Name]`
    - `--state done`
    - `--parent {PROJECT_IDENTIFIER}-{T2}` (resolves identifier to UUID)
    - `--desc-file`: temp file with `Version: [Outline]({version_doc_url})\n\n{phase summary}`
    - Clone from tier 2: `--priority`, `--start`, `--due`, `--assignees`, `--add-to-cycle`, `--add-to-module`

2. **Write identifier to plan file immediately** — update the plan file's Plane IDs section with the tier 3 identifier right after creation, before creating its tier 4 children. This ensures recoverability if the session is interrupted.

3. **Create tier 4** (tasks) under each tier 3 via `plane-item-create.js`:
    - `--name`: `[version | Module] T1 Title > Feature > Phase [X] > [Task]`
    - `--state done`
    - `--parent {PROJECT_IDENTIFIER}-{T3}` (the tier 3 identifier just created)
    - `--desc-file`: temp file with `Version: [Outline]({version_doc_url})\n\n{task description}`
    - Clone same properties from tier 2
    - Write each tier 4 identifier to plan file immediately after creation

---

## Step 3: Estimate Reassessment

**Always compare actual work against the tier 2 estimate.** Use the same Fibonacci scale and estimation rules as `/pm`:

| Points | Complexity                        | What it touches                                             |
| ------ | --------------------------------- | ----------------------------------------------------------- |
| 1      | Single concern                    | One file, one table, or one component                       |
| 2      | Two connected concerns            | Backend + frontend, or new route with simple page           |
| 3      | One end-to-end slice              | New table + RLS + edge function + component                 |
| 5      | Multiple coordinated slices       | Schema + RLS + edge functions + route + multiple components |
| 8      | Cross-cutting or high-uncertainty | Auth, middleware, multiple routes, new patterns             |

1. Count actual phases, tasks, files changed, and distinct concerns
2. Apply the estimation rules: count concerns, assess debug risk, assess novelty
3. Announce the result — **no user prompt, just inform and proceed**:

**If estimate changes:**

```
Estimate: {ID}-N was [N] points → adjusted to [N] points
Actual: [N] phases, [N] tasks, [N] files, [N] concerns
([one-line rationale for the change])
```

- Edit `temp/plane/{PROJECT_IDENTIFIER}-{N}.html` to append `Original Estimate: [N] points`
- Run: `node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --desc --estimate {new_value}`

**If estimate matches:**

```
Estimate confirmed: {ID}-N at [N] points
Actual: [N] phases, [N] tasks, [N] files, [N] concerns
```

- No changes needed.

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

### Media

[screenshot markdown embed from Media Collection step]

[recording markdown embed from Media Collection step]

### Implementation

[Phases and tasks with identifier links]

### Files Changed

[List of new/modified files]
```

**Media subsection:** Only include `### Media` if `re` or `sc` args were provided and files were successfully uploaded. Each embed is the `MARKDOWN=` output from `outline-upload.js`. Screenshots render inline as images; recordings render with Outline's video player (dimensions in link text).

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
        - **Finding the intake item:** Read the T1's description — if it contains an `Intake: [PROJ-N](url)` line, extract the intake identifier. Use that identifier to run the tick command. If no Intake line exists, the T1 was not created from an intake item — skip.
    - **Roadmap feature cascade** — if T1 description contains `Roadmap Feature: [Title](outline_url)` (planned work from roadmap, not intake):
        1. Pull the **feature doc** from Outline using the URL
        2. Read the `## T1s` section — list all T1 identifiers
        3. Check if ALL listed T1s are Done on Plane (via `plane-item-get.js` for any not already known)
        4. If ALL T1s Done → feature is complete. Cascade upward:
           a. Pull the **parent module doc** (roadmap) — the feature doc's parent in Outline
           b. Find this feature's checkbox line → change `- [ ]` to `- [x]`
           c. Check if ALL feature checkboxes in the module doc are now `[x]`
           d. If ALL features checked → module is complete:
              - Pull the **parent version doc** (roadmap) — the module doc's parent in Outline
              - Find this module's checkbox line → change `- [ ]` to `- [x]`
              - Update the module's count display (e.g., `3/3`)
              - Check if ALL module checkboxes in the version doc are now `[x]`
              - If ALL modules checked → version is complete:
                - Pull the **roadmap root doc** — the version doc's parent in Outline
                - Find this version's checkbox line → change `- [ ]` to `- [x]`
                - Push roadmap root doc
              - Push version doc
           e. Push module doc
        5. If NOT all T1s Done → do nothing (feature not complete yet). The cascade only fires when the feature is fully done.
        - **Note:** Use pull → Edit → push for each Outline doc. Process bottom-up: module doc first, then version doc, then root. Each push is independent.
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
8. **Reassess estimate** — always compare actual work against tier 2 estimate, announce and apply (no user prompt)
9. **Auto-complete tier 1** — check sibling tier 2s after every push; Done + Cancelled both count as complete
10. **Bible review on version seal** — when tier 1 → Done, review and update Product Bible (Specifications root doc) for any changed sections
11. **Incremental writes** — write identifier to plan file after each tier 3/4 creation, not deferred
12. **Identifiers over UUID** — plan files store project identifiers (e.g., `SPARK-504`), not UUIDs. Resolve to UUID on demand via `retrieve_work_item_by_identifier`
13. **Media is optional** — `re`/`sc` args are opt-in. Without them, /pp works exactly as before
14. **Env guard for media** — if `re`/`sc` provided but `BIBLE_RECORDINGS_DIR`/`BIBLE_SCREENSHOTS_DIR` missing from `.env`, STOP and ask user for the path before proceeding
15. **Reject dual-count** — `2re5`, `3sc1`, etc. (numbers on both sides of `re`/`sc`) are invalid. Stop and tell the user.
16. **MM = clock minute floor** — MM is the minute-of-the-hour, not a duration. Compute the most recent clock time with that minute. If MM > current minute, it's the previous hour.

---

<!-- Command version: 3.3 — Media count syntax (xrex/xscx), MM = clock minute floor not duration, multi-file upload -->
