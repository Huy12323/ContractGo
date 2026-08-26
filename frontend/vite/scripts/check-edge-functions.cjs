#!/usr/bin/env node

/**
 * Type-checks every Supabase Edge Function with `deno check`.
 *
 * ESLint deliberately ignores supabase/functions/** (Deno globals, URL imports,
 * per-function deno.json import maps), and `tsc` never sees them either — so
 * without this script the 23 functions are the only unchecked code in the repo.
 *
 * Each function directory has its own deno.json import map, so `deno check` must
 * run per-directory rather than once at the root.
 */

const { exec, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const FUNCTIONS_DIR = path.join(__dirname, "../supabase/functions");

if (!fs.existsSync(FUNCTIONS_DIR)) {
    console.warn(`[check:functions] SKIP — ${FUNCTIONS_DIR} not found.`);
    process.exit(0);
}

try {
    execSync("deno --version", { stdio: "ignore" });
} catch {
    console.warn(
        "[check:functions] SKIP — deno not found on PATH. Install Deno to type-check edge functions."
    );
    process.exit(0);
}

const dirs = fs
    .readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "_shared")
    .filter((d) => fs.existsSync(path.join(FUNCTIONS_DIR, d.name, "index.ts")));

const check = (label, cwd, cmd) =>
    new Promise((resolve) => {
        exec(cmd, { cwd }, (err, _stdout, stderr) => {
            resolve(err ? { name: label, errors: stderr || "" } : null);
        });
    });

// _shared/*.ts is the highest fan-in code in the repo — most functions import it,
// so check it explicitly rather than relying on transitive coverage.
const checks = [
    check("_shared", path.join(FUNCTIONS_DIR, "_shared"), "deno check *.ts"),
    ...dirs.map((dir) =>
        check(dir.name, path.join(FUNCTIONS_DIR, dir.name), "deno check index.ts")
    ),
];

Promise.all(checks).then((results) => {
    const failures = results.filter(Boolean);
    const total = checks.length;
    const passed = total - failures.length;

    console.log(`[check:functions] ${passed} passed, ${failures.length} failed (${total} total)`);

    if (failures.length > 0) {
        for (const f of failures) {
            console.error(`\n--- ${f.name} ---`);
            console.error(f.errors);
        }
        process.exit(1);
    }
});
