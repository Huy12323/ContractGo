---
name: /bible-sync
description: Sync consumer codebase with PM Bible template — track, compare, and apply updates
---

# Bible Sync Command

Synchronize the current project with the PM Bible template. Tracks which files are synced, diverged, or skipped, and uses git history to efficiently apply only what changed.

---

## Input

```
/bible-sync              → sync using local .bible/ clone (default)
/bible-sync --status     → show sync status without applying changes
/bible-sync <path>       → sync using Bible clone at custom path
```

The command runs in the **consumer codebase** (CWD). By default it uses `.bible/` in the project root — a gitignored clone of the Bible repo. An optional path override is accepted for non-standard setups.

---

## Consumer Type Detection

Two consumer types exist. The tracked file list and path mapping differ between them.

**Auto-detect:** Check if `.claude/commands/intake.md` or `.claude/commands/i.md` exists in the consumer codebase (PA commands at top level).

| Condition | Consumer Type | Tracked Files |
|-----------|--------------|---------------|
| PA commands exist | **PA Consumer** | Shared + PA commands (no project commands) |
| PA commands do not exist | **Standard Consumer** | Shared + project commands (no PA commands) |

The canonical file lists and path mappings are maintained in the Bible's `CLAUDE.md` under **Sync Ledgers**.

## Path Mapping

Commands in the Bible are organized under `pa/` and `project/` subfolders for organizational clarity. Consumers place them at the **top level** of `.claude/commands/` so they register as flat slash commands (`/pm`, `/intake`) instead of nested ones (`project:pm`, `pa:intake`).

```
Bible source path                          → Consumer destination path
─────────────────────────────────────────────────────────────────────
.claude/commands/project/<cmd>.md          → .claude/commands/<cmd>.md
.claude/commands/pa/<cmd>.md               → .claude/commands/<cmd>.md
.claude/commands/shared/<cmd>.md           → .claude/commands/shared/<cmd>.md
(all other files)                          → (same path)
```

When comparing, diffing, or copying files, always use the **consumer destination path** (not the Bible source path). The manifest tracks consumer paths.

## Tracked Files

### Shared (both consumer types)

```
Bible Source → Consumer Destination
.claude/commands/shared/bible-sync.md → .claude/commands/bible-sync.md
.claude/skills/po/SKILL.md → .claude/skills/po/SKILL.md
scripts/lib/config.js → scripts/lib/config.js
scripts/lib/plane-parse-id.js → scripts/lib/plane-parse-id.js
scripts/lib/plane-api.js → scripts/lib/plane-api.js
scripts/plane-cycle-items.js → scripts/plane-cycle-items.js
scripts/plane-work-items.js → scripts/plane-work-items.js
scripts/plane-item-get.js → scripts/plane-item-get.js
scripts/plane-item-update.js → scripts/plane-item-update.js
scripts/plane-item-create.js → scripts/plane-item-create.js
scripts/plane-latest-version.js → scripts/plane-latest-version.js
scripts/plane-intake-get.js → scripts/plane-intake-get.js
scripts/plane-intake-update.js → scripts/plane-intake-update.js
scripts/plane-intake-handling.js → scripts/plane-intake-handling.js
scripts/outline-pull.js → scripts/outline-pull.js
scripts/outline-push.js → scripts/outline-push.js
docs/pm.md → docs/pm.md
docs/pm-workflow-guide.html → docs/pm-workflow-guide.html
config.json → config.json
.env.example → .env.example
```

### Standard Consumer only (project commands)

```
Bible Source → Consumer Destination
.claude/commands/project/pm.md → .claude/commands/pm.md
.claude/commands/project/p.md → .claude/commands/p.md
.claude/commands/project/s.md → .claude/commands/s.md
.claude/commands/project/pp.md → .claude/commands/pp.md
.claude/commands/project/rp.md → .claude/commands/rp.md
.claude/commands/project/triage.md → .claude/commands/triage.md
.claude/commands/project/gitpush.md → .claude/commands/gitpush.md
.claude/commands/project/load-skills.md → .claude/commands/load-skills.md
```

### PA Consumer only (PA commands)

```
Bible Source → Consumer Destination
.claude/commands/pa/intake.md → .claude/commands/intake.md
.claude/commands/pa/i.md → .claude/commands/i.md
.claude/commands/pa/pi.md → .claude/commands/pi.md
```

Files not in these lists (`.env`, `.mcp.json`, `node_modules/`, `cycles/`, `.claude/settings.*`) are consumer-specific and never synced.

### Skills (per-skill opt-in)

