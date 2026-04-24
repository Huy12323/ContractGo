---
name: /pp
description: Push + condense — sync plan file into T2 description, append to version doc, rewrite spec on T1 seal
---

# Push + Condense Command

Push completed implementation to **Plane** (T2 description only — no T3/T4) and append a section to the version doc on **Outline**. On T1 seal, also rewrite the module spec and trigger Bible review.

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

Read plan file → parse header (work item ID, module, version doc link) + phases/tasks.

### Media argument parsing

All media tokens are optional and can appear in any order after the plan file path.

- **`MM`** — standalone number (not attached to `re`/`sc`). Clock minute floor — filters to files with timestamp at or after the most recent occurrence of `:MM`. If MM > current minute of the hour, it refers to the previous hour. If omitted, no time filter — just get the absolute latest file(s).
    - Example: current time 17:08, `MM=5` → filter to files >= 17:05
    - Example: current time 17:08, `MM=50` → filter to files >= 16:50
    - Example: current time 17:08, `MM=10` → filter to files >= 16:10 (10 > 08, so previous hour)
- **`Nre` or `reN`** — recording count. Number before OR after `re`. No number = count 1. **Reject if numbers on both sides** (e.g., `2re5` is invalid — stop and tell user).
- **`Nsc` or `scN`** — screenshot count. Same rules as recording.

---

## Media File Resolution (IMMEDIATE — if `re` or `sc` provided)

**Run FIRST, before Preconditions.** Lock in file paths immediately after parsing arguments. During deep research and T2 push, new screenshots/recordings from concurrent feature work may appear in the media directories. Resolving paths now ensures only this feature's media is captured.

**Env vars required:** `BIBLE_RECORDINGS_DIR`, `BIBLE_SCREENSHOTS_DIR` in root `.env`. If missing, **STOP and ask the user** for the directory path, then append to `.env` before proceeding.

### Validation

**Reject immediately** if a media token has numbers on both sides of the code (e.g., `2re5`, `3sc1`). Stop and tell the user the format is invalid — count goes on one side only.

### Resolving file paths

Parse timestamps from filenames:

- Recordings: `Screen Recording YYYY-MM-DD HHMMSS.mp4` in `BIBLE_RECORDINGS_DIR`
- Screenshots: `Screenshot YYYY-MM-DD HHMMSS.png` in `BIBLE_SCREENSHOTS_DIR`

**Time filter (if MM provided):** Compute the floor timestamp — the most recent clock time where the minute equals MM. If MM > current minute, use the previous hour. Filter to files whose parsed timestamp >= floor timestamp.

**No MM:** No time filter — consider all files.

**Sort** all matching files by timestamp descending, then take the **N latest** (where N = count from the media token, default 1). If fewer than N files match, take all that match and warn the user.

**Store the resolved file paths** — do not upload yet. Uploading happens in Step 5 (Version Doc).

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

**Minor differences (code wins):** Renamed files, extra features, different patterns — record in the plan file's phase narrative or Decisions section before push.

**Major contradictions (ask user):** Feature not implemented, fundamentally different approach.

---

## Step 2: Estimate Reassessment

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

- Append `Original Estimate: [N] points` to the end of the plan file's `## Decisions` section (so it flows into the T2 description body in Step 3)
- Run: `node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --estimate {new_value}` (description is pushed in Step 3)

**If estimate matches:**

```
Estimate confirmed: {ID}-N at [N] points
Actual: [N] phases, [N] tasks, [N] files, [N] concerns
```

- No changes needed.

---

## Step 3: Sync Plan File → T2 Description on Plane

The plan file body is already the future T2 description body (per `/p` convention). `/pp` strips the `## Context` section, converts markdown → HTML, and PATCHes the T2 description.

