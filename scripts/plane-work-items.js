#!/usr/bin/env node

/**
 * Plane Work Item Context
 *
 * Fetches a work item's tier 1 parent and all sibling tier 2 items.
 * Auto-detects whether the input is tier 1 (no parent) or tier 2 (has parent).
 * Outputs condensed markdown to cycles/.
 *
 * Usage:
 *   node scripts/plane-work-items.js PROJ-675   → from identifier
 *   node scripts/plane-work-items.js 675         → bare number
 *   node scripts/plane-work-items.js <uuid>      → from UUID
 *
 * Requires: .env with PLANE_API_KEY, PLANE_WORKSPACE_SLUG, PLANE_BASE_URL
 * Requires: config.json with PROJECT_ID, state UUIDs, estimate UUIDs
 */

const fs = require("fs");
const path = require("path");
const { parseIdentifier } = require("./lib/plane-parse-id");
const { loadConfig, parseFlags, buildStateNames, buildEstimateMap } = require("./lib/config");

// --- Load config ---
const { workspace, project, args: cliArgs } = parseFlags(process.argv.slice(2));
const config = loadConfig(workspace, project).project;
const PROJECT_ID = config.PLANE_PROJECT_ID;
const IDENTIFIER = config.PLANE_PROJECT_IDENTIFIER || "ITEM";

const ESTIMATE_MAP = buildEstimateMap(config);
const STATE_NAMES = buildStateNames(config);
const DONE_STATE = config.STATE_DONE_UUID;
const CANCELLED_STATE = config.STATE_CANCELLED_UUID;

function estimateValue(uuid) {
  return ESTIMATE_MAP[uuid] || 0;
}

function stateName(uuid) {
  return STATE_NAMES[uuid] || "Unknown";
}

// --- API helper ---
function createApi() {
  const base = `${config.PLANE_BASE_URL}/api/v1/workspaces/${config.PLANE_WORKSPACE_SLUG}/projects/${PROJECT_ID}`;
  return async (endpoint) => {
    const url = `${base}${endpoint}`;
    const res = await fetch(url, {
      headers: { "X-API-Key": config.PLANE_API_KEY },
    });
    if (res.status !== 200) {
      throw new Error(`API ${res.status}: ${url}`);
    }
    return res.json();
  };
}