Skills are tracked separately from PM files. Discovery is driven by `.claude/skills/catalog.json` in the Bible.

**Source:** `.claude/skills/bible-{name}/SKILL.md` in Bible
**Destination:** `.claude/skills/bible-{name}/SKILL.md` in consumer (same path)

Skills are **not** hardcoded in this command — the catalog is the source of truth. New skills added to the Bible's catalog automatically appear as `available` on next sync.

**Excluded from skill sync:** `po/` (PM skill, tracked under PM files), `bible-authoring/` (Bible-internal, not for consumers), `catalog.json` itself.

---

## Manifest Format

The manifest lives at `.claude/bible-sync.md` in the consumer codebase. It tracks PM files by **consumer destination path** and skills by **skill name**.

Example (Standard Consumer):

```markdown
# Bible Sync

Bible: https://github.com/aiursoftware/bible.git
Last synced: f01c4e1039a10d30a94d63374641b0fd0849ecfc
Synced on: 2026-02-26
Consumer type: standard

## Tracked Files

| File | Status | Notes |
|------|--------|-------|
| .claude/commands/pm.md | synced | |
| .claude/commands/triage.md | synced | |
| .claude/commands/gitpush.md | diverged | Added project-specific commit prefix convention |
| .claude/skills/po/SKILL.md | diverged | Filled with project-specific constants |

## Skills

| Skill | Category | Status | Notes |
|-------|----------|--------|-------|
| bible-react-naming | react | adopted | Onboarded: prefix=Spark_, alias=@/ |
| bible-react-provider-context | react | adopted | |
| bible-react-code-style | react | adopted | |
| bible-react-hotkeys | react | adopted | |
| bible-antd-components | antd-v6 | adopted | |
| bible-tanstack-query-mutation | tanstack | adopted | |
| bible-tanstack-store | tanstack | adopted | |
| bible-tanstack-router | tanstack | adopted | |
| bible-supabase-schema | supabase | adopted | Onboarded: PK=generate_id, tenant_key=organization_id |
| bible-supabase-migrations | supabase | adopted | |
| bible-supabase-edge-functions | supabase | adopted | |
| bible-supabase-cli | supabase | adopted | Onboarded: supabase_dir=root |
| bible-supabase-auth | supabase | adopted | |
| bible-supabase-sdk | supabase | adopted | |
| bible-supabase-options | supabase | adopted | |
| bible-env-variables | env | adopted | |
| bible-project-structure | project | adopted | Onboarded: app_folder=vite |
| bible-skill-extension | meta | adopted | |
```

**File Statuses:**
- `synced` — exact copy of Bible file (after path mapping). Safe to overwrite on re-sync.
- `diverged` — consumer has intentional differences. Notes explain what and why.
- `skipped` — file intentionally not present. Notes explain why.

**Skill Statuses:**
- `adopted` — skill is in consumer's `.claude/skills/`. Auto-updated on re-sync.
- `available` — in Bible catalog but not yet adopted. Shown on re-sync as "new skills available".
- `skipped` — user explicitly declined. Not shown again unless `--all` flag used.

---

## Step 0: Locate and Update Bible Clone

1. Determine Bible path: use argument if provided, otherwise default to `.bible/` in CWD.
2. Verify the path exists and contains a `.git/` directory. If not, error:
   ```
   Bible clone not found at .bible/
   Run: git clone <bible-repo-url> .bible && echo '.bible/' >> .gitignore
   ```
3. Fetch latest and check if local is behind:
   ```bash
   git -C <bible-path> fetch
   git -C <bible-path> status -uno
   ```
   If the local branch is behind the remote, pull before syncing:
   ```bash
   git -C <bible-path> pull --ff-only
   ```
   If pull fails (diverged history), warn the user and continue with the local HEAD.
4. Read the Bible's current HEAD: `git -C <bible-path> log -1 --format="%H %as"`
5. Read the Bible's remote URL: `git -C <bible-path> remote get-url origin`
6. Read skills catalog: parse `<bible-path>/.claude/skills/catalog.json` to get available skills list. If missing, skip skills sync (Bible may not have skills chapter yet).

---

## Step 1: Detect Mode

Check if `.claude/bible-sync.md` exists in CWD.

- **Exists** → Re-Sync Mode (Step 3)
- **Does not exist** → First Sync Mode (Step 2)

---

## Step 2: First Sync Mode

For each file in TRACKED_FILES:

