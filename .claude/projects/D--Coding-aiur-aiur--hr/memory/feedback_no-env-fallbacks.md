---
name: No env fallback values
description: Never use fallback/default values for environment variables — missing env vars should throw, not silently use a fallback
type: feedback
---

Never use fallback values (`?? "default"`) or non-null assertions (`!`) for environment variables. Always do proper runtime validation — check the value exists and is truthy, throw a descriptive error if not.

**Why:** Fallback values mask configuration issues silently. Non-null assertions (`!`) bypass type checking and crash with unhelpful errors. Proper validation catches misconfiguration early with a clear message.

**How to apply:** Use a `requireEnv()` helper that checks `!value` and throws `Missing required environment variable: ${name}`. Apply in edge functions, backend code, and any server-side code that reads env vars.
