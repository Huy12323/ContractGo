#!/usr/bin/env node

/**
 * Wrangler Auto-Restart
 *
 * Spawns `wrangler dev` in cloudflare/workers/files and restarts it every
 * RESTART_INTERVAL_MS, with a .wrangler/ cache clean before each start.
 *
 * Two different restarts, on purpose:
 *   - SCHEDULED, every RESTART_INTERVAL_MS — unlimited, that is the whole job.
 *   - CRASH, when wrangler exits on its own — capped at MAX_CRASH_RESTARTS,
 *     because a worker that cannot start at all exits instantly and would
 *     otherwise loop forever, hiding the real error under its own output.
 *
 * Why: after ~1 hour, Miniflare isolate recycling makes env.FILES_BUCKET
 * binding go stale and R2 fetches fail (uploads still work — they use
 * presigned URLs that bypass the Worker). Proactive restarts dodge this.
 *
 * Loads CLOUDFLARE_API_TOKEN from root .env and forwards it into the spawned
 * wrangler subprocess. Needed because wrangler.toml points at the AIUR
 * Cloudflare account, but the local OAuth session is for a different account;
 * remote = true R2 bindings fail with 403 without an explicit token.
 */

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const RESTART_INTERVAL_MS = 15 * 60 * 1000;
const WORKER_DIR = path.join(__dirname, "../cloudflare/workers/files");
const IS_WINDOWS = process.platform === "win32";

// How many times to retry after wrangler exits on its own before giving up.
//
// Without a cap this loop is infinite: a wrangler that cannot start at all —
// bad CLOUDFLARE_API_TOKEN, port 8787 already bound, a syntax error in the
// worker — exits immediately, gets restarted a second later, and repeats
// forever, burying the actual error in its own scroll. Five attempts is enough
// to ride out a transient port release; beyond that it is a real fault and the
// only useful thing to do is stop and show it.
const MAX_CRASH_RESTARTS = 5;

// A process that stayed up this long was working, so a later exit is a fresh
// fault rather than a continuation of a failed-start loop. Without this, a
// worker that dies once after six healthy hours would spend one of its five
// lives permanently — after five such days the script would refuse to start.
const HEALTHY_UPTIME_MS = 60 * 1000;

let wranglerProcess = null;
let restartCount = 0;
let restartTimer = null;
let isRestarting = false;
let crashCount = 0;
let startedAt = 0;

function killProcessTree(pid) {
    try {
        if (IS_WINDOWS) {
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
        } else {
            process.kill(-pid, "SIGKILL");
        }
    } catch {
        // Process may have already exited
    }
}

function cleanWranglerCache(retries = 5, delay = 1000) {
    const wranglerDir = path.join(WORKER_DIR, ".wrangler");

    if (!fs.existsSync(wranglerDir)) return true;

    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] Cleaning .wrangler directory...`);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            fs.rmSync(wranglerDir, { recursive: true, force: true });
            return true;
        } catch (err) {
            if (err.code === "EPERM" || err.code === "EBUSY") {
                if (attempt < retries) {
                    console.log(
                        `[${new Date().toLocaleTimeString()}] Directory locked, retry ${attempt}/${retries} in ${delay}ms...`
                    );
                    const end = Date.now() + delay;
                    while (Date.now() < end) {
                        // Synchronous wait — intentional; can't await inside the retry window
                        // without restructuring, and the window is short.
                    }
                } else {
                    console.log(
                        `[${new Date().toLocaleTimeString()}] Could not clean .wrangler after ${retries} attempts, continuing anyway...`
                    );
                    return false;
                }
            } else {
                throw err;
            }
        }
    }
    return false;
}

function startWrangler() {
    isRestarting = false;
    cleanWranglerCache();
    restartCount++;
    startedAt = Date.now();

    const timestamp = new Date().toLocaleTimeString();
    console.log(`\n[${timestamp}] Starting Wrangler (restart #${restartCount})...`);
    console.log(`[${timestamp}] Next auto-restart in 15 minutes\n`);

    wranglerProcess = spawn("npx", ["wrangler", "dev"], {
        cwd: WORKER_DIR,
        stdio: "inherit",
        shell: true,
        env: {
            ...process.env,
            CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
        },
    });

    wranglerProcess.on("error", (err) => {
        console.error("Failed to start Wrangler:", err);
    });

    wranglerProcess.on("exit", (code, signal) => {
        // A planned restart nulls `wranglerProcess` before killing, so this
        // branch only ever sees exits wrangler decided on by itself.
        if (isRestarting || !wranglerProcess) return;

        wranglerProcess = null;
        const uptimeMs = Date.now() - startedAt;
        const now = new Date().toLocaleTimeString();

        // Survived long enough to have been working, so this is a new fault and
        // gets the full retry budget again.
        if (uptimeMs >= HEALTHY_UPTIME_MS) crashCount = 0;

        crashCount++;

        const reason = signal ? `signal ${signal}` : `exit code ${code}`;

        if (crashCount > MAX_CRASH_RESTARTS) {
            console.error(
                `\n[${now}] Wrangler exited (${reason}) after ${Math.round(uptimeMs / 1000)}s — ` +
                    `${MAX_CRASH_RESTARTS} restart attempts exhausted, giving up.`
            );
            console.error(
                `[${now}] It is failing to start rather than crashing at random. Check, in order: ` +
                    `CLOUDFLARE_API_TOKEN in the root .env, whether port 8787 is already bound, ` +
                    `and the worker's own output above — the real error is in the first failure, ` +
                    `not the last.`
            );
            if (restartTimer) clearTimeout(restartTimer);
            process.exit(1);
        }

        console.log(
            `[${now}] Wrangler exited (${reason}) after ${Math.round(uptimeMs / 1000)}s, ` +
                `restarting (attempt ${crashCount}/${MAX_CRASH_RESTARTS})...`
        );
        setTimeout(startWrangler, 1000);
    });

    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(restartWrangler, RESTART_INTERVAL_MS);
}

function restartWrangler() {
    if (isRestarting) return;
    isRestarting = true;

    // Reaching a scheduled restart means the worker ran the full interval, so
    // the crash budget is spent on nothing and resets. The exit handler cannot
    // do this for us — a planned kill returns early there by design.
    crashCount = 0;

    const timestamp = new Date().toLocaleTimeString();
    console.log(`\n[${timestamp}] Auto-restarting Wrangler to prevent R2 binding degradation...`);

    if (wranglerProcess && wranglerProcess.pid) {
        const pid = wranglerProcess.pid;
        wranglerProcess = null;

        console.log(`[${timestamp}] Killing process tree (PID: ${pid})...`);
        killProcessTree(pid);

        console.log(`[${timestamp}] Waiting for processes to release file handles...`);
        setTimeout(startWrangler, 2000);
    } else {
        startWrangler();
    }
}

startWrangler();

function gracefulShutdown() {
    console.log("\n\nShutting down Wrangler...");
    if (restartTimer) clearTimeout(restartTimer);
    if (wranglerProcess && wranglerProcess.pid) {
        killProcessTree(wranglerProcess.pid);
    }
    process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
