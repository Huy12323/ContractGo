#!/usr/bin/env node

/**
 * Plane Intake Item — Update
 *
 * Updates an intake item's description and/or fields.
 * Description is read from temp/plane/{IDENT}-{N}.html (saved by plane-intake-get.js).
 *
 * Uses PATCH /work-items/{uuid}/ which works for both regular and intake items.
 *
 * Usage:
 *   node scripts/plane-intake-update.js WCLV1-23 --desc
 *   node scripts/plane-intake-update.js WCLV1-23 --priority high
 *   node scripts/plane-intake-update.js WCLV1-23 --desc --priority medium
 *
 * Flags:
 *   --desc              Push temp/plane/{IDENT}-{N}.html as description_html
 *   --priority <name>   Set priority: urgent, high, medium, low, none
 *
 * At least one flag is required.
 *
 * Note: State updates on intake items use the work item state field (Backlog, Todo, etc.),
 * NOT the intake status (Pending, Accepted, etc.). For intake status changes, use
 * the Plane UI or MCP update_intake_work_item.
 *
 * Requires: .env with PLANE_API_KEY, PLANE_BASE_URL, PLANE_WORKSPACE_SLUG
 * Requires: project-config.json with PROJECT_ID
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
  const opts = { seqId: null, desc: false, priority: null };
  opts.seqId = parseId(args[0]);
  let i = 1;
  while (i < args.length) {
    const flag = args[i++];
    if (flag === "--desc") {
      opts.desc = true;
    } else if (flag === "--priority" && i < args.length) {
      opts.priority = args[i++].toLowerCase();
    } else {
      console.error(`Unknown flag: ${flag}`);
      process.exit(1);
    }
  }
  return opts;
}

function printUsage() {
  console.error(`Usage: node scripts/plane-intake-update.js <${IDENTIFIER}-N> <flags>`);
  console.error("");
  console.error("Flags:");
  console.error("  --desc              Push description from temp file");
  console.error("  --priority <name>   urgent, high, medium, low, none");
}

// --- Fetch all intake items ---
async function fetchIntakeItems(env) {
  const url = `${env.PLANE_BASE_URL}/api/v1/workspaces/${env.PLANE_WORKSPACE_SLUG}/projects/${PROJECT_ID}/intake-issues/`;
  const res = await fetch(url, { headers: { "X-API-Key": env.PLANE_API_KEY } });
  if (res.status !== 200) {
    throw new Error(`Intake list: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.results || data;
}

// --- Main ---
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.seqId) {
    printUsage();
    process.exit(1);
  }

  if (!opts.desc && !opts.priority) {
    console.error("Error: must specify at least one flag.");
    printUsage();
    process.exit(1);
  }

  const env = loadEnv();
  const seqId = opts.seqId;

  // Resolve intake item → work item UUID
  console.log(`Resolving ${IDENTIFIER}-${seqId} in intake...`);
  const items = await fetchIntakeItems(env);
  const intake = items.find((i) => i.issue_detail && i.issue_detail.sequence_id === seqId);

  if (!intake) {
    console.error(`${IDENTIFIER}-${seqId} not found in intake items.`);
    console.error("If already accepted, use plane-item-update.js instead.");
    process.exit(1);
  }

  const det = intake.issue_detail;
  const workItemId = det.id;
  console.log(`Item: ${det.name} (work item: ${workItemId})`);

  // Build PATCH body
  const body = {};

  if (opts.desc) {
    const tempFile = path.join(__dirname, "..", "temp", "plane", `${IDENTIFIER}-${seqId}.html`);
    if (!fs.existsSync(tempFile)) {
      console.error(`Temp file not found: ${tempFile}`);
      console.error("Run plane-intake-get.js first to save the description.");
      process.exit(1);
    }
    body.description_html = fs.readFileSync(tempFile, "utf-8");
    console.log(`  description: ${body.description_html.length} chars`);
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

  // PATCH via project-level work-items endpoint (works for intake items too)
  const projBase = `${env.PLANE_BASE_URL}/api/v1/workspaces/${env.PLANE_WORKSPACE_SLUG}/projects/${PROJECT_ID}`;
  const patchRes = await fetch(`${projBase}/work-items/${workItemId}/`, {
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
