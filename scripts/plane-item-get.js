#!/usr/bin/env node

/**
 * Plane Work Item — Get
 *
 * Fetches a work item by identifier, prints key fields to stdout,
 * and saves description_html to temp/plane/{IDENT}-{N}.html for editing.
 *
 * Usage:
 *   node scripts/plane-item-get.js WCLV1-34
 *   node scripts/plane-item-get.js 34
 *
 * Output: temp/plane/WCLV1-34.html
 *
 * For pending intake items (404 here), use plane-intake-get.js instead.
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
const BASE_URL = config.PLANE_BASE_URL;
const WORKSPACE_SLUG = config.PLANE_WORKSPACE_SLUG;

const STATE_NAMES = {};
if (config.STATE_BACKLOG_UUID) STATE_NAMES[config.STATE_BACKLOG_UUID] = "Backlog";
if (config.STATE_TODO_UUID) STATE_NAMES[config.STATE_TODO_UUID] = "Todo";
if (config.STATE_IN_PROGRESS_UUID) STATE_NAMES[config.STATE_IN_PROGRESS_UUID] = "In Progress";
if (config.STATE_DONE_UUID) STATE_NAMES[config.STATE_DONE_UUID] = "Done";
if (config.STATE_CANCELLED_UUID) STATE_NAMES[config.STATE_CANCELLED_UUID] = "Cancelled";

const ESTIMATE_MAP = {};
if (config.ESTIMATE_1_UUID) ESTIMATE_MAP[config.ESTIMATE_1_UUID] = 1;
if (config.ESTIMATE_2_UUID) ESTIMATE_MAP[config.ESTIMATE_2_UUID] = 2;
if (config.ESTIMATE_3_UUID) ESTIMATE_MAP[config.ESTIMATE_3_UUID] = 3;
if (config.ESTIMATE_5_UUID) ESTIMATE_MAP[config.ESTIMATE_5_UUID] = 5;
if (config.ESTIMATE_8_UUID) ESTIMATE_MAP[config.ESTIMATE_8_UUID] = 8;
if (config.ESTIMATE_13_UUID) ESTIMATE_MAP[config.ESTIMATE_13_UUID] = 13;

function stateName(uuid) { return STATE_NAMES[uuid] || uuid || "none"; }
function estimateValue(uuid) { return ESTIMATE_MAP[uuid] || 0; }

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

// --- Main ---
async function main() {
  const seqId = parseId(process.argv[2]);
  if (!seqId) {
    console.error(`Usage: node scripts/plane-item-get.js <${IDENTIFIER}-N>`);
    process.exit(1);
  }

  const env = loadEnv();
  const wsBase = `${env.PLANE_BASE_URL}/api/v1/workspaces/${env.PLANE_WORKSPACE_SLUG}`;

  // Fetch by identifier (workspace-level endpoint)
  const url = `${wsBase}/work-items/${IDENTIFIER}-${seqId}/`;
  const res = await fetch(url, { headers: { "X-API-Key": env.PLANE_API_KEY } });

  if (res.status !== 200) {
    console.error(`${IDENTIFIER}-${seqId}: HTTP ${res.status}`);
    if (res.status === 404) {
      console.error("Not found — may be a pending intake item. Use plane-intake-get.js instead.");
    }
    process.exit(1);
  }

  const item = await res.json();

  // Print fields
  console.log(`Name:       ${item.name}`);
  console.log(`Identifier: ${IDENTIFIER}-${item.sequence_id}`);
  console.log(`UUID:       ${item.id}`);
  console.log(`State:      ${stateName(item.state)}`);
  console.log(`Priority:   ${item.priority || "none"}`);
  console.log(`Estimate:   ${estimateValue(item.estimate_point)} pts`);
  console.log(`Parent:     ${item.parent || "none (tier 1)"}`);
  console.log(`Assignees:  ${(item.assignees || []).join(", ") || "none"}`);
  console.log(`Start:      ${item.start_date || "none"}`);
  console.log(`Due:        ${item.target_date || "none"}`);
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
