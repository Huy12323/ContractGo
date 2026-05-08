# Nav restructure with role-based sections

> Version: [Outline](https://outline.jimbui.dev/doc/a31dd479-ce04-48bd-868c-c81fb9da22e8) | Tier 1: [AHR-1958](https://plane.jimbui.dev/aiur/browse/AHR-1958/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9a60fe58-e1b1-49d9-bb12-2d2f65ca73f1/)

## Requirements

- Vertical nav splits into HR section (top) + Employee section (below) with group labels
- HR section visible only for owner/admin roles: Dashboard, Employees, Org Chart, Timesheets
- Employee section visible to all: My Timeclock
- Admin/owner see both sections (HR above Employee)
- App_ViewSwitcherMock removed
- Route stubs for Timesheets and My Timeclock load without errors

## Scope boundaries

- Only nav items with working routes shown — Onboarding, Settings, My Schedule, My Leave added later when their features are built
- Route stubs are placeholder pages, not functional views
- Clock strip belongs to AHR-1962, not this T2

## Decisions

- **Decision:** Only show nav items with working routes
  **Rationale:** Avoids 404s and dead links. Nav items added incrementally as features ship.
- **Decision:** Employee section always visible, HR section gated by role
  **Rationale:** Admin/owner are also employees who need to clock in. Employee-only users don't need HR tools.
- **Decision:** Use ANTD Menu `type: 'group'` for section headers
  **Rationale:** Built-in grouping with labels, no custom layout needed. Collapsed sidebar still shows icons.

## Implementation

### Phase A — Route stubs

Create minimal route files for Timesheets and My Timeclock so nav links don't 404.

- [x] Create `_protected/$organizationId/timesheets/index.tsx` with Page_Timesheets placeholder
- [x] Create `_protected/$organizationId/my-timeclock/index.tsx` with Page_MyTimeclock placeholder

### Phase B — Vertical nav restructure

Restructure App_VerticalNav from flat menu to grouped sections with role-based visibility.

- [x] Add useOrganization() hook import for role check
- [x] Split Menu items into two groups using type: 'group' with labels ("HR" / "Employee")
- [x] HR group items: Dashboard, Employees, Org Chart, Timesheets (with icons)
- [x] Employee group items: My Timeclock (with icon)
- [x] Conditionally render HR group only when role === 'owner' || role === 'admin'
- [x] Remove App_ViewSwitcherMock component and its import
- [x] Update selectedKeys logic for /timesheets and /my-timeclock paths
- [x] Verify collapsed sidebar shows icons correctly for both sections

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during /s and for sibling awareness during concurrent /p sessions._

Non-tech: The navigation frame needs to separate HR admin tools from employee self-service features, with role-based visibility controlling who sees what.
Tech: App_VerticalNav.tsx (ANTD Menu), routes under _protected/$organizationId/, useOrganization() hook for role check, App_ViewSwitcherMock.tsx (to be removed)
Related: [Timeclock](https://outline.jimbui.dev/doc/f8a05b43-ff37-4937-9411-bf93c2095982) - nav restructure prepares for timeclock pages
Siblings: 6 total, 0 Done, 2 Cancelled — [AHR-1960 Entity-employee assignment (Cancelled), AHR-1962 Clock strip (In Progress — planned), AHR-1963 My Timeclock (Todo), AHR-1964 HR Timesheets (Todo), AHR-1965 Onboarding wizard (Cancelled)]
Execution Order: Step 2 of 3 — AHR-1966 (step 1) Done, parallel with AHR-1962
Outline Spec: https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22
