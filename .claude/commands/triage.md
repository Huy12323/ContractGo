---
name: /triage
description: Technical scoping — read codebase, add technical context to an intake item
---

# Triage Command

**PM or Engineer role.** Read the codebase to produce a preliminary assessment of an intake item's technical impact and add codebase context to its description. This gives the manager a starting direction for the `/pm` ACCEPT routing decision — it is not a binding plan.

Always load `po` skill via `Skill("po")`.

**Pipeline:** `/intake` (PA creates item) → **`/triage`** (PM or engineer scopes) → `/pm` ACCEPT (manager routes)

---

## Input

```
/triage <intake-item-url>             → triage from Plane URL
/triage <intake-item-id>              → triage from intake item ID
/triage                               → list pending intake items, pick one
```

---

## Step 1: Load Intake Item

### From URL or ID

1. **Parse the input:**
   - **Intake URL** (contains `/intake/` and `inboxIssueId=`): extract the `inboxIssueId` query parameter — this is the intake item ID.
     Example: `https://plane.example.com/ws/projects/xxx/intake/?currentTab=open&inboxIssueId=ad9e796b-...` → ID is `ad9e796b-...`
   - **UUID**: use directly as the intake item ID.
2. Load MCP tool: `ToolSearch("select:mcp__{PLANE_MCP_SERVER}__retrieve_intake_work_item")`
3. Call `retrieve_intake_work_item` with the extracted intake item ID. **Do NOT use `retrieve_work_item`** — intake items require the intake-specific endpoint.
4. Read the description — check for existing "Intake Context" section (from PA `/intake`)

### From No Input (List Mode)

1. Load MCP tool: `ToolSearch("select:mcp__{PLANE_MCP_SERVER}__list_intake_work_items")`
2. List all pending intake items
3. Present summary to user — title, source, urgency (if Intake Context exists)
4. User selects one to triage

---

## Step 2: Understand the Request

Read the intake item's description:

- **If Intake Context exists** (created by `/intake` in PA): Read the Summary, Details, and Related Context sections. This provides full business context — who asked, why, urgency, background.
- **If no Intake Context** (manually submitted by ops staff): The description may be minimal. Work with what's available — title + any description provided.

Summarize your understanding of what's being requested and confirm with the user that you understand it correctly before proceeding.

---

## Step 3: Read Specifications for Context

Before diving into the codebase, read the project's **Specifications root doc** (Product Bible) from Outline for architectural context.

1. Extract `SPECIFICATIONS_DOC_ID` from the `po` skill constants
2. Load MCP tool: `ToolSearch("select:mcp__outline__read_document")`
3. Read the Specifications root doc — this contains: product vision, architecture overview, module map with cross-dependencies, user journeys
4. Use this to orient your codebase research — understand which modules exist, how they relate, and where this request likely fits

**This is independent context gathering** — even if the PA `/intake` read the same doc, you must form your own assessment based on the spec doc + actual codebase analysis. Never rely on assumptions from the Intake Context about which module is affected.

---

## Step 4: Codebase Research

Explore the codebase to assess technical impact. This is the step that only a project codebase agent can do — the PA cannot.

### Research Checklist

1. **Identify affected modules** — which Plane modules does this touch? Cross-reference your spec doc context with actual code structure.
2. **Find affected files** — routes, components, database schema, API endpoints, edge functions related to the request.
3. **Assess related modules** — does this change impact other modules? Check cross-module dependencies.
4. **Check existing work items** — are there active tier 1/2 items in the same area? Use `list_work_items` or `retrieve_work_item_by_identifier` to check for overlap.
5. **Identify complexity** — is this a simple config change, a moderate feature, or a cross-cutting concern? Consider the Fibonacci scale (1-8).
6. **Flag risks** — breaking changes, data migrations, auth implications, multi-repo impact.

### Load Skills

If the project has relevant skills (frontend, backend, database, etc.), load them to better understand patterns and conventions:

```bash
awk 'FNR<=10 && /^(name|description):/' .claude/skills/*/SKILL.md
```

---

## Step 5: Present Findings

