#!/usr/bin/env node

/**
 * Plane Work Item — Update
 *
 * Updates a work item's description and/or fields.
 * Description is read from temp/plane/{IDENT}-{N}.html (saved by plane-item-get.js).
 *
 * Usage:
 *   node scripts/plane-item-update.js WCLV1-34 --desc
 *   node scripts/plane-item-update.js WCLV1-34 --state todo
 *   node scripts/plane-item-update.js WCLV1-34 --priority high
 *   node scripts/plane-item-update.js WCLV1-34 --estimate 3
 *   node scripts/plane-item-update.js WCLV1-34 --desc --state done --priority high
 *
 * Flags:
 *   --desc              Push temp/plane/{IDENT}-{N}.html as description_html
 *   --state <name>      Set state: backlog, todo, in_progress, done, cancelled
 *   --priority <name>   Set priority: urgent, high, medium, low, none
 *   --estimate <value>  Set estimate: 1, 2, 3, 5, 8, 13
 *
 * At least one flag is required.
 *
 * Requires: .env with PLANE_API_KEY, PLANE_BASE_URL, PLANE_WORKSPACE_SLUG
 * Requires: project-config.json with PROJECT_ID, state UUIDs, estimate UUIDs
 */

const fs = require("fs");
const path = require("path");

// --- Load project config ---
function loadProjectConfig() {
  const configPath = path.join(__dirname, "..", "project-config.json");
  if (!fs.existsSync(configPath)) {
    console.error("project-config.json not found. Run: node scripts/setup-po.js --init");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

const config = loadProjectConfig();
const PROJECT_ID = config.PLANE_PROJECT_ID;
const IDENTIFIER = config.PLANE_PROJECT_IDENTIFIER || "ITEM";

// State name → UUID
const STATE_MAP = {};
if (config.STATE_BACKLOG_UUID) STATE_MAP["backlog"] = config.STATE_BACKLOG_UUID;
if (config.STATE_TODO_UUID) STATE_MAP["todo"] = config.STATE_TODO_UUID;
if (config.STATE_IN_PROGRESS_UUID) STATE_MAP["in_progress"] = config.STATE_IN_PROGRESS_UUID;
if (config.STATE_DONE_UUID) STATE_MAP["done"] = config.STATE_DONE_UUID;
if (config.STATE_CANCELLED_UUID) STATE_MAP["cancelled"] = config.STATE_CANCELLED_UUID;

// Estimate value → UUID
const ESTIMATE_REVERSE = {};
if (config.ESTIMATE_1_UUID) ESTIMATE_REVERSE["1"] = config.ESTIMATE_1_UUID;
if (config.ESTIMATE_2_UUID) ESTIMATE_REVERSE["2"] = config.ESTIMATE_2_UUID;
if (config.ESTIMATE_3_UUID) ESTIMATE_REVERSE["3"] = config.ESTIMATE_3_UUID;
if (config.ESTIMATE_5_UUID) ESTIMATE_REVERSE["5"] = config.ESTIMATE_5_UUID;
if (config.ESTIMATE_8_UUID) ESTIMATE_REVERSE["8"] = config.ESTIMATE_8_UUID;
if (config.ESTIMATE_13_UUID) ESTIMATE_REVERSE["13"] = config.ESTIMATE_13_UUID;

// --- Read .env ---
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    console.error(".env not found. Create one with PLANE_API_KEY, PLANE_WORKSPACE_SLUG, PLANE_BASE_URL");
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const match = line.trim().match(/^([A-Z_]+)=(.+)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

// --- Parse IDENT-N or bare number ---
function parseId(arg) {
  if (!arg) return null;
  const match = arg.match(/(?:\w+-)?(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

// --- Parse CLI args ---
function parseArgs(args) {
  const opts = { seqId: null, desc: false, state: null, priority: null, estimate: null };
  opts.seqId = parseId(args[0]);
  let i = 1;
  while (i < args.length) {
    const flag = args[i++];
    if (flag === "--desc") {
      opts.desc = true;
    } else if (flag === "--state" && i < args.length) {
      opts.state = args[i++].toLowerCase();
    } else if (flag === "--priority" && i < args.length) {
      opts.priority = args[i++].toLowerCase();
    } else if (flag === "--estimate" && i < args.length) {
      opts.estimate = args[i++];
    } else {
      console.error(`Unknown flag: ${flag}`);
      process.exit(1);
    }
  }
  return opts;
}

function printUsage() {
  console.error(`Usage: node scripts/plane-item-update.js <${IDENTIFIER}-N> <flags>`);
  console.error("");
  console.error("Flags:");
  console.error("  --desc              Push description from temp file");
  console.error("  --state <name>      " + Object.keys(STATE_MAP).join(", "));
  console.error("  --priority <name>   urgent, high, medium, low, none");
  console.error("  --estimate <value>  " + Object.keys(ESTIMATE_REVERSE).join(", "));
}

// --- Main ---
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.seqId) {
    printUsage();
    process.exit(1);
  }

  if (!opts.desc && !opts.state && !opts.priority && !opts.estimate) {
    console.error("Error: must specify at least one flag.");
    printUsage();
    process.exit(1);
  }

  const env = loadEnv();
  const seqId = opts.seqId;
  const wsBase = `${env.PLANE_BASE_URL}/api/v1/workspaces/${env.PLANE_WORKSPACE_SLUG}`;

  // Resolve identifier → UUID
  console.log(`Resolving ${IDENTIFIER}-${seqId}...`);
  const getRes = await fetch(`${wsBase}/work-items/${IDENTIFIER}-${seqId}/`, {
    headers: { "X-API-Key": env.PLANE_API_KEY },
  });

  if (getRes.status !== 200) {
    console.error(`${IDENTIFIER}-${seqId}: HTTP ${getRes.status}`);
    if (getRes.status === 404) {
      console.error("Not found — for intake items use plane-intake-update.js instead.");
    }
    process.exit(1);
  }

  const item = await getRes.json();
  console.log(`Item: ${item.name}`);

  // Build PATCH body
  const body = {};

  if (opts.desc) {
    const tempFile = path.join(__dirname, "..", "temp", "plane", `${IDENTIFIER}-${seqId}.html`);
    if (!fs.existsSync(tempFile)) {
      console.error(`Temp file not found: ${tempFile}`);
      console.error("Run plane-item-get.js first to save the description.");
      process.exit(1);
    }
    body.description_html = fs.readFileSync(tempFile, "utf-8");
    console.log(`  description: ${body.description_html.length} chars`);
  }

  if (opts.state) {
    const uuid = STATE_MAP[opts.state];
    if (!uuid) {
      console.error(`Unknown state: ${opts.state}. Use: ${Object.keys(STATE_MAP).join(", ")}`);
      process.exit(1);
    }
    body.state = uuid;
    console.log(`  state: ${opts.state}`);
  }

  if (opts.priority) {
    const valid = ["urgent", "high", "medium", "low", "none"];
    if (!valid.includes(opts.priority)) {
      console.error(`Unknown priority: ${opts.priority}. Use: ${valid.join(", ")}`);
      process.exit(1);
    }
    body.priority = opts.priority;
    console.log(`  priority: ${opts.priority}`);
  }

  if (opts.estimate) {
    const uuid = ESTIMATE_REVERSE[opts.estimate];
    if (!uuid) {
      console.error(`Unknown estimate: ${opts.estimate}. Use: ${Object.keys(ESTIMATE_REVERSE).join(", ")}`);
      process.exit(1);
    }
    body.estimate_point = uuid;
    console.log(`  estimate: ${opts.estimate} pts`);
  }

  // PATCH via project-level endpoint
  const projBase = `${wsBase}/projects/${PROJECT_ID}`;
  const patchRes = await fetch(`${projBase}/work-items/${item.id}/`, {
    method: "PATCH",
    headers: {
      "X-API-Key": env.PLANE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (patchRes.status !== 200) {
    const text = await patchRes.text();
    console.error(`PATCH failed: HTTP ${patchRes.status}\n${text}`);
    process.exit(1);
  }

  console.log(`\nUpdated ${IDENTIFIER}-${seqId}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
