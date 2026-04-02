---
name: bible-antd-v6
description: Use when working with ANTD v6 components, theme tokens, icons, or feedback components (message/notification/modal)
---

# ANTD Components

**Standard: ANTD v6.** All new components must use Ant Design with theme tokens. Never use hardcoded colors, spacing, or typography values when a token exists.

## Theme Tokens (Required)

Always use ANTD theme tokens instead of hardcoded values:

```typescript
import { theme } from "antd";

const MyComponent = () => {
    const { token } = theme.useToken();

    return (
        <div
            style={{
                padding: token.paddingXL,
                color: token.colorPrimary,
                fontSize: token.fontSizeLG,
                borderRadius: token.borderRadiusLG,
            }}
        >
            Content
        </div>
    );
};
```

## Typography (Required)

Use ANTD Typography components for ALL text content:

```typescript
import { Typography } from "antd";

const { Title, Paragraph, Text } = Typography;

const MyComponent = () => (
    <>
        <Title level={1}>Page Title</Title>
        <Title level={3}>Section Title</Title>
        <Paragraph type="secondary">Description text</Paragraph>
        <Text strong>Bold text</Text>
        <Text type="danger">Error text</Text>
    </>
);
```

**Never use raw HTML text elements** (`<h1>`, `<p>`, `<span>`) for content text. Typography components inherit theme tokens automatically.

## App.useApp() — Feedback Components

Always use the `App.useApp()` hook for message, notification, and modal:

```typescript
import { App } from "antd";

const MyComponent = () => {
    const { message, notification, modal } = App.useApp();

    const handleSave = () => message.success("Saved!");

    const handleNotify = () =>
        notification.info({
            message: "Update Available",
            description: "A new version is ready.",
        });

    const handleDelete = () =>
        modal.confirm({
            title: "Delete Item",
            content: "Are you sure?",
            okText: "Delete",
            okType: "danger",
            onOk: () => {
                // deletion logic
            },
        });

    return <button onClick={handleSave}>Save</button>;
};
```

**Requirement:** Your app must be wrapped with ANTD's `<App>` component in the provider tree.

## Mutation Feedback Pattern

When using data mutation hooks, use `App.useApp()` for user feedback:

```typescript
const { message } = App.useApp();

// In mutation callbacks:
onSuccess: () => message.success("Item created!"),
onError: (error) => {
    console.error(error);
    message.error("Failed to create item!");
},
```

This is the UI feedback side — your data layer skill defines the hook structure.

## Icon Usage

**Primary:** `@ant-design/icons` for all icons:

```typescript
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { theme } from "antd";

const MyComponent = () => {
    const { token } = theme.useToken();

    return (
        <>
            <Button icon={<PlusOutlined />}>Create</Button>
            <EditOutlined style={{ fontSize: token.fontSizeLG, color: token.colorPrimary }} />
        </>
    );
};
```

**Fallback:** Use `lucide-react` when ANTD doesn't have a suitable icon. Prefer ANTD icons. Never mix both libraries in the same component.

## CSS/Styling Rules

- **No separate CSS/SCSS files** for new components
- **Use:** ANTD components + inline styles with theme tokens
- **If ANTD token exists** for a value, use it — never hardcode the equivalent
- **Legacy:** Existing CSS frameworks in the codebase remain as-is (no refactoring required)

## Component Tokens

ANTD components have component-level tokens configured in the provider. Use the `size` prop — do NOT override with inline styles:

```typescript
// ❌ Bad — overrides component tokens
<Button type="primary" style={{ borderRadius: 9999, fontSize: 16, fontWeight: 600 }}>

// ✅ Good — let component tokens handle dimensions
<Button type="primary" size="large">
```

Configured via `theme.components.Button` (or any component) in your ANTD provider.

## Deprecated Props (v6)

ANTD v6 renamed several props. Always use the v6 names:

| Deprecated (v5) | Replacement (v6) |
|---|---|
| Card: `bodyStyle` | `styles={{ body: {...} }}` |
| Modal: `destroyOnClose` | `destroyOnHidden` |
| Divider: `orientation="left"` | `titlePlacement="left"` |

```typescript
// ✅ v6
<Card styles={{ body: { padding: token.paddingSM } }}>Content</Card>
<Modal destroyOnHidden>Content</Modal>
<Divider titlePlacement="left">Section Title</Divider>
```

## Modal Semantic DOM (v6)

ANTD v6 renamed Modal's `styles`/`classNames` keys. The visible modal card is `container` (was `content` in v5).

| Key | CSS Class | Targets |
|---|---|---|
| `root` | `.ant-modal-root` | Outermost wrapper |
| `wrapper` | `.ant-modal-wrap` | Scrollable wrapper |
| `mask` | `.ant-modal-mask` | Backdrop overlay |
| **`container`** | `.ant-modal-container` | **The visible modal card** (background, border-radius, shadow) |
| `header` | `.ant-modal-header` | Header section |
| `title` | `.ant-modal-title` | Title text |
| `body` | `.ant-modal-body` | Content area |
| `footer` | `.ant-modal-footer` | Footer with buttons |

```typescript
// ✅ v6 — style the visible card
<Modal styles={{ container: { backgroundColor: token.colorBgContainer } }}>

// ❌ Wrong — `content` was v5
<Modal styles={{ content: { backgroundColor: "..." } }}>
```

## Anti-Patterns

| Wrong | Correct |
|---|---|
| Hardcoded colors/spacing | `theme.useToken()` + `token.*` |
| `import { message } from 'antd'` | `const { message } = App.useApp()` |
| Raw `<h1>`, `<p>`, `<span>` for text | ANTD Typography: `<Title>`, `<Paragraph>`, `<Text>` |
| Missing `theme.useToken()` in component | Import and call in every component that styles |
| Mixed icon libraries in one component | Pick one (prefer `@ant-design/icons`) |
| New CSS/SCSS files | ANTD + inline tokens only |
| Deprecated v5 props | Use v6 replacements |
| Inline styles that duplicate component tokens | Use `size` prop |

## Onboarding

### Decisions
None — ANTD v6 is the standard.

### Scaffolding
Create ANTD Provider wrapper:
- Path: `src/providers/antd/Provider_ANTD.tsx`
- Template:

```typescript
import { App, ConfigProvider, theme as antdTheme } from "antd";

const themeConfig = {
    algorithm: antdTheme.darkAlgorithm, // or defaultAlgorithm
    token: {
        // Seed tokens — customize per project
        colorPrimary: "#1677ff",
        borderRadius: 6,
        fontSize: 14,
    },
    components: {
        Button: {
            // Component-level token overrides
        },
    },
};

export const Provider_ANTD = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider theme={themeConfig}>
        <App>{children}</App>
    </ConfigProvider>
);
```

Wrap your app root with `<Provider_ANTD>` to enable `App.useApp()` and theme tokens.
