---
name: bible-react-code-style
description: Use when writing or reviewing JavaScript/TypeScript code for style patterns like concise arrows, inline handlers, or when tempted to use eslint-disable
---

# React Code Style

Preferred patterns for consistent, readable JavaScript/TypeScript. Conventions for new code — existing code is acceptable as-is.

## Concise Arrow Functions

Single-expression functions: prefer concise form without braces.

```tsx
// Preferred for new code
const handleClick = () => doSomething();
const getFullName = (user) => `${user.firstName} ${user.lastName}`;

// Braces required for multiple statements
const handleSubmit = () => {
    validate();
    submit();
};
```

## Inline Single-Expression Handlers

Prefer inlining single-expression handlers directly in event props:

```tsx
// Preferred — inline
<Button onClick={() => setIsOpen(true)}>Open</Button>
<Modal onClose={() => setIsOpen(false)} />

// Extract when: multiple expressions, reused, complex logic, or memoization needed
const handleSubmit = () => {
    validateForm();
    submitData();
};
```

## FORBIDDEN: eslint-disable Comments

**NEVER use eslint-disable to suppress hook dependency warnings.** These warnings exist for good reason — suppressing them hides bugs.

```tsx
// ❌ FORBIDDEN
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => { ... }, [incomplete_deps]);
```

### Root Cause: Unstable References

The warning usually means a dependency changes reference every render:
- Context object recreated each render
- Inline array/object props
- Unmemoized callbacks

### Solution: Compare Before Update

```tsx
// ✅ Keep all dependencies, compare before updating
useEffect(() => {
    const prevIds = prev.map((u) => u.id).sort().join(",");
    const nextIds = next.map((u) => u.id).sort().join(",");
    if (prevIds !== nextIds) {
        setState({ users: next });
    }
}, [next, prev]); // All deps included
```

### Solution: Functional Updates

```tsx
// ✅ Functional update avoids needing state in deps
setItems((prev) => {
    if (prev.length !== next.length) return next;
    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
});
```

### Exception Process

If eslint-disable is truly unavoidable:
1. Stop and ask the user — explain why
2. Get explicit approval
3. Document the reason in a comment

```tsx
// ⚠️ EXCEPTION — User approved on YYYY-MM-DD
// Reason: Third-party library returns unstable ref, no workaround
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => { ... }, [stableValue]);
```

## Onboarding

### Decisions
None — code style is universal.

### Scaffolding
None.
