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
 *   node scripts/plane-intake-update.js SPARK-23 --desc
 *   node scripts/plane-intake-update.js SPARK-23 --priority high
 *   node scripts/plane-intake-update.js SPARK-23 --state todo
 *   node scripts/plane-intake-update.js SPARK-23 --name "Updated title"
 *   node scripts/plane-intake-update.js SPARK-23 --assignees uuid1,uuid2
 *   node scripts/plane-intake-update.js SPARK-23 --labels uuid1,uuid2
 *   node scripts/plane-intake-update.js SPARK-23 --desc --priority medium --state todo
 *
 * Flags:
 *   --desc              Push temp/plane/{IDENT}-{N}.html as description_html
 *   --priority <name>   Set priority: urgent, high, medium, low, none
 *   --state <name>      Set work item state: backlog, todo, in_progress, done, cancelled
 *   --name <text>       Set work item name/title
 *   --assignees <uuids> Set assignees (comma-separated UUIDs)
 *   --labels <uuids>    Set labels (comma-separated UUIDs)
 *
 * At least one flag is required.
 *
 * Note: --state sets the work item state (Backlog, Todo, etc.), NOT the intake
 * status (Pending, Accepted, etc.). For intake status changes, use the Plane UI
 * or MCP update_intake_work_item.
 *
 * Requires: .env with PLANE_API_KEY, PLANE_BASE_URL, PLANE_WORKSPACE_SLUG
 * Requires: config.json with PROJECT_ID, state UUIDs
 */

const fs = require("fs");
const path = require("path");
const { parseIdentifier } = require("./lib/plane-parse-id");
const { loadConfig, parseFlags, buildStateMap } = require("./lib/config");

// --- Load config ---
const { workspace, project, args: cliArgs } = parseFlags(process.argv.slice(2));
const config = loadConfig(workspace, project).project;
const PROJECT_ID = config.PLANE_PROJECT_ID;
const IDENTIFIER = config.PLANE_PROJECT_IDENTIFIER || "ITEM";

const STATE_MAP = buildStateMap(config);

// --- Parse CLI args ---
function parseArgs(args) {
  const opts = {
    input: null, desc: false, priority: null, state: null,
    name: null, assignees: null, labels: null,
  };
  opts.input = parseIdentifier(args[0]);
  let i = 1;
  while (i < args.length) {
    const flag = args[i++];
    if (flag === "--desc") {
      opts.desc = true;
    } else if (flag === "--priority" && i < args.length) {
      opts.priority = args[i++].toLowerCase();
    } else if (flag === "--state" && i < args.length) {
      opts.state = args[i++].toLowerCase();
    } else if (flag === "--name" && i < args.length) {
      opts.name = args[i++];
    } else if (flag === "--assignees" && i < args.length) {
      opts.assignees = args[i++].split(",").map(s => s.trim()).filter(Boolean);
    } else if (flag === "--labels" && i < args.length) {
      opts.labels = args[i++].split(",").map(s => s.trim()).filter(Boolean);
    } else {
      console.error(`Unknown flag: ${flag}`);
      process.exit(1);
    }
  }
  return opts;
}

function hasAnyFlag(opts) {
  return opts.desc || opts.priority || opts.state || opts.name || opts.assignees || opts.labels;
}

function printUsage() {
  console.error(`Usage: node scripts/plane-intake-update.js <${IDENTIFIER}-N|uuid> <flags>`);
  console.error("");
  console.error("Flags:");
  console.error("  --desc              Push description from temp file");
  console.error("  --priority <name>   urgent, high, medium, low, none");
  console.error("  --state <name>      " + Object.keys(STATE_MAP).join(", "));
  console.error("  --name <text>       Set name/title");
  console.error("  --assignees <uuids> Comma-separated assignee UUIDs");
  console.error("  --labels <uuids>    Comma-separated label UUIDs");
}

// --- Fetch all intake items ---
async function fetchIntakeItems() {
  const url = `${config.PLANE_BASE_URL}/api/v1/workspaces/${config.PLANE_WORKSPACE_SLUG}/projects/${PROJECT_ID}/intake-issues/`;
  const res = await fetch(url, { headers: { "X-API-Key": config.PLANE_API_KEY } });
  if (res.status !== 200) {
    throw new Error(`Intake list: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.results || data;
}

// --- Main ---
async function main() {
  const opts = parseArgs(cliArgs);

  if (!opts.input) {
    printUsage();
    process.exit(1);
  }

  if (!hasAnyFlag(opts)) {
    console.error("Error: must specify at least one flag.");
    printUsage();
    process.exit(1);
  }
  const input = opts.input;

  // Resolve intake item → work item UUID
  const label = input.type === "uuid" ? input.value.slice(0, 8) + "..." : `${IDENTIFIER}-${input.value}`;
  console.log(`Resolving ${label} in intake...`);
  const items = await fetchIntakeItems();
  const intake = input.type === "uuid"
    ? items.find((i) => i.issue_detail && i.issue_detail.id === input.value)
    : items.find((i) => i.issue_detail && i.issue_detail.sequence_id === input.value);

  if (!intake) {
    console.error(`${label} not found in intake items.`);
    console.error("If already accepted, use plane-item-update.js instead.");
    process.exit(1);
  }

  const det = intake.issue_detail;
  const seqId = det.sequence_id;
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

  if (opts.state) {
    const uuid = STATE_MAP[opts.state];
    if (!uuid) {
      console.error(`Unknown state: ${opts.state}. Use: ${Object.keys(STATE_MAP).join(", ")}`);
      process.exit(1);
    }
    body.state = uuid;
    console.log(`  state: ${opts.state}`);
  }

  if (opts.name) {
    body.name = opts.name;
    console.log(`  name: ${opts.name}`);
  }

  if (opts.assignees) {
    body.assignees = opts.assignees;
    console.log(`  assignees: ${opts.assignees.join(", ")}`);
  }

  if (opts.labels) {
    body.labels = opts.labels;
    console.log(`  labels: ${opts.labels.join(", ")}`);
  }

  // PATCH via project-level work-items endpoint (works for intake items too)
  const projBase = `${config.PLANE_BASE_URL}/api/v1/workspaces/${config.PLANE_WORKSPACE_SLUG}/projects/${PROJECT_ID}`;
  const patchRes = await fetch(`${projBase}/work-items/${workItemId}/`, {
    method: "PATCH",
    headers: {
      "X-API-Key": config.PLANE_API_KEY,
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
