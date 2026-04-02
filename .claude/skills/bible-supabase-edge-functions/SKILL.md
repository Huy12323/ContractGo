---
name: bible-supabase-edge-functions
description: Use when creating, naming, or organizing Supabase Edge Functions (Deno)
---

# Supabase Edge Functions

Guidelines for creating Supabase Edge Functions, including naming conventions, import configuration, and common patterns.

## Directory Structure

Edge functions live at `supabase/functions/` in your project. Each function is a flat folder with `index.ts` and `deno.json`.

```
supabase/functions/
├── dashboard_settings_update-theme/
│   ├── index.ts
│   └── deno.json
├── storage_generate-upload-url/
│   ├── index.ts
│   └── deno.json
└── _shared_validate-token/
    ├── index.ts
    └── deno.json
```

**Why flat?** Supabase CLI only discovers functions at the root level of `supabase/functions/`. Nested subdirectories are not supported.

## CRITICAL: deno.json Import Maps

**Each Edge Function folder MUST have its own `deno.json` file.** Deno does not support bare module specifiers like Node.js.

### Required deno.json Structure

```json
{
    "compilerOptions": {
        "lib": ["deno.window", "deno.ns"],
        "strict": true
    },
    "imports": {
        "supabase": "https://esm.sh/@supabase/supabase-js@2",
        "http-server": "https://deno.land/std@0.168.0/http/server.ts"
    }
}
```

### Common Import Mappings

| Bare Specifier | Deno Import URL                                  |
| -------------- | ------------------------------------------------ |
| `"supabase"`   | `"https://esm.sh/@supabase/supabase-js@2"`       |
| `"http-server"`| `"https://deno.land/std@0.168.0/http/server.ts"` |

Add npm packages with `"npm:"` prefix: `"my-lib": "npm:my-lib@1.0.0"`

### Common Mistake

```typescript
// ❌ Wrong — bare specifiers don't work without deno.json
import { serve } from "http-server";
import { createClient } from "supabase";
// Error: Relative import path "supabase" not prefixed with / or ./ or ../
```

**Fix:** Create `deno.json` in the function folder with proper import mappings.

## Naming Conventions

### Core Pattern

**Structure:** `[namespace]_[sub-namespace]_[action-words]`

| Separator | Used For               | Example            |
| --------- | ---------------------- | ------------------ |
| `_`       | Namespace boundaries   | `dashboard_users_` |
| `-`       | Words within a segment | `send-invitation`  |

All names are **lowercase**. No uppercase letters.

### PascalCase to Kebab-Case Conversion

Convert frontend entity names:

1. Split on underscores and capital letters
2. Join with hyphens (for words) or underscores (for namespaces)
3. Lowercase everything

| Frontend Entity          | Edge Function Prefix     |
| ------------------------ | ------------------------ |
| `Page_Dashboard`         | `page-dashboard_`        |
| `Page_Dashboard_Users`   | `page-dashboard_users_`  |
| `Page_Project_Settings`  | `page-project_settings_` |
| `FileBrowser`            | `file-browser_`          |

### Namespaces (First Segment)

Derived from page or feature names:

```
page-dashboard_        # From Page_Dashboard
page-project_          # From Page_Project
file-browser_          # From FileBrowser feature
storage_               # Domain-level namespace
auth_                  # Domain-level namespace
```

### Sub-namespaces (Second Segment)

Derived from subcomponent or entity names:

```
page-dashboard_users_      # From PageDashboard_Users
page-project_settings_     # From PageProject_Settings
```

### Action Names (Final Segment)

Verb-noun pattern with hyphens:

```
create-item
delete-file
generate-upload-url
send-invitation
validate-token
```

## Creating a New Edge Function

### Step 1: Create Function Folder

```bash
npx supabase functions new page-dashboard_users_send-invitation
```

### Step 2: Create deno.json (REQUIRED)

Add appropriate imports based on dependencies needed.

### Step 3: Create index.ts

```typescript
import { serve } from "http-server";
import { createClient } from "supabase";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Your function logic here

    return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
});
```

## Shared/Utility Functions

Use `_shared_` prefix for cross-cutting functions:

```
_shared_validate-token
_shared_check-permissions
_shared_send-notification
```

**When to use `_shared_`:**

- Authentication/authorization utilities
- Functions called by multiple namespaces
- Infrastructure utilities (logging, error handling)

## URL Mapping

Edge function URLs use the folder name directly:

| Function Name                           | URL                                                |
| --------------------------------------- | -------------------------------------------------- |
| `page-dashboard_users_send-invitation`  | `/functions/v1/page-dashboard_users_send-invitation`|
| `_shared_validate-token`                | `/functions/v1/_shared_validate-token`              |

## Common Mistakes

```
# ❌ Wrong — missing deno.json (causes import errors)
supabase/functions/my-function/
└── index.ts

# ✅ Correct — includes deno.json
supabase/functions/my-function/
├── index.ts
└── deno.json

# ❌ Wrong — nested folders (not supported by Supabase)
page-dashboard/users/send-invitation

# ❌ Wrong — uppercase letters
PageDashboard_Users_SendInvitation

# ❌ Wrong — using hyphens for namespace separation
page-dashboard-users-send-invitation

# ❌ Wrong — no namespace prefix
send-invitation

# ✅ Correct
page-dashboard_users_send-invitation
```

## Anti-Patterns

| Wrong | Correct |
|---|---|
| Missing `deno.json` in function folder | Always include `deno.json` with imports |
| Nested folder structure | Flat folders only |
| Bare npm imports without mapping | Map in `deno.json` imports |
| No CORS headers | Always handle OPTIONS + return CORS headers |
| Uppercase in function names | All lowercase |

## Onboarding

### Decisions
None — conventions are universal for Supabase Edge Functions.

### Scaffolding
None — functions are created per-feature as needed.
