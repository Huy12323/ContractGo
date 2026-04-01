#!/usr/bin/env node

/**
 * Plane Work Item — Update
 *
 * Updates a work item's description and/or fields.
 * Description is read from temp/plane/{IDENT}-{N}.html (saved by plane-item-get.js).
 *
 * Usage:
 *   node scripts/plane-item-update.js SPARK-34 --desc
 *   node scripts/plane-item-update.js <uuid> --state todo
 *   node scripts/plane-item-update.js SPARK-34 --state todo
 *   node scripts/plane-item-update.js SPARK-34 --priority high
 *   node scripts/plane-item-update.js SPARK-34 --estimate 3
 *   node scripts/plane-item-update.js SPARK-34 --name "New title"
 *   node scripts/plane-item-update.js SPARK-34 --parent SPARK-100
 *   node scripts/plane-item-update.js SPARK-34 --assignees uuid1,uuid2
 *   node scripts/plane-item-update.js SPARK-34 --start 2026-03-01
 *   node scripts/plane-item-update.js SPARK-34 --due 2026-03-07
 *   node scripts/plane-item-update.js SPARK-34 --labels uuid1,uuid2
 *   node scripts/plane-item-update.js SPARK-34 --add-to-cycle <cycle-uuid>
 *   node scripts/plane-item-update.js SPARK-34 --add-to-module <module-uuid>
 *   node scripts/plane-item-update.js SPARK-34 --desc --state done --priority high
 *
 * Flags:
 *   --desc                  Push temp/plane/{IDENT}-{N}.html as description_html
 *   --state <name>          Set state: backlog, todo, in_progress, done, cancelled
 *   --priority <name>       Set priority: urgent, high, medium, low, none
 *   --estimate <value>      Set estimate: 1, 2, 3, 5, 8, 13
 *   --name <text>           Set work item name/title
 *   --parent <IDENT-N|uuid>  Set parent (accepts identifier or UUID)
 *   --assignees <uuids>     Set assignees (comma-separated UUIDs)
 *   --start <YYYY-MM-DD>    Set start_date
 *   --due <YYYY-MM-DD>      Set target_date
 *   --labels <uuids>        Set labels (comma-separated UUIDs)
 *   --add-to-cycle <uuid>   Add item to a cycle (POST, separate from PATCH)
 *   --add-to-module <uuid>  Add item to a module (POST, separate from PATCH)
 *
 * At least one flag is required.
 *
 * Requires: .env with PLANE_API_KEY, PLANE_BASE_URL, PLANE_WORKSPACE_SLUG
 * Requires: config.json with PROJECT_ID, state UUIDs, estimate UUIDs
 */

const fs = require("fs");
const path = require("path");
const { parseIdentifier } = require("./lib/plane-parse-id");
const { loadConfig, parseFlags, buildStateMap, buildEstimateReverse } = require("./lib/config");

// --- Load config ---
const { workspace, project, args: cliArgs } = parseFlags(process.argv.slice(2));
const config = loadConfig(workspace, project).project;
const PROJECT_ID = config.PLANE_PROJECT_ID;
const IDENTIFIER = config.PLANE_PROJECT_IDENTIFIER || "ITEM";

const STATE_MAP = buildStateMap(config);
const ESTIMATE_REVERSE = buildEstimateReverse(config);

// --- Resolve identifier to UUID ---
async function resolveToUuid(wsBase, headers, identArg) {
  const input = parseIdentifier(identArg);
  if (!input) throw new Error(`Invalid identifier: ${identArg}`);
  if (input.type === "uuid") return input.value;
  const r = await fetch(`${wsBase}/work-items/${IDENTIFIER}-${input.value}/`, { headers });
  if (r.status !== 200) throw new Error(`Cannot resolve ${IDENTIFIER}-${input.value}: HTTP ${r.status}`);
  const data = await r.json();
  return data.id;
}

