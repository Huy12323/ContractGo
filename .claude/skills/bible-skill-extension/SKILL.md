---
name: bible-skill-extension
description: Use when adding project-specific patterns that build on a Bible skill. NEVER edit bible-* skills directly — create or edit an ext-* extension instead.
---

# Skill Extension

Bible skills (`bible-*`) are synced from the Bible repo and encode universal patterns. When your project needs project-specific additions on top of a Bible skill, create an **extension skill** — never modify the base.

## When to Extend

- Your project has patterns that build on a Bible skill but are too specific to generalize
- You need project-specific examples, paths, or integrations not covered by the base
- A Bible skill uses placeholders like "see your {domain} skill" and you want to fill them in

**Do NOT extend when:**
- The pattern is universal — PR it back to the Bible instead
- The base skill already covers it — you're duplicating

## Naming

**Pattern:** `ext-{bible-skill-name}`

```
.claude/skills/
├── bible-supabase-schema/       ← synced from Bible (DO NOT EDIT)
├── ext-supabase-schema/         ← project-specific extension
├── bible-supabase-auth/         ← synced from Bible (DO NOT EDIT)
├── ext-supabase-auth/           ← project-specific extension
├── bible-tanstack-store/        ← synced from Bible (DO NOT EDIT)
├── my-custom-skill/             ← standalone local skill (no base)
```

The `ext-` prefix signals: "This extends a Bible skill. Read the base first."

## Extension SKILL.md Structure

```yaml
---
name: ext-supabase-schema
description: Project-specific schema patterns — realtime system, RLS policies, custom triggers
base: bible-supabase-schema
---
```

The `base:` field links to the Bible skill this extends. One extension per base skill.

### Content Rules

```markdown
# Supabase Schema — Project Extensions

> Base skill: **bible-supabase-schema** — read it first for universal patterns.

## Realtime Events System

(Project-specific realtime trigger setup, org-scoped change notification, etc.)

## RLS Policy Patterns

(Project-specific access control approach)

## Project-Specific Conventions

(Anything unique to this codebase that builds on the base)
```

## Rules

### 1. Never Edit Bible Skills

`bible-*` folders are Bible-managed. Local edits are overwritten on next `/bible-sync`. Always create or edit an `ext-*` skill instead.

### 2. Extension Adds, Never Duplicates

The extension assumes the reader has already loaded the base. Do not repeat patterns from the base — only add what's new.

| Wrong | Right |
|---|---|
| Re-explaining `generate_id()` | "Using the `generate_id()` pattern from base, our prefixes are: ..." |
| Copying the enum naming section | "Our project-specific enums: ..." |
| Full migration template | "Additional migration steps for our realtime system: ..." |

### 3. Reference the Base

Start with a callout pointing to the base skill. When referencing base patterns, use phrases like:

- "Using the junction table pattern from base..."
- "Following the standard columns pattern..."
- "Per the base skill's enum convention..."

### 4. One Extension Per Base

Keep it simple — one `ext-*` per `bible-*` skill. If an extension grows too large, that's a signal to either:
- Split the Bible skill into smaller skills (PR to Bible)
- Create a standalone local skill (no `ext-` prefix, no `base:` field)

### 5. Loading Convention

When the agent loads a `bible-*` skill (e.g., via `/s` or `/load-skills`), it should also check for a matching `ext-*` companion and load both.

## When to PR Back to Bible

If your extension contains a pattern that would benefit all consumers:

1. Generalize it (remove project-specific names, paths, values)
2. Confirm it doesn't violate domain isolation
3. PR to the Bible repo under the base skill
4. Remove the pattern from your extension after Bible merges and you re-sync

## Anti-Patterns

| Wrong | Correct |
|---|---|
| Editing `bible-supabase-schema/SKILL.md` directly | Create `ext-supabase-schema/SKILL.md` |
| Extension that contradicts the base | Extension only adds on top of base |
| Duplicating base content in extension | Reference base, add only new patterns |
| Multiple extensions for one base | One `ext-*` per `bible-*` |
| Extension without `base:` frontmatter | Always include `base: bible-skill-name` |
| Standalone skill named `ext-*` | `ext-` prefix reserved for Bible extensions |

## Onboarding

### Decisions
None — extension convention is universal.

### Scaffolding
None — extensions are created as needed when project-specific patterns emerge.
