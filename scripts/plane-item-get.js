#!/usr/bin/env node

/**
 * Plane Work Item — Get
 *
 * Fetches a work item by identifier, prints key fields to stdout,
 * and saves description_html to temp/plane/{IDENT}-{N}.html for editing.
 *
 * Usage:
 *   node scripts/plane-item-get.js SPARK-34
 *   node scripts/plane-item-get.js 34
 *   node scripts/plane-item-get.js <uuid>
 *
 * Output: temp/plane/SPARK-34.html
 *
 * Fields printed: name, identifier, UUID, state, priority, estimate, parent,
 * assignees, start, due, cycle (YYYY/WW), modules (name + UUID), labels, browse URL.
 *
 * For pending intake items (404 here), use plane-intake-get.js instead.
 *
 * Requires: .env with PLANE_API_KEY, PLANE_BASE_URL, PLANE_WORKSPACE_SLUG
 * Requires: config.json with PROJECT_ID, state UUIDs, estimate UUIDs
 */

const fs = require("fs");
const path = require("path");
const { parseIdentifier } = require("./lib/plane-parse-id");
const { loadConfig, parseFlags, buildStateNames, buildEstimateMap } = require("./lib/config");
const { findCycleForItem, findModulesForItem } = require("./lib/plane-api");

// --- Load config ---
const { workspace, project, args: cliArgs } = parseFlags(process.argv.slice(2));
const config = loadConfig(workspace, project).project;
const PROJECT_ID = config.PLANE_PROJECT_ID;
const IDENTIFIER = config.PLANE_PROJECT_IDENTIFIER || "ITEM";
const BASE_URL = config.PLANE_BASE_URL;
const WORKSPACE_SLUG = config.PLANE_WORKSPACE_SLUG;

const STATE_NAMES = buildStateNames(config);
const ESTIMATE_MAP = buildEstimateMap(config);

function stateName(uuid) { return STATE_NAMES[uuid] || uuid || "none"; }
function estimateValue(uuid) { return ESTIMATE_MAP[uuid] || 0; }

// --- Main ---
async function main() {
  const input = parseIdentifier(cliArgs[0]);
  if (!input) {
    console.error(`Usage: node scripts/plane-item-get.js [--project <label>] <${IDENTIFIER}-N|uuid>`);
    process.exit(1);
  }

  const wsBase = `${config.PLANE_BASE_URL}/api/v1/workspaces/${config.PLANE_WORKSPACE_SLUG}`;
  const projBase = `${wsBase}/projects/${PROJECT_ID}`;
  const headers = { "X-API-Key": config.PLANE_API_KEY };

  // Fetch by UUID (project-level) or identifier (workspace-level)
  const url = input.type === "uuid"
    ? `${projBase}/work-items/${input.value}/`
    : `${wsBase}/work-items/${IDENTIFIER}-${input.value}/`;
  const res = await fetch(url, { headers });

  if (res.status !== 200) {
    const label = input.type === "uuid" ? input.value : `${IDENTIFIER}-${input.value}`;
    console.error(`${label}: HTTP ${res.status}`);
    if (res.status === 404) {
      console.error("Not found — may be a pending intake item. Use plane-intake-get.js instead.");
    }
    process.exit(1);
  }

  const item = await res.json();
  const seqId = item.sequence_id;

  // Resolve cycle and modules in parallel
  const [cycle, modules] = await Promise.all([
    findCycleForItem(projBase, headers, item.id),
    findModulesForItem(projBase, headers, item.id),
  ]);

  // Print fields
  console.log(`Name:       ${item.name}`);
  console.log(`Identifier: ${IDENTIFIER}-${seqId}`);
  console.log(`UUID:       ${item.id}`);
  console.log(`State:      ${stateName(item.state)}`);
  console.log(`Priority:   ${item.priority || "none"}`);
  console.log(`Estimate:   ${estimateValue(item.estimate_point)} pts`);
  console.log(`Parent:     ${item.parent || "none (tier 1)"}`);
  console.log(`Assignees:  ${(item.assignees || []).join(", ") || "none"}`);
  console.log(`Start:      ${item.start_date || "none"}`);
  console.log(`Due:        ${item.target_date || "none"}`);
  console.log(`Cycle:      ${cycle ? `${cycle.name} (${cycle.id})` : "none"}`);
  console.log(`Modules:    ${modules.length > 0 ? modules.map(m => `${m.name} (${m.id})`).join(", ") : "none"}`);
  console.log(`Labels:     ${(item.labels || []).join(", ") || "none"}`);
  console.log(`Created:    ${item.created_at}`);
  console.log(`Browse:     ${BASE_URL}/${WORKSPACE_SLUG}/browse/${IDENTIFIER}-${seqId}/`);

  // Save description
  const tempDir = path.join(__dirname, "..", "temp", "plane");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const descHtml = item.description_html || "";
  const outPath = path.join(tempDir, `${IDENTIFIER}-${seqId}.html`);
  fs.writeFileSync(outPath, descHtml);

  console.log(`\nDescription saved: ${outPath} (${descHtml.length} chars)`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