// --- Module slug sanitization ---
function slugify(name) {
  return name.toLowerCase().replace(/[:\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// --- Current week (Sun-Sat, UTC) ---
function currentWeekName() {
  const d = new Date();
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const y = u.getUTCFullYear();
  const j = new Date(Date.UTC(y, 0, 1));
  const w = Math.ceil(((u - j) / 864e5 + j.getUTCDay() + 1) / 7);
  return `${y}-${String(w).padStart(2, "0")}`;
}

// --- Parse module name from tier 1 title: [vX.Y.Z | Module] Title ---
function parseModuleName(name) {
  const match = name.match(/\|\s*(.+?)\s*\]/);
  return match ? match[1].trim() : name;
}

// --- Extract Outline link from description_html ---
function extractOutlineLink(html) {
  if (!html) return null;
  const match = html.match(/href="(https:\/\/outline[^"]+)"/);
  return match ? match[1] : null;
}

// --- Extract original estimate from description_html ---
function extractOriginalEstimate(html) {
  if (!html) return null;
  const match = html.match(/Original Estimate:\s*(\d+)\s*points?/i);
  return match ? parseInt(match[1], 10) : null;
}

// --- Fetch work item by parsed input ---
async function fetchByInput(api, input) {
  if (input.type === "uuid") {
    return await api(`/work-items/${input.value}/`);
  }
  const data = await api(`/work-items/`);
  const items = data.results || data;
  const item = items.find((i) => i.sequence_id === input.value);
  if (!item) throw new Error(`${IDENTIFIER}-${input.value} not found`);
  return item;
}

// --- Fetch children of a parent ---
async function fetchChildren(api, parentId) {
  const data = await api(`/work-items/?parent=${parentId}`);
  const items = data.results || data;
  return items.filter((i) => i.parent === parentId);
}

// --- Parse --cycle flag ---
function parseCycleArg(args) {
  const idx = args.indexOf("--cycle");
  if (idx === -1 || idx + 1 >= args.length) return null;
  // Accept "YYYY/WW" or "YYYY-WW" → normalize to "YYYY-WW"
  return args[idx + 1].replace("/", "-");
}

// --- Main ---
async function main() {
  const input = parseIdentifier(cliArgs[0]);
  const cycleOverride = parseCycleArg(cliArgs);

  if (!input) {
    console.error(`Usage: node scripts/plane-work-items.js [--project <label>] <${IDENTIFIER}-N|uuid> [--cycle YYYY/WW]`);
    console.error("       node scripts/plane-work-items.js 675 --cycle 2026/09");
    process.exit(1);
  }

  const api = createApi();

  const label = input.type === "uuid" ? input.value.slice(0, 8) + "..." : `${IDENTIFIER}-${input.value}`;
  console.log(`Fetching ${label}...`);

  // 1. Fetch the target work item
  const target = await fetchByInput(api, input);
  const seqId = target.sequence_id;
  console.log(`Found: ${target.name} (${stateName(target.state)})`);

  // 2. Determine tier and resolve parent + siblings
  let tier1;
  let tier2Items;

  if (target.parent === null) {
    console.log("Detected as tier 1 — fetching children...");
    tier1 = target;
    tier2Items = await fetchChildren(api, tier1.id);
  } else {
    console.log("Detected as tier 2 — fetching parent and siblings...");
    const parentData = await api(`/work-items/${target.parent}/`);
    tier1 = parentData;
    tier2Items = await fetchChildren(api, tier1.id);
  }

  // Sort by sequence_id
  tier2Items.sort((a, b) => a.sequence_id - b.sequence_id);

  // 3. Calculate stats
  const doneCount = tier2Items.filter((i) => i.state === DONE_STATE).length;
  const cancelledCount = tier2Items.filter((i) => i.state === CANCELLED_STATE).length;
  const completedCount = doneCount + cancelledCount;
  const totalCount = tier2Items.length;
  let totalPts = 0;
  let donePts = 0;

  for (const item of tier2Items) {
    const pts = estimateValue(item.estimate_point);
    totalPts += pts;
    if (item.state === DONE_STATE) donePts += pts;
  }

  const allComplete = totalCount > 0 && completedCount === totalCount;

  // 4. Build markdown
  const lines = [];
  const outlineLink = extractOutlineLink(tier1.description_html);

  lines.push(`# ${IDENTIFIER}-${seqId} Context`);
  lines.push("");
  lines.push(
    `## Tier 1: ${IDENTIFIER}-${tier1.sequence_id} — ${tier1.name}`
  );
  lines.push(
    `State: ${stateName(tier1.state)}${outlineLink ? ` | Outline: ${outlineLink}` : ""}`
  );
  lines.push("");

  if (tier2Items.length > 0) {
    const statusParts = [`${doneCount} Done`];
    if (cancelledCount > 0) statusParts.push(`${cancelledCount} Cancelled`);
    lines.push(
      `## Tier 2 Items (${statusParts.join(", ")}/${totalCount}, ${totalPts} pts)`
    );
    lines.push("");
    lines.push(`| ${IDENTIFIER} | Feature | State | Pts | Original |`);
    lines.push("|-------|---------|-------|-----|----------|");

    for (const item of tier2Items) {
      const shortName = item.name.replace(/^\[.+?\]\s*/, "");
      const pts = estimateValue(item.estimate_point);
      const originalPts = extractOriginalEstimate(item.description_html);
      const originalCol =
        originalPts !== null ? `${originalPts} pts` : "\u2014";
      const marker = item.id === target.id ? " \u2190" : "";
      lines.push(
        `| ${IDENTIFIER}-${item.sequence_id} | ${shortName} | ${stateName(item.state)} | ${pts} | ${originalCol} |${marker}`
      );
    }
    lines.push("");
  } else {
    lines.push("_No tier 2 items found._");
    lines.push("");
  }

  lines.push("## Summary");
  lines.push(`- All Complete: ${allComplete ? "yes" : "no"}`);
  lines.push(`- Done: ${doneCount}/${totalCount} (${donePts} pts of ${totalPts} pts)`);
  if (cancelledCount > 0) lines.push(`- Cancelled: ${cancelledCount}/${totalCount}`);
  lines.push(`- Tier 1 state: ${stateName(tier1.state)}`);
  lines.push("");

  // 5. Write output — cycles/YYYY-WW/module-slug/TIER1-ID/context.md
  const cycleName = cycleOverride || currentWeekName();
  const moduleName = parseModuleName(tier1.name);
  const moduleSlug = slugify(moduleName);
  const tier1Id = `${IDENTIFIER}-${tier1.sequence_id}`;

  const outDir = path.join(__dirname, "..", "cycles", cycleName, moduleSlug, tier1Id);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, "context.md");
  fs.writeFileSync(outPath, lines.join("\n") + "\n");

  console.log(`\nOutput: ${outPath}`);
  console.log(`  Tier 1: ${IDENTIFIER}-${tier1.sequence_id} (${stateName(tier1.state)})`);
  console.log(`  Tier 2: ${doneCount}/${totalCount} Done${cancelledCount > 0 ? `, ${cancelledCount} Cancelled` : ""} (${donePts}/${totalPts} pts)`);
  console.log(`  All Complete: ${allComplete ? "yes" : "no"}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