// --- Parse CLI args ---
function parseArgs(args) {
  const opts = {
    input: null, desc: false, state: null, priority: null, estimate: null,
    name: null, parent: null, assignees: null, start: null, due: null,
    labels: null, addToCycle: null, addToModule: null,
  };
  opts.input = parseIdentifier(args[0]);
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
    } else if (flag === "--name" && i < args.length) {
      opts.name = args[i++];
    } else if (flag === "--parent" && i < args.length) {
      opts.parent = args[i++];
    } else if (flag === "--assignees" && i < args.length) {
      opts.assignees = args[i++].split(",").map(s => s.trim()).filter(Boolean);
    } else if (flag === "--start" && i < args.length) {
      opts.start = args[i++];
    } else if (flag === "--due" && i < args.length) {
      opts.due = args[i++];
    } else if (flag === "--labels" && i < args.length) {
      opts.labels = args[i++].split(",").map(s => s.trim()).filter(Boolean);
    } else if (flag === "--add-to-cycle" && i < args.length) {
      opts.addToCycle = args[i++];
    } else if (flag === "--add-to-module" && i < args.length) {
      opts.addToModule = args[i++];
    } else {
      console.error(`Unknown flag: ${flag}`);
      process.exit(1);
    }
  }
  return opts;
}

function hasAnyFlag(opts) {
  return opts.desc || opts.state || opts.priority || opts.estimate ||
    opts.name || opts.parent || opts.assignees || opts.start || opts.due ||
    opts.labels || opts.addToCycle || opts.addToModule;
}

