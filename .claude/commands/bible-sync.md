---
name: /bible-sync
description: Sync consumer codebase with PM Bible template — track, compare, and apply updates
---

# Bible Sync Command

Synchronize the current project with the PM Bible template. Tracks which files are synced, diverged, or skipped, and uses git history to efficiently apply only what changed.

---

## Input

```
/bible-sync <path-to-bible>              → sync with Bible at given path
/bible-sync <path-to-bible> --status     → show sync status without applying changes
```

The command runs in the **consumer codebase** (CWD). The `<path-to-bible>` points to the local Bible repo clone.

---

## Tracked Files

These Bible files are tracked for sync. Files not in this list (`.env`, `project-config.json`, `.mcp.json`, `node_modules/`, `cycles/`, `.claude/settings.*`) are consumer-specific and never synced.

```
.claude/commands/pm.md
.claude/commands/p.md
.claude/commands/s.md
.claude/commands/pp.md
.claude/commands/rp.md
.claude/commands/triage.md
.claude/commands/intake.md
.claude/commands/gitpush.md
.claude/commands/bible-sync.md
.claude/skills/po/SKILL.md
scripts/plane-cycle-items.js
scripts/plane-work-items.js
scripts/plane-desc-append.js
scripts/outline-pull.js
scripts/outline-push.js
scripts/generate-mcp.js
scripts/setup-po.js
docs/pm.md
docs/pm-workflow-guide.html
CLAUDE.md
package.json
.gitignore
project-config.example.json
.env.example
```

---

## Manifest Format

The manifest lives at `.claude/bible-sync.md` in the consumer codebase. Example:

```markdown
# Bible Sync

Bible: https://github.com/aiursoftware/bible.git
Last synced: f01c4e1039a10d30a94d63374641b0fd0849ecfc
Synced on: 2026-02-26

## Tracked Files

| File | Status | Notes |
|------|--------|-------|
| .claude/commands/pm.md | synced | |
| .claude/commands/triage.md | synced | |
| .claude/commands/intake.md | skipped | PA-only command, not used in project codebases |
| .claude/commands/gitpush.md | diverged | Added project-specific commit prefix convention |
| .claude/skills/po/SKILL.md | diverged | Filled with project-specific constants via setup-po.js |
| CLAUDE.md | diverged | Added project-specific skills section and custom adoption notes |
| package.json | diverged | Added project dependencies alongside bible deps |
```

**Statuses:**
- `synced` — exact copy of Bible file. Safe to overwrite on re-sync.
- `diverged` — consumer has intentional differences. Notes explain what and why.
- `skipped` — file intentionally not present. Notes explain why.

---

## Step 0: Validate Inputs

1. Verify `<path-to-bible>` exists and contains a `.git/` directory.
2. Read the Bible's current HEAD: `git -C <path-to-bible> log -1 --format="%H %as"`
3. Read the Bible's remote URL: `git -C <path-to-bible> remote get-url origin`

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

- **`SKILL.md`**: Always `diverged` after `setup-po.js`. Note: "Filled with project-specific constants via setup-po.js"
- **`CLAUDE.md`**: Always `diverged` in consumers. Note the project-specific sections.
- **`package.json`**: `diverged` if consumer added its own dependencies. Note what's added.
- **`intake.md`**: Suggest `skipped` for project codebases with note "PA-only command".

### Present summary

```
Bible Sync — First Sync
Bible: <remote-url>
Commit: <hash> (<date>)

  synced (12):   pm.md, p.md, s.md, ...
  diverged (5):  gitpush.md, SKILL.md, CLAUDE.md, package.json, .gitignore
  skipped (1):   intake.md
  missing (2):   plane-desc-append.js, docs/pm-workflow-guide.html

Diverged files will include notes explaining the differences.
Missing files can be copied from the Bible.
```

**For each diverged file**: read the diff, draft a 1-2 sentence divergence note, present to user for confirmation.

**For each missing file**: ask "Copy from Bible?" or "Skip?"

**After user confirms**, generate `.claude/bible-sync.md` with the manifest.

---

## Step 3: Re-Sync Mode

1. Read `.claude/bible-sync.md` — parse `Last synced` commit hash and the file table.
2. Get Bible changes since last sync:
   ```bash
   git -C <path-to-bible> log <last-synced-hash>..HEAD --stat --oneline
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
  New files (1):     scripts/plane-desc-append.js
  Unchanged (18):    ...

Proceed with auto-apply? [y/n]
```

### Auto-apply

For `synced` files that changed: copy Bible version to consumer. No confirmation needed per file — one batch confirmation.

### Review diverged files

For each diverged file that changed in the Bible:

1. Show Bible's diff since last sync: `git -C <path-to-bible> diff <old-hash>..HEAD -- <file>`
2. Show the consumer's divergence notes from the manifest.
3. Propose one of:
   - **Accept Bible version** → overwrite, change status to `synced`, clear notes
   - **Merge** → apply Bible's structural changes while preserving consumer customizations, update notes
   - **Keep consumer version** → leave as-is, update notes to acknowledge the Bible change was reviewed
4. User decides.

### New files

For files added to Bible since last sync: ask "Copy?" → `synced`, or "Skip?" → `skipped` with reason.

### Finalize

After all decisions:
1. Apply confirmed file changes.
2. Regenerate `.claude/bible-sync.md` with updated commit hash, date, statuses, and notes.
3. Report summary.

---

## Step 4: Report

```
Bible Sync Complete
Bible: <remote-url>
Synced to: <new-hash> (<date>)
  Applied: [N] files updated
  Reviewed: [N] diverged files (M merged, K kept)
  Skipped: [N] files
  New: [N] files added

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
4. **Handle `SKILL.md` carefully** — structural changes can be merged, but filled constants must be preserved
5. **The manifest is the source of truth** — if it says `skipped`, respect it unless user overrides
6. **Always update the commit hash** — even if nothing changed, so the next sync diffs from the right point
7. **Self-syncing** — this command (`bible-sync.md`) is itself a tracked file and updates with the rest

---

<!-- Command version: 1.0 — Initial release -->