```bash
# Convert plan file → T2 description HTML. Strips ## Context, runs MD→HTML,
# writes to temp/plane/{T2-IDENT}.html, prints the output path.
node scripts/plan-to-plane-desc.js cycles/[YYYY-WW]/[module]/[T1-IDENT]/[T2-IDENT]-[slug].md

# Push the generated HTML to the T2 description.
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{T2-N} --desc-file temp/plane/{T2-IDENT}.html
```

After this step, the Plane T2 description = plan file content minus Context. Any sibling agent reading Plane sees Requirements + Scope boundaries + Decisions + Implementation (phase narratives + task checkboxes) identical to what plan-file-reading agents see locally.

---

## Step 4: Mark Tier 2 Done

```bash
node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --state done
```

---

## Step 5: Append T2 Section to Version Doc on Outline

At `Versions/[vX.Y.Z]/[Module]`:

The version doc was created by `/pm` with context sections (rationale, scope, Figma refs, affected files, Planning Decisions). `/pp` appends a per-T2 implementation section below them — never replaces existing content.

**Upload any resolved media first** (from Media File Resolution above):

```bash
node scripts/outline-upload.js "<file-path>" --doc <version-doc-uuid>
```

Capture the `MARKDOWN=` output line from each upload — these are the embed syntax lines for the Media subsection.

**Pull, append, push:**

```bash
node scripts/outline-pull.js <version-doc-id>
```

Append via Edit tool at the end of the pulled doc:

```markdown
## [Feature Name] ({PROJECT_IDENTIFIER}-{T2-N})

### Summary

- [3-5 bullets of what was implemented]

### Media

[screenshot markdown embed]

[recording markdown embed]

### Implementation

**Phase A — [Phase Name]**
- [task name]
- [task name]

**Phase B — [Phase Name]**
- [task name]
- [task name]
```

**Media subsection:** Only include `### Media` if `re` or `sc` args were provided and files were successfully uploaded. Each embed is the `MARKDOWN=` output from `outline-upload.js`. Screenshots render inline as images; recordings render with Outline's video player.

**Implementation subsection:** phase headings + task names only, no Plane identifier links (T3/T4 don't exist). For the full phase narrative + decisions + requirements, a reader follows the `{PROJECT_IDENTIFIER}-{T2-N}` link in the section heading to the Plane T2.

**No `### Files Changed` subsection** — files are documented in the module's spec doc Technical Implementation section (rewritten on T1 seal). Duplicating here is noise.

Push back:

```bash
node scripts/outline-push.js temp/outline/<uuid>.md
```

---

## Step 6: Auto-Complete Tier 1

Check if ALL tier 2 items under the same tier 1 parent are Done or Cancelled. A tier 1 is complete when every tier 2 child has reached a terminal state (Done or Cancelled).

Run `plane-work-items.js` to get sibling status (see `po` skill → Plane Scripts). Pass `--cycle` from the tier 1's Plane cycle (read from tier 2's parent):

```bash
node scripts/plane-work-items.js {PROJECT_IDENTIFIER}-{N} --cycle {YYYY/WW}
```

Read output file → check "All Complete" field.

1. **If all are Done or Cancelled (T1 sealed):**
    - Mark tier 1 as Done: `node scripts/plane-item-update.js {PROJECT_IDENTIFIER}-{N} --state done`
    - **Tick intake tracking checklist** — run `node scripts/plane-intake-handling.js <INTAKE-ID> tick <T1-ID>` to check off this T1 on any linked intake item. If all T1s on the intake are now checked, the script outputs "All complete" — in that case, mark intake item as Done via `node scripts/plane-item-update.js <INTAKE-IDENT> --state done`.
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
    - **Proceed to Step 7 (Spec Rewrite) and Step 8 (Bible Review)**

2. **If not all complete:**
    - Report: `Tier 1: [N] of [M] tier 2 complete ([D] Done, [C] Cancelled)`
    - **Skip Step 7 and Step 8** — spec rewrite and Bible review are T1-seal-only work.

---

