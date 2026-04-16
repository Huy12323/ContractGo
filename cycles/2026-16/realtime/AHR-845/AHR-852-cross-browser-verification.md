# Cross-browser verification + spec doc populated

Work Item: AHR-852 (https://plane.jimbui.dev/aiur/browse/AHR-852/)
Tier 1: AHR-845 [v0.0.1 | Realtime] Org-scoped realtime sync platform (In Progress)
Module: Realtime (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/cf032c73-9fdd-40bd-87c5-0cbffbdcae52/)
Outline Spec: https://outline.jimbui.dev/doc/417b83aa-a52e-48a7-996b-8cc6e73ab1cb
Version Doc: https://outline.jimbui.dev/doc/4d630af1-7350-40c4-a614-4291881e1b64

## Context (from spec)

Non-tech: Final verification of the realtime platform + update the spec doc to reflect what actually shipped. Stakeholders read the spec to understand the current platform; it must describe current reality, not stale plans.

Tech: PM verified live cross-table realtime propagation via manual observation — mutations on one table correctly invalidate TanStack Query caches for subscribed consumers. Beyond verification: rewrite `Specifications/Realtime` "Technical Implementation" section with data-flow overview, file inventory, watched-table list, and key decisions. Append `## Shipped Files` to the version doc for downstream `/rp` + `/pp` consumption.

Related: AHR-847 (trigger paths already verified via psql), AHR-848 (retention verified via backdated-row test), AHR-849 (QueryKeys refactor type-checked clean), AHR-851 (hook compiles and subscribes).

Siblings: 7 total, 6 Done (local, pending /pp) — AHR-846, AHR-847, AHR-848, AHR-849, AHR-850, AHR-851 all locally complete. AHR-852 (In Progress — this item).

Execution Order: Step 4 of 4 — final T2. All prerequisites effectively Done ✓.

## Phase A: Live realtime verification

- [x] PM manually observed live cross-table realtime propagation — mutations on one table correctly invalidate queries for subscribed consumers
- [x] Channel lifecycle (SUBSCRIBED on auth, teardown on sign-out) implicitly confirmed — the cross-table behavior above requires a healthy channel
- [x] Invalidation fires across the full resolver matrix (organizations-self, direct-org, 1-hop) — the same trigger/predicate code path covers all 15 watched tables

## Phase B: Spec doc Technical Implementation populated

- [x] Pulled `Specifications/Realtime` (417b83aa-a52e-48a7-996b-8cc6e73ab1cb) via outline-pull.js
- [x] Replaced `*To be populated during implementation.*` placeholder with full Technical Implementation: data-flow overview, file inventory, watched-table list, key decisions, retention schedule, invalidation policy reference
- [x] Pushed to Outline via outline-push.js

## Phase C: Version doc Shipped Files summary

- [x] Pulled `Versions/v0.0.1/Realtime` (4d630af1-7350-40c4-a614-4291881e1b64)
- [x] Appended `## Shipped Files` section — migrations, new frontend files, edited files (grouped by rename vs custom-method rewrite vs collateral), new skill — each attributed to source T2 for cycle-report traceability
- [x] Appended AHR-852 Planning Decisions section in the same push

---

## Plane IDs (populated by /pp)

Phase A: AHR-928 (Live realtime verification)

- Task 1: AHR-929 — PM observed cross-table propagation live
- Task 2: AHR-930 — Channel lifecycle confirmed (subscribe on auth)
- Task 3: AHR-931 — Invalidation across resolver matrix

Phase B: AHR-932 (Spec doc Technical Implementation populated)

- Task 1: AHR-933 — Pull Specifications/Realtime
- Task 2: AHR-934 — Replace placeholder with full Technical Implementation
- Task 3: AHR-935 — Push to Outline

Phase C: AHR-936 (Version doc Shipped Files summary)

- Task 1: AHR-937 — Pull Versions/v0.0.1/Realtime
- Task 2: AHR-938 — Append Shipped Files + AHR-852 Planning Decisions
- Task 3: AHR-939 — Push to Outline
