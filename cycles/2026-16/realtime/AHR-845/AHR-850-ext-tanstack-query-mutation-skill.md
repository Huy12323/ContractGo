# Bible extension skill for query keys

Work Item: AHR-850 (https://plane.jimbui.dev/aiur/browse/AHR-850/)
Tier 1: AHR-845 [v0.0.1 | Realtime] Org-scoped realtime sync platform (In Progress)
Module: Realtime (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/cf032c73-9fdd-40bd-87c5-0cbffbdcae52/)
Outline Spec: https://outline.jimbui.dev/doc/417b83aa-a52e-48a7-996b-8cc6e73ab1cb
Version Doc: https://outline.jimbui.dev/doc/4d630af1-7350-40c4-a614-4291881e1b64

## Context (from spec)

Non-tech: Developer documentation. Future agents that load `bible-tanstack-query-mutation` should also pick up a project-specific extension that codifies our pure-factory QueryKeys shape (from AHR-849) and the realtime coupling (from AHR-851) so nobody re-asks the same questions next cycle.

Tech: New file `.claude/skills/ext-tanstack-query-mutation/SKILL.md` with frontmatter `base: bible-tanstack-query-mutation` per `bible-skill-extension` rules. Additive only — never duplicates the base's hook-shape patterns. Documents: (a) pure 3-method factory (`all` / `list` / `record`) typed against `keyof Database["public"]["Tables"]`, (b) snake_case DB-table-name convention + `"record"` sentinel on `record(id)`, (c) realtime coupling — the invalidation predicate at AHR-851 matches by table name + marker, so EVERY key must start with a real DB table name, (d) hybrid invalidation policy — mutations keep `queryClient.invalidateQueries(...)` for snappy single-tab UX; realtime covers cross-tab and cross-user.

Related:
- bible-tanstack-query-mutation (base) — hook shapes, No-Destructuring rule, minimal processing principle, etc. This skill extends, does not duplicate.
- bible-skill-extension — naming, frontmatter, one-extension-per-base rule, "Never Edit Bible Skills".

Siblings: 7 total, 4 Done (local, pending /pp) — AHR-846, AHR-847, AHR-848, AHR-849 all locally complete. AHR-850 (In Progress — this item), AHR-851 (Planned — local), AHR-852 (Todo).

Execution Order: Step 3 of 4. Prerequisites AHR-846/847/848/849 all effectively Done ✓. Parallel with AHR-851 (both Step 3).

## Phase A: Author + verify the extension skill

- [x] Created `.claude/skills/ext-tanstack-query-mutation/SKILL.md` with frontmatter `name`, `description`, `base: bible-tanstack-query-mutation`
- [x] Opening callout pointing to base skill
- [x] Pure 3-method factory documented with the `createTableFactory<T extends TableName>` signature from `queryKeys.ts`
- [x] Snake_case convention + `"record"` sentinel documented; explicit contrast with base's scaffolding template
- [x] Realtime coupling documented with full predicate snippet — references AHR-851's invalidation logic; explains the snake_case-matches-DB rationale
- [x] Hybrid invalidation policy documented — mutations retain `queryClient.invalidateQueries(...)`; realtime is additive. Cites base's anti-pattern line and the project's "hybrid" interpretation.
- [x] Spread-pattern table covering 5 canonical patterns (my items, current-user profile, org-filtered list, token lookup, alternate DTO view) — condensed from 7 AHR-849 call-site replacements (two `mine()` variants reduce to one row)
- [x] Discoverability verified — `ext-tanstack-query-mutation` surfaced in the project's skills list (visible alongside `ext-supabase-auth`, `ext-supabase-rls-policies`) immediately after file creation

---

## Plane IDs (populated by /pp)

Phase A: AHR-908 (Author + verify the extension skill)

- Task 1: AHR-909 — Create SKILL.md with base frontmatter
- Task 2: AHR-910 — Base-skill callout
- Task 3: AHR-911 — Document pure 3-method factory
- Task 4: AHR-912 — Document snake_case + record sentinel
- Task 5: AHR-913 — Document realtime coupling
- Task 6: AHR-914 — Document hybrid invalidation policy
- Task 7: AHR-915 — Spread-pattern table (5 canonical cases)
- Task 8: AHR-916 — Verify discoverable via /load-skills
