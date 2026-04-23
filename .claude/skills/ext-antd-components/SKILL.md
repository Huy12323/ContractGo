---
name: ext-antd-components
description: Project-specific ANTD patterns — where to override theme tokens when defaults produce bad colors, and which tokens cascade to which consumers
base: bible-antd-components
---

# ANTD Components — Project Extensions

> Base skill: **bible-antd-components** — read it first for the universal "always use `token.*` not hardcoded values" rule.

## Override derived tokens at the theme root, not at consumer sites

ANTD auto-derives many tokens from seeds (e.g. `colorPrimaryBg` is a step-1 tint of `colorPrimary`). When the seed is dark or low-saturation, those derivations can come out muddy and unreadable. When that happens:

**Do** override the token itself in `frontend/vite/src/providers/antd/Provider_ANTD.tsx` under `theme.token`. One change, cascades to every consumer.

**Don't** sprinkle a replacement hex at each consumer (`style={{ background: "#d0ebef" }}`). Consumers already read `token.colorPrimaryBg` — the whole point of the token is that one edit flows everywhere.

**Don't** reach for `components.{Comp}.{subToken}` overrides (e.g. `components.Menu.itemSelectedBg`) if the same derived token is also used by other components that need the same fix. Component-scoped overrides are for genuinely component-local tweaks (e.g. `Table.headerBg`), not for fixing a bad cascade.

### Example — the selected-state teal fix (2026-04)

`colorPrimary: #136a7b` (dark low-sat teal) caused ANTD's auto-derived `colorPrimaryBg` to read as muddy beige. The selected state of the main vertical nav, the Employees views sidebar, and the active toolbar buttons (Hide Fields / Filters / Groups / Sort) all looked dull — text lost contrast against the background.

All three consumers already read `token.colorPrimaryBg` correctly. The fix was a single root-token override:

```typescript
// Provider_ANTD.tsx — inside theme.token
colorPrimaryBg: "#d0ebef",       // brighter teal tint
colorPrimaryBgHover: "#b9dfe5",  // slightly darker, for hover state
```

No per-component overrides, no per-consumer hex injection. Three screens fixed with two lines.

## Tokens that cascade widely (change with care)

These derived tokens flow into many places — if you override them, verify all consumers look right:

| Token | Flows to |
|---|---|
| `colorPrimaryBg` | Menu selected row (via `controlItemBgActive`), any `style={{ background: token.colorPrimaryBg }}` consumer, active-button highlight patterns |
| `colorPrimaryBgHover` | Menu hover, active-button hover, any hover-tint consumer |
| `colorBorder` | Every bordered surface — tables, cards, dividers |
| `colorFillAlter` | Table zebra/banded rows, group header backgrounds |

## When component-scoped overrides ARE right

Component-scoped overrides (`components.{Comp}.{token}`) are correct when the tweak really is local to that component:

- `Table.headerBg: "#FFFFFF"` — we want plain white table headers even though other surfaces use `colorFillAlter`
- `Table.rowHoverBg: "rgba(0,0,0,0.04)"` — neutral gray row hover, distinct from group-row tint
- `Input.borderRadius: 32`, `Select.controlHeight: 40` — component-specific shape tokens

Rule of thumb: if the value would be wrong for other components reading the same root token, use a component-scoped override. If the root-derived value is wrong *everywhere*, fix the root token.

## Anti-patterns

| Wrong | Correct |
|---|---|
| `style={{ background: "#d0ebef" }}` at every selected-state consumer | Override `colorPrimaryBg` once in `Provider_ANTD.tsx` |
| `components.Menu.itemSelectedBg` + `components.Button.activeBg` + ... with the same hex | One root-token override, let the cascade work |
| Overriding a root token to fix one component when other consumers looked fine | Use a component-scoped override instead — don't break working cascades |
