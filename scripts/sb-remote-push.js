#!/usr/bin/env node

/**
 * Deploy Supabase to a remote environment — migrations and/or edge functions.
 *
 * Usage:
 *   node scripts/sb-remote-push.js <env> <task>
 *
 *   env:  staging | production        (reads .env.stag or .env.prod)
 *   task: push | functions | deploy   (push = migrations, functions = tar-over-ssh, deploy = both)
 *
 * Examples:
 *   pnpm sb:staging:push              →  migrations only to staging
 *   pnpm sb:staging:functions         →  edge functions only to staging
 *   pnpm sb:production:deploy         →  migrations + edge functions to production
 *
 * Required vars in .env.<env>:
 *   SUPABASE_DB_URL                  — Supavisor session-mode pooler URL (for migrations)
 *   DEPLOY_SSH_TARGET                — SSH destination, e.g. "root@5.78.184.149" or an SSH config alias
 *   DEPLOY_REMOTE_FUNCTIONS_PATH     — path on server to the functions volume dir
 *   DEPLOY_SSH_OPTS                  — (optional) extra ssh flags, e.g. "-i ~/.ssh/aiurhr -p 22"
 *
 * See docs/deployment.md for the full setup guide.
 */

const { execSync } = require("child_process");
const { config } = require("dotenv");
const path = require("path");

const ENV_ALIASES = { staging: "stag", production: "prod" };
const VALID_TASKS = ["push", "functions", "deploy"];

const [env, task = "deploy"] = process.argv.slice(2);

if (!env || !ENV_ALIASES[env]) {
    console.error(`Usage: node scripts/sb-remote-push.js <staging|production> <push|functions|deploy>`);
    process.exit(1);
}
if (!VALID_TASKS.includes(task)) {
    console.error(`Invalid task "${task}". Must be one of: ${VALID_TASKS.join(", ")}`);
    process.exit(1);
}

const envSuffix = ENV_ALIASES[env];
const envFile = path.resolve(__dirname, "..", `.env.${envSuffix}`);
const result = config({ path: envFile });

if (result.error) {
    console.error(`Error: Could not read .env.${envSuffix}`);
    console.error(`Copy .env.example -> .env.${envSuffix} and fill in ${env} values.`);
    process.exit(1);
}

const {
    SUPABASE_DB_URL,
    DEPLOY_SSH_TARGET,
    DEPLOY_REMOTE_FUNCTIONS_PATH,
    DEPLOY_SSH_OPTS = "",
} = result.parsed;

const requiredForPush = { SUPABASE_DB_URL };
const requiredForFunctions = { DEPLOY_SSH_TARGET, DEPLOY_REMOTE_FUNCTIONS_PATH };
const required = task === "push" ? requiredForPush
    : task === "functions" ? requiredForFunctions
    : { ...requiredForPush, ...requiredForFunctions };

const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
    console.error(`Missing required vars in .env.${envSuffix}: ${missing.join(", ")}`);
    console.error("See docs/deployment.md for setup instructions.");
    process.exit(1);
}

const cwd = path.resolve(__dirname, "..", "frontend", "vite");
const run = (cmd) => execSync(cmd, { cwd, stdio: "inherit" });
const label = env.toUpperCase();

if (task === "push" || task === "deploy") {
    console.log(`[migrations] Pushing to ${label} via Supavisor pooler...\n`);
    // --debug is required: Supavisor doesn't terminate TLS, and the CLI's pgx
    // driver only falls back to plaintext when debug logging is enabled (CLI bug).
    run(`supabase db push --db-url "${SUPABASE_DB_URL}" --debug`);
}

if (task === "functions" || task === "deploy") {
    console.log(`\n[functions] Uploading edge functions to ${label} via tar-over-ssh...\n`);
    const sshCmd = `ssh ${DEPLOY_SSH_OPTS} ${DEPLOY_SSH_TARGET}`.replace(/\s+/g, " ").trim();
    run(
        `tar cf - --exclude='main' --exclude='.env' --exclude='.env.*' ` +
        `-C supabase/functions . | ` +
        `${sshCmd} "cd '${DEPLOY_REMOTE_FUNCTIONS_PATH}' && tar xf -"`
    );
}

console.log(`\n${label} ${task} complete.`);
