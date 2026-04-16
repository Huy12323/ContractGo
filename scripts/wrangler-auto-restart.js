#!/usr/bin/env node

/**
 * Wrangler Auto-Restart
 *
 * Spawns `wrangler dev` in cloudflare/workers/files and restarts it every
 * RESTART_INTERVAL_MS, with a .wrangler/ cache clean before each start.
 *
 * Why: after ~1 hour, Miniflare isolate recycling makes env.FILES_BUCKET
 * binding go stale and R2 fetches fail (uploads still work — they use
 * presigned URLs that bypass the Worker). Proactive restarts dodge this.
 *
 * Ported from lightcraft (scripts/wrangler-auto-restart.js). Differences:
 *   - WORKER_DIR points at cloudflare/workers/files (AHR layout)
 *   - No dotenv load — wrangler.toml carries account_id; no env vars needed
 */

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const RESTART_INTERVAL_MS = 15 * 60 * 1000;
const WORKER_DIR = path.join(__dirname, "../cloudflare/workers/files");
const IS_WINDOWS = process.platform === "win32";

let wranglerProcess = null;
let restartCount = 0;
let restartTimer = null;
let isRestarting = false;

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
                        `[${new Date().toLocaleTimeString()}] Directory locked, retry ${attempt}/${retries} in ${delay}ms...`,
                    );
                    const end = Date.now() + delay;
                    while (Date.now() < end) {
                        // Synchronous wait — intentional; can't await inside the retry window
                        // without restructuring, and the window is short.
                    }
                } else {
                    console.log(
                        `[${new Date().toLocaleTimeString()}] Could not clean .wrangler after ${retries} attempts, continuing anyway...`,
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

    const timestamp = new Date().toLocaleTimeString();
    console.log(`\n[${timestamp}] Starting Wrangler (restart #${restartCount})...`);
    console.log(`[${timestamp}] Next auto-restart in 15 minutes\n`);

    wranglerProcess = spawn("npx", ["wrangler", "dev"], {
        cwd: WORKER_DIR,
        stdio: "inherit",
        shell: true,
    });

    wranglerProcess.on("error", (err) => {
        console.error("Failed to start Wrangler:", err);
    });

    wranglerProcess.on("exit", () => {
        if (!isRestarting && wranglerProcess) {
            console.log("Wrangler exited unexpectedly, restarting...");
            wranglerProcess = null;
            setTimeout(startWrangler, 1000);
        }
    });

    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(restartWrangler, RESTART_INTERVAL_MS);
}

function restartWrangler() {
    if (isRestarting) return;
    isRestarting = true;

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
