---
name: /rp
description: Cycle report — generate and publish cycle reports to Outline
---

# Cycle Report Command

**Reporting role.** Generate cycle reports from Plane data + Outline spec docs and publish to Outline. Reports only Done work — no in-progress or backlog items.

Always load `po` skill via `Skill("po")`.

**Cycle:** `/pm` (plan) → `/p` (implement) → `/s` (execute) → `/pp` (push) → `/rp` (report)

---

## Input

```
/rp                    → current cycle
/rp [YYYY/WW]         → specific cycle (e.g., 2026/09)
```

---

## Step 1: Extract Cycle Data

Run `plane-cycle-items.js` (see `po` skill → Plane Scripts for usage and details):

```bash
node scripts/plane-cycle-items.js [YYYY/WW]
```

Read the output file `cycles/YYYY-WW/cycle-report-data.md` to get the structured data.

---

## Step 2: Read Outline Spec + Version Docs

For each **Done tier 1 item** that has real work (not baseline-only):

1. Identify the module name from the tier 1 title: `[version | Module] Title`
2. Find the spec doc under `Specifications/` in Outline (use `search_documents`)
3. Read the spec doc → extract:
    - **Non-Technical Description** → stakeholder section content
    - **Technical Implementation** → technical section content
4. **Read the version doc** under `Versions/[vX.Y.Z]/[Module]` → extract per-T2 `### Media` sections. These contain Outline attachment URLs (screenshots and recordings) uploaded during `/pp`. Collect the markdown embeds keyed by T2 feature name for use in Step 3.

**Baseline modules** (catch-up with 0 tier 2 items): group into a brief summary, do not read individual spec docs.

**Namespace-only changes** (tier 2 is just a rename): group together, brief description.

---

## Step 3: Generate Report

Build the cycle report markdown with these sections:

### Report Structure

```markdown
# Cycle Report: YYYY/WW

> **Period:** [start_date] – [end_date]
> **Versions:** [list]
> **Completed:** [N] modules, [N] features, [N] story points

---

## Executive Summary

[3-5 sentence overview. What was delivered? Include total points and
top modules by points. Past tense.]

---

## Points Summary

**Total: [N] points** ([version breakdown if multiple])

| Module   | Features | Points |
| -------- | -------- | ------ |
| [Module] | [N]      | [N]    |

---

## What Was Delivered

### [Module Name] ([version]) — [N] features, [N] pts

[Non-Technical Description from spec doc. Present tense — what the
system does now.]

**Features completed:**

- **[Tier 2 feature name]** ([N] pts) _(originally [N] pts)_ ← only if reassessed

    [screenshot markdown from version doc Media section — reuse URL directly]

    [recording markdown from version doc Media section — reuse URL directly]

- **[Tier 2 feature name]** ([N] pts)

[Repeat for each Done module with real work. Order by points descending.
Include media embeds inline under each feature — the attachment URLs
from the version doc work across any Outline doc without re-uploading.]

### [Version] Baseline — [N] modules

[Brief note for retroactive baseline modules if present.]

---

## Technical Changes

### [Module Name]

[Technical Implementation section from spec doc. Include routes,
components, hooks, database tables, edge functions. Keep as-is from
spec — already concise.]

[Repeat for each Done module with real work.]

---

## Cycle Statistics

| Metric                  | Value                                                      |
| ----------------------- | ---------------------------------------------------------- |
| Modules completed       | [N]                                                        |
| Features completed      | [N]                                                        |
| Story points (final)    | [N]                                                        |
| Story points (original) | [N]                                                        |
| Estimation accuracy     | [N]% ← (original / final) × 100, only for reassessed items |
| Versions                | [list]                                                     |
```

### Grouping Rules

- **Major modules** (3+ tier 2 features): full section with description + features + technical
- **Minor modules** (1-2 tier 2, non-trivial): condensed section, still individual
- **Namespace/rename modules** (tier 2 is just rename): group all together under one heading
- **Baseline modules** (catch-up, 0 tier 2): single grouped paragraph

### Writing Style

- Non-technical sections: present tense, describe what the system does now
- Executive summary: past tense, describe what was accomplished
- Technical sections: use spec doc content directly (already in the right format)
- No speculation or roadmap language — report only what is Done
- Always include points alongside feature counts

---

## Step 4: Publish to Outline

1. Check if cycle doc already exists under `CYCLES_DOC_ID` (from `po` skill)
    - Use `search_documents` to check
2. If exists → `update_document` with new content
3. If not → `create_document`:
    - `title`: `YYYY/WW` (e.g., `2026/09`)
    - `parent_document_id`: CYCLES_DOC_ID (from `po` skill)
    - `collection_id`: COLLECTION_ID (from `po` skill)
    - `text`: full report markdown
    - `publish`: `true`

---

## Step 5: Update Cycles Parent Doc

Read the Cycles parent doc and append a row to the summary table:

```markdown
# Cycles

Cycle reports — weekly summaries of completed work.

| Cycle   | Period                | Versions | Points | Modules | Features | Report               |
| ------- | --------------------- | -------- | ------ | ------- | -------- | -------------------- |
| YYYY/WW | Mon DD – Mon DD, YYYY | vX.Y.Z   | [N]    | [N]     | [N]      | [View](outline_link) |
```

---

## Output

```
Cycle Report: YYYY/WW
Points: [N] | Modules: [N] | Features: [N]
Published: [outline_url]
```

---

## Critical Rules

1. **Script first** — always run `plane-cycle-items.js` before reading spec docs
2. **Spec docs are source of truth** — do not rewrite or embellish, use their content
3. **Done only** — no in-progress, backlog, or todo items in the report
4. **Points always shown** — every feature listing includes its estimate points
5. **Group minor work** — baselines and renames get grouped, not individual sections
6. **No code cross-checking** — trust spec docs (already verified by `/pp`)
7. **Idempotent** — running `/rp` twice for same cycle updates the existing doc
8. **Media inline** — if version docs contain `### Media` sections with attachment URLs, include them inline under each feature in "What Was Delivered". Reuse the same Outline attachment URLs — no re-uploading needed

---

<!-- Command version: 1.2 — Media inline: pull attachment URLs from version docs into cycle reports -->
