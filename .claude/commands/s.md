---
name: /s
description: Skills-aware task execution - local only, no MCP calls
---

# Skills-Aware Task Execution

Execute task **{TASK_ARGUMENTS}** following this mandatory workflow.

**No MCP calls. No po skill. Plan file for context only.**

---

## Input

```
/s [task description]                                → Standard execution
/s [plan file path] [phase] [task description]       → Plan-file-guided execution
/s [plan file path] [task description]               → Plan-file-guided (infer phase)
```

---

## Step 1: Build Skills Map

```bash
awk 'FNR<=10 && /^(name|description):/' .claude/skills/*/SKILL.md
```

## Step 2: Initial Skill Selection

```
Initial skills: [skill-name]: [why relevant]
```

## Step 3: Research

If task requires understanding existing code: explore codebase, note hidden systems. Skip if straightforward.

## Step 3.5: Re-evaluate After Research

**CRITICAL**: Revisit skills map. Research reveals hidden needs.

## Step 4: Load All Relevant Skills

`Skill(skill-name)` **once per skill** for ALL identified skills (Steps 2 + 3.5).

**Do NOT load `po` skill** — saves context tokens, no MCP needed.

## Step 4.5: Validate Against Patterns

Check for conflicts with loaded skills. **If conflicts**, STOP:

```
Warning: CONFLICT: [Type]
Requested: [what user asked]
Skill requires: [pattern/rule]
Options: 1. Adjust request  2. Update skill  3. Clarify intent
```

## Step 5: Execute

Execute {TASK_ARGUMENTS} applying ALL loaded skill guidelines.

## Step 6: Report

```
Applied skills: [list]
```

---

## Plan-File-Guided Mode

When input references a plan file (`cycles/**/*.md`):

### Pre-Execution

1. **Read plan file** for feature context (Context section has non-tech, tech, related info)
2. **Identify phase** being implemented (from input or infer from unchecked items)
3. Run standard Steps 1–6

### Post-Execution

4. **Update plan file**: mark completed tasks `[x]`
5. **If entire phase complete**: note it in output
6. **Write back** to plan file

```
Applied skills: [list]
Plan updated: [path] | Phase [X]: [N] tasks marked complete
```

---

## Critical Rules

1. **Never skip steps 1–4.5** — even if you think you know the patterns
2. **Step 3.5 is mandatory** — research reveals hidden dependencies
3. **Stop on conflicts** — never proceed if Step 4.5 finds issues
4. **Load once** — invoke each skill exactly once
5. **No MCP calls** — all updates are local
6. **No po skill** — saves context tokens
7. **Read context from plan file** — not from Outline or Plane
8. **Update checkboxes locally** — mark `[x]` after implementing

---

<!-- Command version: 2.0 — Temp-file-guided, no local specs -->
