#!/usr/bin/env node

/**
 * Runs the full test pipeline against the LOCAL Supabase stack, and refuses to
 * run against anything else.
 *
 * Why the refusal is stronger than the reference implementation's: Lightcraft
 * matches a Supabase Cloud project ref inside the URL. ContractGo is self-hosted
 * on Hetzner, so there is no ref to match — and the integration silo (Phase 2)
 * CREATES AND DELETES auth.users. A blocklist of known-production hostnames
 * fails open on any hostname nobody thought of, so the host check is an
 * ALLOWLIST instead.
 *
 * Usage:  pnpm test:all            # local (the only accepted target)
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");

// ============================================================
// Layer 1 — target keyword allowlist
// ============================================================
// "prod"/"production" are not merely unhandled, they are not accepted values.
// Unlike the reference implementation, "staging" is NOT accepted either:
// ContractGo's .env.stag is not a throwaway environment. Adding a staging target
// must be a deliberate, separate decision.
const ALLOWED_TARGETS = new Set(["local"]);

const target = (process.argv[2] || "local").toLowerCase();
if (!ALLOWED_TARGETS.has(target)) {
    console.error(
        `test:all — REFUSING: "${target}" is not an accepted target. ` +
            `Only ${[...ALLOWED_TARGETS].join(", ")} is allowed.`
    );
    process.exit(1);
}

// ============================================================
// Layer 2 — resolved-host allowlist
// ============================================================
const ALLOWED_TEST_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const ALLOWED_TEST_PORTS = new Set(["54321"]); // supabase/config.toml [api] port

const resolvedUrl =
    process.env.TEST_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "http://127.0.0.1:54321";

let parsed;
try {
    parsed = new URL(resolvedUrl);
} catch {
    console.error(`test:all — REFUSING: cannot parse Supabase URL "${resolvedUrl}".`);
    process.exit(1);
}

if (!ALLOWED_TEST_HOSTS.has(parsed.hostname) || !ALLOWED_TEST_PORTS.has(parsed.port)) {
    console.error(
        `test:all — REFUSING: resolved Supabase URL "${resolvedUrl}" is not the local stack.\n` +
            `  Tests create and DELETE auth.users. They may only run against ` +
            `127.0.0.1:54321.\n` +
            `  Unset TEST_SUPABASE_URL, or re-run: pnpm env:apply:dev`
    );
    process.exit(1);
}

// ============================================================
// Layer 3 — positive production tripwire
// ============================================================
// Redundant with layer 2 by construction, but it produces a message that names
// PRODUCTION explicitly — which is what a panicking human needs to read.
const PROD_MARKERS = ["aiursoftware.com"];

const envProdFile = path.join(REPO_ROOT, ".env.prod");
if (fs.existsSync(envProdFile)) {
    const match = fs
        .readFileSync(envProdFile, "utf8")
        .split(/\r?\n/)
        .find((line) => /^\s*SUPABASE_URL\s*=/.test(line));
    if (match) {
        const value = match
            .split("=")
            .slice(1)
            .join("=")
            .trim()
            .replace(/^["']|["']$/g, "");
        if (value) PROD_MARKERS.push(value);
    }
}

for (const marker of PROD_MARKERS) {
    if (marker && resolvedUrl.includes(marker)) {
        console.error(
            `test:all — REFUSING: "${resolvedUrl}" appears to be PRODUCTION ` +
                `(matched "${marker}"). Aborting before any test runs.`
        );
        process.exit(1);
    }
}

// ============================================================
// Pipeline
// ============================================================
// Phase 1 is the unit silo only. When the integration silo lands, append
// "test:fe:integration" here.
//
// Deliberately NOT ported from the reference implementation: its end-of-run
// SIGKILL watchdog. That machinery exists to unwedge Playwright on GPU Chrome
// teardown; importing the most fragile part of another repo for a suite with no
// Playwright is free downside. Reintroduce it with the E2E silo, if ever.
const STEPS = ["test:fe"];

const run = (script) =>
    new Promise((resolve) => {
        const started = Date.now();
        // Windows needs shell: true for pnpm to resolve. Development here is
        // Windows-only, so this is not an optional branch.
        const child =
            process.platform === "win32"
                ? spawn(`pnpm ${script}`, { stdio: "inherit", shell: true, cwd: REPO_ROOT })
                : spawn("pnpm", [script], { stdio: "inherit", cwd: REPO_ROOT });

        child.on("close", (code) => resolve({ script, code: code ?? 1, ms: Date.now() - started }));
    });

(async () => {
    console.log(`\n=== test:all (${target}) → ${resolvedUrl} ===\n`);

    const results = [];
    for (const script of STEPS) {
        console.log(`--- ${script} ---`);
        const result = await run(script);
        results.push(result);
        if (result.code !== 0) break;
    }

    console.log("\n=== summary ===");
    for (const { script, code, ms } of results) {
        console.log(`  ${code === 0 ? "PASS" : "FAIL"}  ${script}  (${(ms / 1000).toFixed(1)}s)`);
    }

    const skipped = STEPS.slice(results.length);
    if (skipped.length > 0) console.log(`  SKIPPED: ${skipped.join(", ")}`);

    process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
})();
