#!/usr/bin/env node

/**
 * Plane Work Item — Create
 *
 * Creates a new work item with all fields. Optionally reads description
 * from a temp file and adds to cycle/module after creation.
 *
 * Usage:
 *   node scripts/plane-item-create.js --name "Title" --state done
 *   node scripts/plane-item-create.js --name "Title" --state done --parent SPARK-100
 *   node scripts/plane-item-create.js --name "Title" --desc SPARK-200 --state todo \
 *     --priority medium --estimate 3 --assignees uuid1 --start 2026-03-01 --due 2026-03-07 \
 *     --add-to-cycle <cycle-uuid> --add-to-module <module-uuid>
 *
 * Flags:
 *   --name <text>           Work item name/title (REQUIRED)
 *   --desc <IDENT-N>        Read description from temp/plane/{IDENT-N}.html
 *   --desc-file <path>      Read description from arbitrary file path
 *   --state <name>          backlog, todo, in_progress, done, cancelled (default: backlog)
 *   --priority <name>       urgent, high, medium, low, none (default: none)
 *   --estimate <value>      1, 2, 3, 5, 8, 13
 *   --parent <IDENT-N|uuid>  Parent work item (accepts identifier or UUID)
 *   --assignees <uuids>     Comma-separated assignee UUIDs
 *   --start <YYYY-MM-DD>    Start date
 *   --due <YYYY-MM-DD>      Due date (target_date)
 *   --labels <uuids>        Comma-separated label UUIDs
 *   --add-to-cycle <uuid>   Add to cycle after creation
 *   --add-to-module <uuid>  Add to module after creation
 *
 * Output:
 *   Created: SPARK-1234 (uuid)
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
    name: null, desc: null, descFile: null, state: null, priority: null,
    estimate: null, parent: null, assignees: null, start: null, due: null,
    labels: null, addToCycle: null, addToModule: null,
  };
  let i = 0;
  while (i < args.length) {
    const flag = args[i++];
    if (flag === "--name" && i < args.length) {
      opts.name = args[i++];
    } else if (flag === "--desc" && i < args.length) {
      opts.desc = args[i++];
    } else if (flag === "--desc-file" && i < args.length) {
      opts.descFile = args[i++];
    } else if (flag === "--state" && i < args.length) {
      opts.state = args[i++].toLowerCase();
    } else if (flag === "--priority" && i < args.length) {
      opts.priority = args[i++].toLowerCase();
    } else if (flag === "--estimate" && i < args.length) {
      opts.estimate = args[i++];
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

function printUsage() {
  console.error(`Usage: node scripts/plane-item-create.js --name "Title" [flags]`);
  console.error("");
  console.error("Required:");
  console.error("  --name <text>           Work item title");
  console.error("");
  console.error("Optional PATCH fields:");
  console.error(`  --desc <${IDENTIFIER}-N>       Read description from temp/plane/{IDENT-N}.html`);
  console.error("  --desc-file <path>      Read description from file path");
  console.error("  --state <name>          " + Object.keys(STATE_MAP).join(", ") + " (default: backlog)");
  console.error("  --priority <name>       urgent, high, medium, low, none");
  console.error("  --estimate <value>      " + Object.keys(ESTIMATE_REVERSE).join(", "));
  console.error(`  --parent <${IDENTIFIER}-N>     Parent work item`);
  console.error("  --assignees <uuids>     Comma-separated UUIDs");
  console.error("  --start <YYYY-MM-DD>    Start date");
  console.error("  --due <YYYY-MM-DD>      Due date");
  console.error("  --labels <uuids>        Comma-separated UUIDs");
  console.error("");
  console.error("Post-create actions:");
  console.error("  --add-to-cycle <uuid>   Add to cycle");
  console.error("  --add-to-module <uuid>  Add to module");
}

// --- Main ---
async function main() {
  const opts = parseArgs(cliArgs);

  if (!opts.name) {
    console.error("Error: --name is required.");
    printUsage();
    process.exit(1);
  }

  const wsBase = `${config.PLANE_BASE_URL}/api/v1/workspaces/${config.PLANE_WORKSPACE_SLUG}`;
  const projBase = `${wsBase}/projects/${PROJECT_ID}`;
  const headers = { "X-API-Key": config.PLANE_API_KEY };

  // Build POST body
  const body = { name: opts.name };
  console.log(`Creating: ${opts.name}`);

  // Description
  if (opts.desc) {
    const descInput = parseIdentifier(opts.desc);
    const descLabel = descInput && descInput.type === "sequence" ? `${IDENTIFIER}-${descInput.value}` : opts.desc;
    const tempFile = path.join(__dirname, "..", "temp", "plane", `${descLabel}.html`);
    if (!fs.existsSync(tempFile)) {
      console.error(`Temp file not found: ${tempFile}`);
      process.exit(1);
    }
    body.description_html = fs.readFileSync(tempFile, "utf-8");
    console.log(`  description: ${body.description_html.length} chars (from ${tempFile})`);
  } else if (opts.descFile) {
    if (!fs.existsSync(opts.descFile)) {
      console.error(`Description file not found: ${opts.descFile}`);
      process.exit(1);
    }
    body.description_html = fs.readFileSync(opts.descFile, "utf-8");
    console.log(`  description: ${body.description_html.length} chars (from ${opts.descFile})`);
  }

  // State
  if (opts.state) {
    const uuid = STATE_MAP[opts.state];
    if (!uuid) {
      console.error(`Unknown state: ${opts.state}. Use: ${Object.keys(STATE_MAP).join(", ")}`);
      process.exit(1);
    }
    body.state = uuid;
    console.log(`  state: ${opts.state}`);
  }

  // Priority
  if (opts.priority) {
    const valid = ["urgent", "high", "medium", "low", "none"];
    if (!valid.includes(opts.priority)) {
      console.error(`Unknown priority: ${opts.priority}. Use: ${valid.join(", ")}`);
      process.exit(1);
    }
    body.priority = opts.priority;
    console.log(`  priority: ${opts.priority}`);
  }

  // Estimate
  if (opts.estimate) {
    const uuid = ESTIMATE_REVERSE[opts.estimate];
    if (!uuid) {
      console.error(`Unknown estimate: ${opts.estimate}. Use: ${Object.keys(ESTIMATE_REVERSE).join(", ")}`);
      process.exit(1);
    }
    body.estimate_point = uuid;
    console.log(`  estimate: ${opts.estimate} pts`);
  }

  // Parent
  if (opts.parent) {
    body.parent = await resolveToUuid(wsBase, headers, opts.parent);
    console.log(`  parent: ${body.parent}`);
  }

  // Assignees
  if (opts.assignees) {
    body.assignees = opts.assignees;
    console.log(`  assignees: ${opts.assignees.join(", ")}`);
  }

  // Dates
  if (opts.start) {
    body.start_date = opts.start;
    console.log(`  start: ${opts.start}`);
  }
  if (opts.due) {
    body.target_date = opts.due;
    console.log(`  due: ${opts.due}`);
  }

  // Labels
  if (opts.labels) {
    body.labels = opts.labels;
    console.log(`  labels: ${opts.labels.join(", ")}`);
  }

  // POST to create
  const createRes = await fetch(`${projBase}/work-items/`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (createRes.status !== 201 && createRes.status !== 200) {
    const text = await createRes.text();
    console.error(`CREATE failed: HTTP ${createRes.status}\n${text}`);
    process.exit(1);
  }

  const created = await createRes.json();
  const ident = `${IDENTIFIER}-${created.sequence_id}`;
  console.log(`  POST: OK`);

  // Add to cycle
  if (opts.addToCycle) {
    const cycleRes = await fetch(`${projBase}/cycles/${opts.addToCycle}/cycle-issues/`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ issues: [created.id] }),
    });
    if (cycleRes.status !== 200 && cycleRes.status !== 201) {
      const text = await cycleRes.text();
      console.error(`Add to cycle failed: HTTP ${cycleRes.status}\n${text}`);
      process.exit(1);
    }
    console.log(`  add-to-cycle: ${opts.addToCycle}`);
  }

  // Add to module
  if (opts.addToModule) {
    const modRes = await fetch(`${projBase}/modules/${opts.addToModule}/module-issues/`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ issues: [created.id] }),
    });
    if (modRes.status !== 200 && modRes.status !== 201) {
      const text = await modRes.text();
      console.error(`Add to module failed: HTTP ${modRes.status}\n${text}`);
      process.exit(1);
    }
    console.log(`  add-to-module: ${opts.addToModule}`);
  }

  console.log(`\nCreated: ${ident} (${created.id})`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
