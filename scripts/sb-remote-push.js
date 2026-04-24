#!/usr/bin/env node

/**
 * Deploy Supabase to remote production — migrations + edge functions.
 *
 * Usage: pnpm sb:production:deploy
 *
 * Reads SUPABASE_DB_URL from .env.prod (no env:apply needed).
 */

const { execSync } = require("child_process");
const { config } = require("dotenv");
const path = require("path");

const envFile = path.resolve(__dirname, "..", ".env.prod");
const result = config({ path: envFile });

if (result.error) {
    console.error("Error: Could not read .env.prod");
    console.error("Create it from .env.example: cp .env.example .env.prod");
    process.exit(1);
}

const dbUrl = result.parsed?.SUPABASE_DB_URL;
if (!dbUrl) {
    console.error("SUPABASE_DB_URL not found in .env.prod");
    process.exit(1);
}

const cwd = path.resolve(__dirname, "..", "frontend", "vite");
const run = (cmd) => execSync(cmd, { cwd, stdio: "inherit" });

console.log("Pushing migrations to production...\n");
// --debug is required: Supavisor doesn't terminate TLS, and the CLI's pgx
// driver only falls back to plaintext when debug logging is enabled (CLI bug).
run(`supabase db push --db-url "${dbUrl}" --debug`);

console.log("\nDeploying edge functions...\n");
run(`supabase functions deploy --db-url "${dbUrl}"`);