1. Check if file exists in both the Bible and the consumer codebase.
2. Compare content:
   - **Both exist, identical** → status = `synced`
   - **Both exist, different** → status = `diverged`, draft a note from the diff
   - **Bible only** → prompt user: "Copy from Bible?" → `synced` or `skipped` with reason
   - **Consumer only** → not tracked by Bible, ignore

### Special file handling

- **`SKILL.md`**: Always `diverged` — filled with project-specific constants by the agent. Note: "Filled with project-specific constants"
- **`config.json`**: Always `diverged` once filled — contains project-specific Plane/Outline UUIDs. Note: "Filled with project-specific values"
- **`CLAUDE.md`**: Always `diverged` in consumers. Note the project-specific sections.
- **`package.json`**: `diverged` if consumer added its own dependencies. Note what's added.
- **PA commands** (`intake.md`, `i.md`): Only tracked for PA consumers. Standard consumers skip these.
- **Project commands** (`pm.md`, `p.md`, etc.): Only tracked for standard consumers. PA consumers skip these.
- **Path mapping**: When checking if a file exists in the consumer, use the **consumer destination path** (e.g., check `.claude/commands/pm.md`, not `.claude/commands/project/pm.md`).

### Present summary

```
Bible Sync — First Sync
Bible: <remote-url>
Commit: <hash> (<date>)

  synced (12):   pm.md, p.md, s.md, ...
  diverged (5):  gitpush.md, SKILL.md, CLAUDE.md, package.json, .gitignore
  skipped (1):   intake.md
  missing (1):   docs/pm-workflow-guide.html

Diverged files will include notes explaining the differences.
Missing files can be copied from the Bible.
```

**For each diverged file**: read the diff, draft a 1-2 sentence divergence note, present to user for confirmation.

**For each missing file**: ask "Copy from Bible?" or "Skip?"

**After user confirms**, generate `.claude/bible-sync.md` with the manifest.

### Skills — First Sync

If `catalog.json` was loaded in Step 0:

1. **Discover**: List all skills from catalog, grouped by category.
2. **Detect already-adopted**: Check which `bible-*` folders already exist in consumer's `.claude/skills/`. Mark as `adopted`.
3. **Present by category**:

```
Bible Skills Library — 18 skills available

  react (4):     bible-react-naming, bible-react-provider-context, bible-react-code-style, bible-react-hotkeys
  antd-v6 (1):   bible-antd-components
  tanstack (3):  bible-tanstack-query-mutation, bible-tanstack-store, bible-tanstack-router
  supabase (7):  bible-supabase-schema, bible-supabase-migrations, ...
  env (1):       bible-env-variables
  project (1):   bible-project-structure
  meta (1):      bible-skill-extension

Already adopted (0): —

Adopt skills? Enter category names (e.g., "react tanstack"), "all", or "none":
```

4. **Copy adopted skills**: For each adopted skill, copy `SKILL.md` from Bible to consumer.
5. **Run onboarding**: For each newly adopted skill that has a `## Onboarding` section:
   - Present **Decisions** — confirm or override defaults (e.g., "Component prefix: App_ → ?")
   - Execute **Scaffolding** — create template files if they don't already exist
   - Record results in `.claude/skill-onboarding.md`
6. **Add to manifest**: Each skill gets a row in the `## Skills` table with appropriate status.

---

## Step 3: Re-Sync Mode

1. Read `.claude/bible-sync.md` — parse `Last synced` commit hash and the file table.
2. Get Bible changes since last sync:
   ```bash
   git -C <bible-path> log <last-synced-hash>..HEAD --stat --oneline
   ```
3. Filter changed files to TRACKED_FILES only.

### If no tracked files changed

```
Bible Sync — Up to Date
No tracked files changed since <last-synced-hash>.
```

Update the commit hash and date in the manifest. Done.

### If tracked files changed

Categorize each changed file against the manifest:

| Bible file changed | Manifest status | Action |
|---|---|---|
| Changed | `synced` | **Auto-apply**: copy Bible version to consumer |
| Changed | `diverged` | **Review**: show Bible diff + divergence notes, propose merge |
| Changed | `skipped` | **Notify**: "Bible updated [file] but you've skipped it. Review?" |
| New file (not in manifest) | — | **New**: "Bible added [file]. Copy? Skip?" |
| Deleted from Bible | any | **Notify**: "Bible removed [file]. Remove from consumer?" |

### Present the re-sync plan

