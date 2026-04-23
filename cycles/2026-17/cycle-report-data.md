# Cycle 2026/17 — Report Data

> Generated: 2026-04-22
> Cycle: 2026-04-19T00:00:01Z → 2026-04-25T23:59:00Z
> Done: 408 items | Tier 1: 7 | Tier 2: 24 | Points: 104 | Original: 93 | Reassessed: 5 items

## Points Summary

**By version:**

- v0.0.1: 104 pts

**By module:**

- Employee Management: 56 pts
- Employee Onboarding: 29 pts
- File Storage: 19 pts

## Summary

| AHR | Module | Version | Tier 2 | Points | Outline |
|-------|--------|---------|--------|--------|---------|
| AHR-797 | File Storage | v0.0.1 | 5 | 19 | [link](https://outline.jimbui.dev/doc/bab31499-0cd5-4d49-a6c1-7d7af119f63d) |
| AHR-1165 | Employee Onboarding | v0.0.1 | 5 | 29 | [link](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff) |
| AHR-1187 | Employee Management | v0.0.1 | 6 | 27 | [link](https://outline.jimbui.dev/doc/675ea381-0e7c-427d-9fa7-0c30d2a567e2) |
| AHR-1268 | Employee Management | v0.0.1 | 2 | 4 | [link](https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802) |
| AHR-1364 | Employee Management | v0.0.1 | 2 | 11 | [link](https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802) |
| AHR-1429 | Employee Management | v0.0.1 | 1 | 1 | [link](https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802) |
| AHR-1492 | Employee Management | v0.0.1 | 3 | 13 | [link](https://outline.jimbui.dev/doc/5d80c0fb-cf52-4785-a819-f84c92251b56) |

## v0.0.1 (104 pts)

### AHR-797: File Storage (19 pts)

- Version doc: https://outline.jimbui.dev/doc/bab31499-0cd5-4d49-a6c1-7d7af119f63d
- Plane: https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/work-items/2f2ab9f7-fda0-4d32-8ec7-9bd19d1389df/

**Features (Tier 2):**

- AHR-802: R2 migration + 3-bucket setup + Worker serving > R2 infra + Worker bootstrap (3 pts)
- AHR-803: R2 migration + 3-bucket setup + Worker serving > files metadata table + RLS (3 pts)
- AHR-804: R2 migration + 3-bucket setup + Worker serving > Presigned PUT edge function (files_r2_upload-start) (5 pts)
- AHR-805: R2 migration + 3-bucket setup + Worker serving > Worker auth-gated serving + read-JWT minter (5 pts)
- AHR-806: R2 migration + 3-bucket setup + Worker serving > Unified FE upload hook (useM_Files_Upload) (3 pts)

### AHR-1165: Employee Onboarding (29 pts)

- Version doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff
- Plane: https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/work-items/7f1d5bd7-9051-41f6-ba99-8ac36723f32f/

**Features (Tier 2):**

- AHR-1173: Onboarding flow rework — HR-first fill, comment loop, pending_placement, mandatory fields > Schema — invitation/contract enums + comments + mandatory fields (5 pts)
- AHR-1174: Onboarding flow rework — HR-first fill, comment loop, pending_placement, mandatory fields > Drop entity/department wizard step + send-invitation backend (3 pts)
- AHR-1175: Onboarding flow rework — HR-first fill, comment loop, pending_placement, mandatory fields > Editable prefill + HR-review diff indicator (3 pts)
- AHR-1176: Onboarding flow rework — HR-first fill, comment loop, pending_placement, mandatory fields > Mandatory fields — HR marks in pre-fill, filler enforces (5 pts, originally 3 pts)
- AHR-1177: Onboarding flow rework — HR-first fill, comment loop, pending_placement, mandatory fields > HR comment thread + request-changes/approve-content loop (13 pts, originally 8 pts)

### AHR-1187: Employee Management (27 pts)

- Version doc: https://outline.jimbui.dev/doc/675ea381-0e7c-427d-9fa7-0c30d2a567e2
- Plane: https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/work-items/6ea5dfa7-a24f-4523-a573-99876dffa8ad/

**Features (Tier 2):**

- AHR-1188: Grid view — experimental parallel view via Glide Data Grid > View type wiring — grid selectable in view switcher (2 pts)
- AHR-1189: Grid view — experimental parallel view via Glide Data Grid > Grid render with virtualization (5 pts)
- AHR-1190: Grid view — experimental parallel view via Glide Data Grid > Column reorder, resize, hide + Add field affordance (5 pts)
- AHR-1191: Grid view — experimental parallel view via Glide Data Grid > Sort, filter, group consumed from existing state (5 pts)
- AHR-1192: Grid view — experimental parallel view via Glide Data Grid > Deprecate ANTD Table — remove App_EmployeeDataTable and list view mode (5 pts)
- AHR-1193: Grid view — experimental parallel view via Glide Data Grid > Sticky columns — per-saved-view freeze count (5 pts, originally 3 pts)

### AHR-1268: Employee Management (4 pts)

- Version doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802
- Plane: https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/work-items/81d535a9-9b71-418a-85bb-bd8bb917db4d/

**Features (Tier 2):**

- AHR-1289: Full-name derived column + read-only column convention > DB column + edge function guard (1 pts, originally 2 pts)
- AHR-1291: Full-name derived column + read-only column convention > Hardcoded sticky first column + remove freeze config (3 pts)

### AHR-1364: Employee Management (11 pts)

- Version doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802
- Plane: https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/work-items/f4608e92-2fbe-4e5b-b990-984abb1fb324/

**Features (Tier 2):**

- AHR-1387: Employee detail modal + row expand + row numbering > Modal shell + grid wiring (3 pts)
- AHR-1388: Employee detail modal + row expand + row numbering > Details tab: view + edit + save (8 pts, originally 5 pts)

### AHR-1429: Employee Management (1 pts)

- Version doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802
- Plane: https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/work-items/3ad0ea95-716d-45ef-bf1e-de69dff6174d/

**Features (Tier 2):**

- AHR-1430: Fix delete field — employee_views cleanup trigger after config split > Migration to realign cleanup trigger with split schema (1 pts)

### AHR-1492: Employee Management (13 pts)

- Version doc: https://outline.jimbui.dev/doc/5d80c0fb-cf52-4785-a819-f84c92251b56
- Plane: https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/work-items/92459d6f-e356-4781-9919-ca8e417f2d32/

**Features (Tier 2):**

- AHR-1493: File column type > Schema + edge fn + types (3 pts)
- AHR-1494: File column type > Field composer — add 'file' option (2 pts)
- AHR-1495: File column type > Table cell — render + upload + download (8 pts)

