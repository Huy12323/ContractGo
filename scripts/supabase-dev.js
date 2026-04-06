#!/usr/bin/env node

/**
 * Supabase Dev Lifecycle Manager
 *
 * Wraps `supabase start` with:
 * 1. restart=no on all containers (prevents Docker Desktop auto-start)
 * 2. Exits after start so `concurrently` can run other services
 *
 * Clean shutdown: use `pnpm sb:dev:stop` or `supabase stop` separately.
 *
 * Requires: project_id in supabase/config.toml must match the repo name.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const SUPABASE_DIR = path.join(__dirname, "../frontend/vite");

function getSupabaseProjectId() {
    const configPath = path.join(SUPABASE_DIR, "supabase/config.toml");
    const content = fs.readFileSync(configPath, "utf-8");
    const match = content.match(/^project_id\s*=\s*"(.+)"/m);
    return match ? match[1] : null;
}

function disableAutoRestart(projectId) {
    try {
        const result = execSync(
            `docker ps -q --filter "label=com.supabase.cli.project=${projectId}"`,
            { encoding: "utf-8" }
        ).trim();

        if (!result) return;

        const containerIds = result.split("\n").filter(Boolean);
        console.log(`[supabase-dev] Setting restart=no on ${containerIds.length} containers`);

        for (const id of containerIds) {
            execSync(`docker update --restart=no ${id}`, { stdio: "ignore" });
        }
    } catch (err) {
        console.warn("[supabase-dev] Warning: Could not update restart policies:", err.message);
    }
}

function main() {
    const projectId = getSupabaseProjectId();
    console.log(`[supabase-dev] Starting Supabase (project: ${projectId})...\n`);

    try {
        execSync("supabase start", { cwd: SUPABASE_DIR, stdio: "inherit" });
    } catch (err) {
        console.log("[supabase-dev] Start failed, restarting (stop + start)...\n");
        try {
            execSync("supabase stop", { cwd: SUPABASE_DIR, stdio: "inherit" });
            execSync("supabase start", { cwd: SUPABASE_DIR, stdio: "inherit" });
        } catch (retryErr) {
            console.error("[supabase-dev] Failed to restart:", retryErr.message);
            process.exit(1);
        }
    }

    if (projectId) disableAutoRestart(projectId);
    console.log(`\n[supabase-dev] Supabase ready (restart=no applied).`);
}

main();