```
Bible Sync — Re-Sync
Bible: <remote-url>
Last synced: <old-hash> (<old-date>)
Current HEAD: <new-hash> (<new-date>)
Commits since last sync: <N>

  Auto-apply (4):    pm.md, p.md, pp.md, rp.md
  Review needed (1): gitpush.md
    Bible changes: [summary of what changed]
    Consumer notes: "Added project-specific commit prefix convention"
  Skipped (0):       —
  New files (1):     scripts/plane-intake-handling.js
  Unchanged (18):    ...

Proceed with auto-apply? [y/n]
```

### Auto-apply

For `synced` files that changed: copy Bible version to consumer. No confirmation needed per file — one batch confirmation.

### Review diverged files

For each diverged file that changed in the Bible:

1. Show Bible's diff since last sync: `git -C <bible-path> diff <old-hash>..HEAD -- <file>`
2. Show the consumer's divergence notes from the manifest.
3. Propose one of:
   - **Accept Bible version** → overwrite, change status to `synced`, clear notes
   - **Merge** → apply Bible's structural changes while preserving consumer customizations, update notes
   - **Keep consumer version** → leave as-is, update notes to acknowledge the Bible change was reviewed
4. User decides.

### New files

For files added to Bible since last sync: ask "Copy?" → `synced`, or "Skip?" → `skipped` with reason.

### Finalize (PM files)

After all PM file decisions:
1. Apply confirmed file changes.
2. Update PM section of `.claude/bible-sync.md`.

### Skills — Re-Sync

After PM files are handled, process skills:

1. **Read manifest**: Parse the `## Skills` table from `.claude/bible-sync.md`.
2. **Read catalog**: Get current skill list from Bible's `catalog.json`.
3. **Diff**: Compare Bible skills since last sync:
   ```bash
   git -C <bible-path> diff <last-synced-hash>..HEAD -- .claude/skills/bible-*/SKILL.md
   ```

4. **Categorize each skill**:

| Catalog status | Manifest status | Action |
|---|---|---|
| Exists, changed | `adopted` | **Auto-update**: copy Bible version to consumer |
| Exists, unchanged | `adopted` | No action |
| Exists | `available` | No action (remind: "Still available") |
| Exists | `skipped` | No action |
| **New** (not in manifest) | — | **Notify**: "New skill available: [name] ([category]). Adopt?" |
| Removed from catalog | `adopted` | **Warn**: "Bible removed [name]. Keep local copy or delete?" |

5. **Auto-update adopted skills**: Copy updated `SKILL.md` from Bible. If the skill has onboarding decisions recorded in `skill-onboarding.md`, re-apply text replacements (e.g., `App_` → `Spark_`) after copying.

6. **New skills**: Present grouped by category. User adopts or skips. Run onboarding for newly adopted.

7. **Update manifest**: Regenerate `## Skills` table with current statuses.

### Finalize

1. Regenerate `.claude/bible-sync.md` with updated commit hash, date, file statuses, skill statuses, and notes.
2. Report summary.

---

## Step 4: Report

```
Bible Sync Complete
Bible: <remote-url>
Synced to: <new-hash> (<date>)

PM Files:
  Applied: [N] files updated
  Reviewed: [N] diverged files (M merged, K kept)
  Skipped: [N] files
  New: [N] files added

Skills:
  Updated: [N] adopted skills refreshed
  Adopted: [N] new skills added
  Available: [N] skills not yet adopted
  Skipped: [N] skills declined

Manifest: .claude/bible-sync.md
```

---

## --status Flag

Read-only mode. Runs the same analysis as re-sync but does not modify any files or prompt for decisions. Shows what would change if a full sync were run.

---

## Critical Rules

1. **Never silently overwrite diverged files** — always show the diff and get confirmation
2. **Preserve divergence notes** — they capture institutional knowledge about why things differ
3. **Batch auto-apply for synced files** — one confirmation, not per-file
4. **Handle PO `SKILL.md` carefully** — structural changes can be merged, but filled constants must be preserved
5. **The manifest is the source of truth** — if it says `skipped`, respect it unless user overrides
6. **Always update the commit hash** — even if nothing changed, so the next sync diffs from the right point
7. **Self-syncing** — this command (`bible-sync.md`) is itself a tracked file and updates with the rest
8. **Skills are auto-updated** — adopted Bible skills are safe to overwrite (unlike PO skill which has project constants). Re-apply onboarding decisions after update.
9. **Catalog drives discovery** — never hardcode skill names in this command. Read `catalog.json` every sync.
10. **Onboarding is idempotent** — re-running onboarding on an already-scaffolded project skips existing files and preserves existing decisions in `skill-onboarding.md`.

---

<!-- Command version: 1.5 — Added Skills Library sync: catalog.json discovery, per-skill adoption, auto-update adopted skills, onboarding integration. -->