Present the preliminary technical assessment to the user. This is the agent's best guess at what's involved — modules, files, and complexity may shift during actual implementation.

```
Triage Assessment: [intake item title]

Affected Module(s): [module names]
Affected Files: [key file paths]
Related Modules: [cross-module impacts, if any]
Existing Work: [overlapping tier 1/2 items, if any]
Complexity: [1-8 Fibonacci estimate with reasoning]
Risks: [breaking changes, migrations, auth, etc.]

Recommendation: [simple fix / new feature / needs breakdown / needs discussion]
```

**User confirms** the assessment is accurate before updating the intake item.

---

## Step 6: Update Intake Item Description

Append the Technical Context section to the intake item's description.

### Pull → Edit → Push

Use the intake get/update scripts — same pattern as all other description edits:

1. Pull the current description: `node scripts/plane-intake-get.js <IDENTIFIER-N>`
   - Saves description to `temp/plane/<IDENTIFIER-N>.html`
2. Read the HTML file with the Read tool
3. Edit the file with the Edit tool — replace the Technical Context placeholder with the full section (see format below)
4. Push the updated description: `node scripts/plane-intake-update.js <IDENTIFIER-N> --desc`

**Do NOT regenerate or rephrase existing content** — only replace the placeholder section.

### Technical Context Format

```html
<h2>Technical Context</h2>
<!-- Written by /triage in project codebase -->

<p><strong>Affected Module(s):</strong> [module names with Plane links if available]</p>
<p><strong>Complexity Estimate:</strong> [N] points — [one-line reasoning]</p>

<h3>Affected Areas</h3>
<ul>
<li>[file/component path] — [what it does, why it's affected]</li>
<li>[file/component path] — [what it does, why it's affected]</li>
</ul>

<h3>Related Modules</h3>
<ul>
<li>[Module Name] — [how it's related, impact of the change]</li>
</ul>

<h3>Existing Work Items</h3>
<ul>
<li>[IDENTIFIER-N] [title] ([state]) — [relationship to this request]</li>
</ul>

<h3>Technical Notes</h3>
<p>[Architecture considerations, data model changes, API impact, migration needs, risks, or anything the manager needs to know for the PM decision]</p>
```

**Preserve existing content.** Never replace the Intake Context section. The script handles this automatically; if using the MCP fallback, copy existing content verbatim.

---

## Step 7: Report

```
Triage Complete
Item: [title]
Module(s): [affected modules]
Complexity: [N] points
Link: [plane_url]

Next: Run /pm [item-url] to route this item to a module and version.
```

---

## Batch Mode

When triaging multiple intake items:

1. List all pending items
2. User selects which to triage (or "all")
3. Triage each sequentially — research, present, confirm, update
4. Report summary of all triaged items

---

## Re-Triaging Existing Items

When `/triage` is run on an intake item that already has a Technical Context section, it performs an **additive update** rather than a fresh triage:

1. Read the existing Technical Context
2. Research the codebase for the NEW scope (additional modules, changed files, etc.)
3. Present findings — clearly distinguish new findings from existing assessment
4. On confirmation, **append** to the Technical Context section (new Affected Areas, new Related Modules, updated Technical Notes)
5. Do NOT overwrite or regenerate the existing assessment — add to it

**When to use re-triage:**
- New modules are now involved that weren't in the original triage
- Scope has expanded and technical context needs updating
- Running before `/pm improve` to give the PM updated technical grounding
- After `/intake <existing-id>` appended new business context that changes technical scope

---

## Critical Rules

1. **ALWAYS research the codebase** — this is the whole point. The PA couldn't do this.
2. **Confirm understanding** before researching — make sure you know what's being asked
3. **Confirm assessment** before updating — user validates the technical findings
4. **Preserve Intake Context** — never overwrite Section 1
5. **Preserve existing Technical Context** — on re-triage, append new findings; never regenerate
6. **Check for existing work** — avoid duplicate effort
7. **Load project skills** — use codebase conventions to assess properly
8. **No implementation** — this is scoping only, not planning or coding

---

<!-- Command version: 1.8 — Added re-triage support for existing items (additive technical context updates) -->
