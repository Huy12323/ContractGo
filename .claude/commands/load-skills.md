---
name: /load-skills
description: Discover and load project skills for convention-aware context
---

# Load Project Skills

Discover and load project-specific skills to provide convention, pattern, and rule context for planning or execution.

## Input

```
/load-skills [context]          → Auto-select based on described context
/load-skills                    → Select based on current conversation context
```

---

## Step 1: Discover Skills

```bash
awk 'FNR<=10 && /^(name|description):/' .claude/skills/*/SKILL.md
```

Build a skills map: `name → description` for every discovered skill.

## Step 2: Select Relevant Skills

Analyze the context (argument or conversation) and select skills whose conventions apply:

- What modules, feature areas, or file types will be touched?
- What frameworks, libraries, or tooling patterns are involved?
- What naming conventions, directory structures, or architectural rules apply?

```
Selected: [skill-name] — [why relevant]
```

**Exclusion:** Do not load `po` here — PM workflow commands (`/pm`, `/p`) load it explicitly. `/s` excludes it to save context tokens.

## Step 3: Load Skills

`Skill(skill-name)` **once per skill** for all selected skills.

## Step 4: Validate

Check loaded skills for conflicting patterns. If conflicts exist, STOP and surface:

```
CONFLICT: [Type]
Skill A requires: [pattern]
Skill B requires: [pattern]
Options: 1. User resolves  2. Prioritize one  3. Clarify scope
```

## Step 5: Report

```
Loaded skills: [list with one-line rationale each]
```

---

## Integration with Other Commands

This discovery-select-load-validate process is embedded in planning and execution commands:

- **`/pm`** and **`/p`**: After loading `po`, run Steps 1–5 to load project skills relevant to the modules being planned. Gives convention awareness for naming, paths, and architectural patterns.
- **`/s`**: Steps 1–5 are built into its workflow (Steps 1–4.5). Excludes `po` to save tokens.

When called standalone, `/load-skills` primes the conversation with skill context before any follow-up work.

---

## Critical Rules

1. **Always discover first** — run Step 1, don't assume what skills exist
2. **Load each skill exactly once** — never duplicate
3. **Context-driven selection** — don't load everything, select what's relevant
4. **Conflicts block** — never proceed with conflicting patterns unresolved
5. **Skills are reference, not executable** — they provide conventions and patterns

---

<!-- Command version: 1.0 — Extracted from /s skill loading, shared by /pm and /p -->
