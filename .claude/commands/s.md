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

## Steps 1–4: Load Skills

Run the `/load-skills` discovery process (discover → select → load → validate). **Exclude `po`** — saves context tokens, no MCP needed.

After initial selection, if task requires understanding existing code: explore codebase, note hidden systems. Then **re-evaluate** — revisit the skills map, research reveals hidden needs. Load any newly identified skills.

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

1. **Never skip skill loading** — even if you think you know the patterns
2. **Re-evaluate after research** — research reveals hidden dependencies
3. **Stop on conflicts** — never proceed if validation finds issues
4. **Load once** — invoke each skill exactly once
5. **No MCP calls** — all updates are local
6. **No po skill** — saves context tokens
7. **Read context from plan file** — not from Outline or Plane
8. **Update checkboxes locally** — mark `[x]` after implementing

---

<!-- Command version: 2.1 — Skill loading delegated to /load-skills process -->
