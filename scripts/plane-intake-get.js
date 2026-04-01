#!/usr/bin/env node

/**
 * Plane Intake Item — Get
 *
 * Fetches a pending/snoozed intake item by identifier, prints key fields,
 * and saves description_html to temp/plane/{IDENT}-{N}.html for editing.
 *
 * Also supports listing all intake items.
 *
 * Usage:
 *   node scripts/plane-intake-get.js WCLV1-23       # get specific item + save desc
 *   node scripts/plane-intake-get.js 23              # bare number
 *   node scripts/plane-intake-get.js <uuid>          # by work item UUID
 *   node scripts/plane-intake-get.js --list          # list all intake items
 *
 * Output: temp/plane/WCLV1-23.html
 *
 * Note: Accepted intake items (status=1) are also accessible via plane-item-get.js.
 * This script works for ALL intake statuses (pending, snoozed, accepted, rejected).
 *
 * Requires: .env with PLANE_API_KEY, PLANE_BASE_URL, PLANE_WORKSPACE_SLUG
 * Requires: config.json with PROJECT_ID
 */

const fs = require("fs");
const path = require("path");
const { parseIdentifier } = require("./lib/plane-parse-id");
const { loadConfig, parseFlags } = require("./lib/config");

// --- Load config ---
const { workspace, project, args: cliArgs } = parseFlags(process.argv.slice(2));
const config = loadConfig(workspace, project).project;
const PROJECT_ID = config.PLANE_PROJECT_ID;
const IDENTIFIER = config.PLANE_PROJECT_IDENTIFIER || "ITEM";
const BASE_URL = config.PLANE_BASE_URL;
const WORKSPACE_SLUG = config.PLANE_WORKSPACE_SLUG;

const INTAKE_STATUS_NAMES = {
  "-2": "Pending",
  "-1": "Declined",
  "0": "Snoozed",
  "1": "Accepted",
};

function intakeStatusName(status) {
  return INTAKE_STATUS_NAMES[String(status)] || `Unknown (${status})`;
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

// --- List mode ---
function listIntakeItems(items) {
  if (items.length === 0) {
    console.log("No intake items found.");
    return;
  }

  console.log(`Intake items: ${items.length}\n`);

  // Group by status
  const groups = {};
  for (const item of items) {
    const status = intakeStatusName(item.status);
    if (!groups[status]) groups[status] = [];
    groups[status].push(item);
  }

  for (const [status, group] of Object.entries(groups)) {
    console.log(`--- ${status} (${group.length}) ---`);
    for (const item of group) {
      const det = item.issue_detail;
      console.log(`  ${IDENTIFIER}-${det.sequence_id}: ${det.name}`);
      console.log(`    Priority: ${det.priority || "none"} | Created: ${det.created_at}`);
    }
    console.log("");
  }
}

// --- Main ---
async function main() {
  const arg = cliArgs[0];

  if (!arg) {
    console.error(`Usage: node scripts/plane-intake-get.js [--project <label>] <${IDENTIFIER}-N|uuid>`);
    console.error(`       node scripts/plane-intake-get.js [--project <label>] --list`);
    process.exit(1);
  }

  // List mode
  if (arg === "--list") {
    const items = await fetchIntakeItems();
    listIntakeItems(items);
    return;
  }

  // Single item mode
  const input = parseIdentifier(arg);
  if (!input) {
    console.error(`Invalid identifier: ${arg}`);
    process.exit(1);
  }

  const items = await fetchIntakeItems();
  const intake = input.type === "uuid"
    ? items.find((i) => i.issue_detail && i.issue_detail.id === input.value)
    : items.find((i) => i.issue_detail && i.issue_detail.sequence_id === input.value);

  if (!intake) {
    const label = input.type === "uuid" ? input.value : `${IDENTIFIER}-${input.value}`;
    console.error(`${label} not found in intake items.`);
    console.error("If already accepted, use plane-item-get.js instead.");
    process.exit(1);
  }

  const det = intake.issue_detail;
  const seqId = det.sequence_id;

  // Print fields
  console.log(`Name:         ${det.name}`);
  console.log(`Identifier:   ${IDENTIFIER}-${seqId}`);
  console.log(`Work Item ID: ${det.id}`);
  console.log(`Wrapper ID:   ${intake.id}`);
  console.log(`Intake Status:${intakeStatusName(intake.status)}`);
  console.log(`Priority:     ${det.priority || "none"}`);
  console.log(`Assignees:    ${(det.assignees || []).join(", ") || "none"}`);
  console.log(`Labels:       ${(det.labels || []).join(", ") || "none"}`);
  console.log(`Created:      ${det.created_at}`);
  console.log(`Source:        ${intake.source || "unknown"}`);

  // Save description
  const tempDir = path.join(__dirname, "..", "temp", "plane");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const descHtml = det.description_html || "";
  const outPath = path.join(tempDir, `${IDENTIFIER}-${seqId}.html`);
  fs.writeFileSync(outPath, descHtml);

  console.log(`\nDescription saved: ${outPath} (${descHtml.length} chars)`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
