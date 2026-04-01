#!/usr/bin/env node
/**
 * Get project configuration values from config.json.
 *
 * Usage:
 *   node scripts/config-get.js                         # all keys, one per line
 *   node scripts/config-get.js PLANE_PROJECT_ID        # single key → just the value
 *   node scripts/config-get.js PLANE_PROJECT_ID STATE_TODO_UUID  # multiple keys
 *   node scripts/config-get.js --json                  # full resolved config as JSON
 *   node scripts/config-get.js --workspace lc          # specific workspace/project
 *   node scripts/config-get.js --env                   # include resolved env vars
 */

const { loadConfig, parseFlags } = require("./lib/config");

const { workspace, project, args } = parseFlags(process.argv.slice(2));

// Extract our flags from remaining args
const jsonMode = args.includes("--json");
const envMode = args.includes("--env");
const keys = args.filter((a) => !a.startsWith("--"));

const config = loadConfig(workspace, project);

if (!config.project) {
  console.error("No project resolved. Check config.json.");
  process.exit(1);
}

const proj = config.project;

if (jsonMode) {
  // Full config as JSON
  console.log(JSON.stringify(proj, null, 2));
} else if (keys.length === 0) {
  // Dump all keys
  for (const [k, v] of Object.entries(proj)) {
    if (k === "env") continue; // skip raw env mapping (already resolved)
    if (typeof v === "object") continue; // skip nested objects
    console.log(`${k}=${v}`);
  }
  if (envMode) {
    // Also show which env vars were resolved
    console.log("\n# Resolved env vars:");
    const path = require("path");
    const fs = require("fs");
    const configPath = path.join(__dirname, "..", "config.json");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const defaultProj =
      project || raw.default_project;
    // Find original env mapping
    for (const ws of Object.values(raw.workspaces)) {
      const p = ws.projects?.[defaultProj];
      if (p?.env) {
        for (const [canonical, envVar] of Object.entries(p.env)) {
          console.log(`${canonical}=${envVar} → ${proj[canonical] ? "(set)" : "(missing)"}`);
        }
        break;
      }
    }
  }
} else if (keys.length === 1) {
  // Single key → just the value (easy for script capture)
  const val = proj[keys[0]];
  if (val === undefined) {
    console.error(`Key not found: ${keys[0]}`);
    console.error(`Available: ${Object.keys(proj).filter((k) => typeof proj[k] !== "object").join(", ")}`);
    process.exit(1);
  }
  console.log(val);
} else {
  // Multiple keys → key=value pairs
  for (const k of keys) {
    const val = proj[k];
    if (val === undefined) {
      console.error(`Key not found: ${k}`);
      process.exit(1);
    }
    console.log(`${k}=${val}`);
  }
}
