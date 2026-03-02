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
 *   node scripts/plane-intake-get.js --list          # list all intake items
 *
 * Output: temp/plane/WCLV1-23.html
 *
 * Note: Accepted intake items (status=1) are also accessible via plane-item-get.js.
 * This script works for ALL intake statuses (pending, snoozed, accepted, rejected).
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
const BASE_URL = config.PLANE_BASE_URL;
const WORKSPACE_SLUG = config.PLANE_WORKSPACE_SLUG;

const INTAKE_STATUS_NAMES = {
  "-2": "Rejected",
  "-1": "Snoozed",
  "0": "Pending",
  "1": "Accepted",
};

function intakeStatusName(status) {
  return INTAKE_STATUS_NAMES[String(status)] || `Unknown (${status})`;
}

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
  const arg = process.argv[2];

  if (!arg) {
    console.error(`Usage: node scripts/plane-intake-get.js <${IDENTIFIER}-N>`);
    console.error(`       node scripts/plane-intake-get.js --list`);
    process.exit(1);
  }

  const env = loadEnv();

  // List mode
  if (arg === "--list") {
    const items = await fetchIntakeItems(env);
    listIntakeItems(items);
    return;
  }

  // Single item mode
  const seqId = parseId(arg);
  if (!seqId) {
    console.error(`Invalid identifier: ${arg}`);
    process.exit(1);
  }

  const items = await fetchIntakeItems(env);
  const intake = items.find((i) => i.issue_detail && i.issue_detail.sequence_id === seqId);

  if (!intake) {
    console.error(`${IDENTIFIER}-${seqId} not found in intake items.`);
    console.error("If already accepted, use plane-item-get.js instead.");
    process.exit(1);
  }

  const det = intake.issue_detail;

  // Print fields
  console.log(`Name:         ${det.name}`);
  console.log(`Identifier:   ${IDENTIFIER}-${det.sequence_id}`);
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