## Step 7: Spec Rewrite on T1 Seal

**Only triggered when Step 6 marks a tier 1 as Done.** Skip if T1 still in progress.

Rewrite the module spec doc (under `Specifications/`) to reflect current state after this version's completed work. This is the ONE moment where spec rewrites happen — not per-T2.

Use pull → Edit → push workflow (see `po` skill → Outline Scripts):

```bash
node scripts/outline-pull.js <spec-doc-id>
```

1. Read the pulled file with Read tool
2. **Rewrite Non-Technical Description** — Edit tool to replace with current behavior. 2-4 sentences + capability bullets reflecting what exists NOW after this tier 1's changes. Include **Users** line. Include **Known Issues / Feature Requests** for inherited/maintenance systems.
3. **Rewrite Technical Implementation** — Edit tool to replace with current files, components, schema, related modules. Roll in every T2 from this T1. Include **Known Issues** for legacy debt.
4. **Append** to Version History (one line only) via Edit tool:
    - `- [vX.Y.Z](version_doc_link) — one-line summary`

```bash
node scripts/outline-push.js temp/outline/<uuid>.md
```

---

## Step 8: Bible Review (T1 Seal Only)

**Only triggered when Step 6 marks a tier 1 as Done.** Skip if T1 still in progress.

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
Tier 2: [{ID}-N] marked Done | Cycle: [YYYY/WW]
T2 description: synced from plan file (minus Context)
Version doc: [Feature Name] section appended to Versions/[vX.Y.Z]/[Module]
Tier 1: [Done | N of M tier 2 complete]
Spec: [rewritten on T1 seal | deferred — T1 still in progress]
Bible: [updated — sections changed | no update needed | T1 still in progress]
```

---

## Critical Rules

1. **ALWAYS deep research (HARD GATE)** — verify implementation before publishing
2. **CODE WINS** for minor discrepancies — update the plan file's phase narrative / Decisions before Step 3 push
3. **ASK** for major contradictions
4. **No T3/T4 work items** — phase/task detail lives in the T2 description body (1:1 with plan file minus Context)
5. **Plan file body ↔ T2 description body are 1:1** — `plan-to-plane-desc.js` is the one-way sync (plan file → T2 on Plane, strip Context, MD→HTML)
6. **Spec rewrite on T1 seal only** — per-T2 `/pp` does NOT touch the spec doc; that's concentrated in Step 7 when the final state is known
7. **Version doc accumulates** — each tier 2 adds a section, not a new doc
8. **No `### Files Changed` in version doc** — files live in the spec doc Technical Implementation section instead (rewritten on seal)
9. **Reassess estimate** — always compare actual work against tier 2 estimate, announce and apply (no user prompt)
10. **Auto-complete tier 1** — check sibling tier 2s after every push; Done + Cancelled both count as complete
11. **Bible review on T1 seal** — review and update Product Bible (Specifications root doc) for any changed sections
12. **Media is optional** — `re`/`sc` args are opt-in. Without them, `/pp` skips the Media File Resolution + Step 5 `### Media` subsection
13. **Env guard for media** — if `re`/`sc` provided but `BIBLE_RECORDINGS_DIR`/`BIBLE_SCREENSHOTS_DIR` missing from `.env`, STOP and ask user for the path before proceeding
14. **Reject dual-count** — `2re5`, `3sc1`, etc. (numbers on both sides of `re`/`sc`) are invalid. Stop and tell the user.
15. **MM = clock minute floor** — MM is the minute-of-the-hour, not a duration. Compute the most recent clock time with that minute. If MM > current minute, it's the previous hour.

---

<!-- Command version: 4.0 — T3/T4 removed. Plan file → T2 description sync via plan-to-plane-desc.js (strips Context, MD→HTML). Spec rewrite moved to T1 seal only. Files Changed section removed from version doc. Per-T2 /pp drops from ~50 API calls to ~6. -->