function printUsage() {
  console.error(`Usage: node scripts/plane-item-update.js <${IDENTIFIER}-N|uuid> <flags>`);
  console.error("");
  console.error("PATCH flags (update fields):");
  console.error("  --desc                  Push description from temp file");
  console.error("  --state <name>          " + Object.keys(STATE_MAP).join(", "));
  console.error("  --priority <name>       urgent, high, medium, low, none");
  console.error("  --estimate <value>      " + Object.keys(ESTIMATE_REVERSE).join(", "));
  console.error("  --name <text>           Set name/title");
  console.error(`  --parent <${IDENTIFIER}-N>     Set parent work item`);
  console.error("  --assignees <uuids>     Comma-separated assignee UUIDs");
  console.error("  --start <YYYY-MM-DD>    Set start date");
  console.error("  --due <YYYY-MM-DD>      Set due date");
  console.error("  --labels <uuids>        Comma-separated label UUIDs");
  console.error("");
  console.error("POST flags (add to cycle/module):");
  console.error("  --add-to-cycle <uuid>   Add to cycle");
  console.error("  --add-to-module <uuid>  Add to module");
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
  const wsBase = `${config.PLANE_BASE_URL}/api/v1/workspaces/${config.PLANE_WORKSPACE_SLUG}`;
  const projBase = `${wsBase}/projects/${PROJECT_ID}`;
  const headers = { "X-API-Key": config.PLANE_API_KEY };

  // Resolve identifier → item (UUID uses project-level, SPARK-N uses workspace-level)
  const label = input.type === "uuid" ? input.value.slice(0, 8) + "..." : `${IDENTIFIER}-${input.value}`;
  console.log(`Resolving ${label}...`);
  const getUrl = input.type === "uuid"
    ? `${projBase}/work-items/${input.value}/`
    : `${wsBase}/work-items/${IDENTIFIER}-${input.value}/`;
  const getRes = await fetch(getUrl, { headers });

  if (getRes.status !== 200) {
    console.error(`${label}: HTTP ${getRes.status}`);
    if (getRes.status === 404) {
      console.error("Not found — for intake items use plane-intake-update.js instead.");
    }
    process.exit(1);
  }

  const item = await getRes.json();
  const seqId = item.sequence_id;
  console.log(`Item: ${item.name}`);

  // Build PATCH body
  const body = {};
  let hasPatch = false;

  if (opts.desc) {
    const tempFile = path.join(__dirname, "..", "temp", "plane", `${IDENTIFIER}-${seqId}.html`);
    if (!fs.existsSync(tempFile)) {
      console.error(`Temp file not found: ${tempFile}`);
      console.error("Run plane-item-get.js first to save the description.");
      process.exit(1);
    }
    body.description_html = fs.readFileSync(tempFile, "utf-8");
    console.log(`  description: ${body.description_html.length} chars`);
    hasPatch = true;
  }

  if (opts.state) {
    const uuid = STATE_MAP[opts.state];
    if (!uuid) {
      console.error(`Unknown state: ${opts.state}. Use: ${Object.keys(STATE_MAP).join(", ")}`);
      process.exit(1);
    }
    body.state = uuid;
    console.log(`  state: ${opts.state}`);
    hasPatch = true;
  }

  if (opts.priority) {
    const valid = ["urgent", "high", "medium", "low", "none"];
    if (!valid.includes(opts.priority)) {
      console.error(`Unknown priority: ${opts.priority}. Use: ${valid.join(", ")}`);
      process.exit(1);
    }
    body.priority = opts.priority;
    console.log(`  priority: ${opts.priority}`);
    hasPatch = true;
  }

  if (opts.estimate) {
    const uuid = ESTIMATE_REVERSE[opts.estimate];
    if (!uuid) {
      console.error(`Unknown estimate: ${opts.estimate}. Use: ${Object.keys(ESTIMATE_REVERSE).join(", ")}`);
      process.exit(1);
    }
    body.estimate_point = uuid;
    console.log(`  estimate: ${opts.estimate} pts`);
    hasPatch = true;
  }

  if (opts.name) {
    body.name = opts.name;
    console.log(`  name: ${opts.name}`);
    hasPatch = true;
  }

  if (opts.parent) {
    body.parent = await resolveToUuid(wsBase, headers, opts.parent);
    console.log(`  parent: ${body.parent}`);
    hasPatch = true;
  }

  if (opts.assignees) {
    body.assignees = opts.assignees;
    console.log(`  assignees: ${opts.assignees.join(", ")}`);
    hasPatch = true;
  }

  if (opts.start) {
    body.start_date = opts.start;
    console.log(`  start: ${opts.start}`);
    hasPatch = true;
  }

  if (opts.due) {
    body.target_date = opts.due;
    console.log(`  due: ${opts.due}`);
    hasPatch = true;
  }

  if (opts.labels) {
    body.labels = opts.labels;
    console.log(`  labels: ${opts.labels.join(", ")}`);
    hasPatch = true;
  }

  // PATCH via project-level endpoint
  if (hasPatch) {
    const patchRes = await fetch(`${projBase}/work-items/${item.id}/`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (patchRes.status !== 200) {
      const text = await patchRes.text();
      console.error(`PATCH failed: HTTP ${patchRes.status}\n${text}`);
      process.exit(1);
    }
    console.log(`  PATCH: OK`);
  }

  // Add to cycle (POST)
  if (opts.addToCycle) {
    const cycleRes = await fetch(`${projBase}/cycles/${opts.addToCycle}/cycle-issues/`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ issues: [item.id] }),
    });
    if (cycleRes.status !== 200 && cycleRes.status !== 201) {
      const text = await cycleRes.text();
      console.error(`Add to cycle failed: HTTP ${cycleRes.status}\n${text}`);
      process.exit(1);
    }
    console.log(`  add-to-cycle: ${opts.addToCycle}`);
  }

  // Add to module (POST)
  if (opts.addToModule) {
    const modRes = await fetch(`${projBase}/modules/${opts.addToModule}/module-issues/`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ issues: [item.id] }),
    });
    if (modRes.status !== 200 && modRes.status !== 201) {
      const text = await modRes.text();
      console.error(`Add to module failed: HTTP ${modRes.status}\n${text}`);
      process.exit(1);
    }
    console.log(`  add-to-module: ${opts.addToModule}`);
  }

  console.log(`\nUpdated ${IDENTIFIER}-${seqId}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
