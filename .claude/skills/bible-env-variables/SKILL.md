---
name: bible-env-variables
description: Use when working with environment variables in frontend code — all access must go through the centralized ENVs utility
---

# Environment Variables

Zero tolerance for direct env access. ALL environment variables go through a centralized, type-safe `ENVs` utility. The ENVs file is the ONLY file allowed to access `import.meta.env` directly.

## The ENVs Utility

**Location:** `src/utils/ENVs/ENVs.ts`

```typescript
import jetEnv, { str } from "jet-env";

const baseENVs = jetEnv(
    {
        ViteSupabaseUrl: str,
        ViteSupabaseAnonKey: str,
        ViteApiUrl: str,
    },
    { getValue: (key) => import.meta.env[key] },
);

const ENVs = {
    ...baseENVs,
    get isDev(): boolean { return import.meta.env.DEV; },
    get isProd(): boolean { return import.meta.env.PROD; },
    get mode(): string { return import.meta.env.MODE; },
} as const;

export { ENVs };
```

**Requires:** `jet-env` package for runtime validation and type inference.

## Usage

```typescript
import { ENVs } from "@/utils/ENVs/ENVs";

const url = ENVs.ViteSupabaseUrl;     // Type-safe, validated
if (ENVs.isDev) { console.debug("Dev mode"); }
if (ENVs.isProd) { /* production only */ }
```

## Adding New Variables

1. Add to `.env` with `VITE_` prefix: `VITE_CDN_URL=https://cdn.example.com`
2. Add to `baseENVs` schema: `ViteCdnUrl: str`
3. Access via `ENVs.ViteCdnUrl`

**Naming:** `.env` = `VITE_CDN_URL` (SCREAMING_SNAKE) → schema = `ViteCdnUrl` (PascalCase) → usage = `ENVs.ViteCdnUrl`

## Anti-Patterns

| Wrong | Correct |
|---|---|
| `import.meta.env.VITE_*` in code | `ENVs.VitePropertyName` |
| `import.meta.env.DEV` | `ENVs.isDev` |
| `import.meta.env.PROD` | `ENVs.isProd` |
| `import.meta.env.MODE` | `ENVs.mode` |
| `process.env.NODE_ENV` | `ENVs.isDev` (process.env doesn't work in Vite) |
| Variable not in ENVs schema | Add to schema first, then use |

**Exceptions:** `vite.config.js`, `ENVs.ts` itself, and root config files may access `import.meta.env` directly.

## Onboarding

### Decisions
- Env validation library: `jet-env` (default)
- Vite prefix: `VITE_` (Vite requirement, not configurable)

### Scaffolding
Create ENVs utility:
- Path: `src/utils/ENVs/ENVs.ts`
- Template: see pattern above
- Install: `pnpm add jet-env`
