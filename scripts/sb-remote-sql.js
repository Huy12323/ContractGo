#!/usr/bin/env node

/**
 * Open an interactive psql session against a remote Supabase instance.
 *
 * Usage:
 *   node scripts/sb-remote-sql.js <env>
 *
 *   env: production        (reads .env.prod)
 *
 * Examples:
 *   pnpm sb:production:sql                →  interactive psql to production
 *   pnpm sb:production:sql -- -c "SELECT 1"  →  one-shot query
 */

const { execSync } = require("child_process");
const { config } = require("dotenv");
const path = require("path");

const ENV_ALIASES = { production: "prod" };

const [env, ...extra] = process.argv.slice(2);

if (!env || !ENV_ALIASES[env]) {
    console.error("Usage: node scripts/sb-remote-sql.js <production> [-- psql flags]");
    process.exit(1);
}

const envSuffix = ENV_ALIASES[env];
const envFile = path.resolve(__dirname, "..", `.env.${envSuffix}`);
const result = config({ path: envFile });

if (result.error) {
    console.error(`Error: Could not read .env.${envSuffix}`);
    process.exit(1);
}

const { SUPABASE_DB_URL } = result.parsed;

if (!SUPABASE_DB_URL) {
    console.error(`Missing SUPABASE_DB_URL in .env.${envSuffix}`);
    process.exit(1);
}

const args = extra.join(" ");
execSync(`psql "${SUPABASE_DB_URL}" ${args}`, { stdio: "inherit" });
