---
name: /intake
description: Create a Plane intake item with business context — designed for personal assistant context
---

# Intake Command

**Personal assistant role.** Capture a request and create a Plane intake item with all available business context. This command is designed to be run from a **personal assistant codebase** (not a project codebase) where the agent has access to communications (email, chat, meetings) and organizational memory, but NOT the project source code.

Always load `po` skill via `Skill("po")`.

---

## Why This Command Exists

The intake command is part of a **cross-system handoff** between the personal assistant and the project codebase:

```
PA: /intake → Plane intake item with "Intake Context" (business context)
       ↓
Codebase: /triage → adds "Technical Context" (codebase analysis)
       ↓
Codebase: /pm ACCEPT → routes to module/version/tier
```

The PA can read emails, messages, and organizational memory — but has no access to the project source code. The project codebase agent can read code and technical architecture — but has no access to communications. The Plane intake item bridges the two by carrying context between systems.

---

## Input

```
/intake <description>                     → auto-detect project from context
/intake <project-slug> <description>      → explicit project
```

---

## Process

### 1. Identify Target Project

Match the request to the correct Plane project using conversation context, topic keywords, or explicit user input.

Load project constants from `po` skill.

If ambiguous, **ask the user**.

### 2. Read Specifications for Context

Before gathering context, read the project's **Specifications root doc** (Product Bible) from Outline for general understanding of the codebase, its modules, architecture, and terminology.

1. Extract `SPECIFICATIONS_DOC_ID` from the project constants (loaded via `po` skill)
2. Load MCP tool: `ToolSearch("select:mcp__outline__read_document")`
3. Read the Specifications root doc — this is the Product Bible containing: product vision, architecture overview, module map, user journeys
4. Use this as **background context only** — it helps you write a better summary, use correct terminology, and ask smarter clarifying questions

**IMPORTANT:** Do NOT include any module conclusion, module reference, or spec doc link in the intake item. The spec doc is read-only context for the PA agent. Module determination is the triage agent's responsibility — they will read the same spec doc independently with actual code access.

### 3. Identify Assignee

The intake item should be assigned to the project member who will own the request. The PA typically knows the requester's name, email, or alias from the conversation context.

1. Match the requester to a project member using the `po` skill → Members table (name, email, alias)
2. If the requester IS a project member → assign to them
3. If the requester is external (client, stakeholder) → assign to the default assignee from the Members table
4. If ambiguous → ask the user which member to assign

Store the resolved member UUID for Step 5.

### 4. Gather Context & Classify

Collect all available business context from the PA's sources:

- **Current conversation** — what the user described or discussed
- **Recent communications** — emails, messages, meetings read in this session
- **Memory/docs** — organizational knowledge the PA has loaded
- **Do NOT read source code** — the PA doesn't have codebase access

**Classify the request:**

- **Label** — pick one from the project's label set (see `po` skill → Labels):
  - `BUG`: broken behavior, error, regression
  - `FEATURE`: new capability, enhancement
  - `TWEAK`: small adjustment, config change, UX improvement
  - `IDEA`: research, investigation, no concrete deliverable
  - Leave empty if unsure
- **Priority** — `urgent`, `high`, `medium`, `low`, or `none`

### 5. Confirm with User

Present the draft intake item including assignee, priority, and label. **User must confirm** before creation.

### 6. Create Intake Item

**Step 6a:** Use `create_intake_work_item` MCP tool:

- `name`: concise, action-oriented title
- `description_html`: the Intake Item Description Format (see below)

**Step 6b:** Use `plane-intake-update.js` to set priority, labels, and assignee.

`create_intake_work_item` does NOT support priority, labels, or assignees. After creation, use the identifier from the response to update via script:

```bash
node scripts/plane-intake-update.js {PROJECT_IDENTIFIER}-{N} --priority medium --labels <uuid> --assignees <uuid>
```

**Step 6c:** Add intake item to the **Intakes module**.

The Intakes module is a reserved cross-cutting module used for stakeholder visibility (see `po` skill → Module Conventions → Intakes Module). Use `add_work_items_to_module` with the Intakes module UUID and the work item ID.

### 7. Report

```
Intake Created
Project: [project name]
Item: [title]
Assigned to: [member name]
Priority: [level]
Label: [label name or "none"]
Link: [plane_url]

Next: Run /triage [item-id] in the project codebase to add technical context.
```

---

## Intake Item Description Format

```markdown
## Intake Context
<!-- Written by /intake (Personal Assistant) -->

**Source:** [where request came from — email, chat, meeting, direct ask]
**Requested by:** [person name and role]
**Date:** [when request was made]
**Urgency:** [Low / Medium / High / Critical]

### Summary

[2-3 sentence summary of what's needed and why]

### Details

[Full context — communications, constraints, background]

### Related Context

[Related projects, decisions, people — from PA memory]

---

## Technical Context
<!-- To be added by /triage in the project codebase -->
```

---

## Adopting This Command

When using the PM bible in a **personal assistant** codebase:

1. Copy this command to `.claude/commands/intake.md`
2. Set up project constants with Plane IDs (workspace slug, project ID, MCP server name)
3. Ensure the `po` skill has the Intake Item Description Format
4. Configure MCP server for the target Plane workspace

This command pairs with `/triage` (run in the project codebase) to complete the handoff.

---

## Critical Rules

1. **Always confirm** before creating
2. **PA context only** — no source code analysis
3. **Rich context** — transfer maximum business context into the description
4. **One item per distinct request** — don't merge unrelated asks
5. **Include Technical Context placeholder** — `/triage` expects it
6. **Always set priority** — use `update_work_item` after creation (not `update_intake_work_item`)
7. **Always set label if classifiable** — leave empty only if genuinely unsure
8. **Use the `issue` ID** — the work item UUID from the intake response, not the wrapper ID
9. **No module conclusions in output** — spec doc is read-only context. Never write module names, spec links, or module guesses into the intake item. The triage agent determines modules independently with code access
10. **Always assign** — resolve requester to a project member; use default assignee if external
11. **Always add to Intakes module** — enables stakeholder dashboard view and downstream tracking

---

<!-- Command version: 1.4 — Script-first: use plane-intake-update.js for setting properties after creation -->
