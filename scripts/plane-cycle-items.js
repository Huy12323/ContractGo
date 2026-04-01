#!/usr/bin/env node

/**
 * Plane Cycle Report Data Extractor
 *
 * Fetches Done tier 1 (no parent) work items from a Plane cycle
 * and their tier 2 children with estimate points. Outputs structured
 * markdown to cycles/.
 *
 * Usage:
 *   node scripts/plane-cycle-items.js              → current cycle
 *   node scripts/plane-cycle-items.js 2026/09      → specific cycle
 *
 * Requires: .env with PLANE_API_KEY, PLANE_WORKSPACE_SLUG, PLANE_BASE_URL
 * Requires: config.json with PROJECT_ID, DONE state UUID, estimate UUIDs
 */

const fs = require("fs");
const path = require("path");
const { loadConfig, parseFlags, buildEstimateMap } = require("./lib/config");
const { fetchCycleItems } = require("./lib/plane-api");

// --- Load config ---
const { workspace, project, args: cliArgs } = parseFlags(process.argv.slice(2));
const config = loadConfig(workspace, project).project;
const PROJECT_ID = config.PLANE_PROJECT_ID;
const DONE_STATE = config.STATE_DONE_UUID;

const ESTIMATE_MAP = buildEstimateMap(config);

function estimateValue(uuid) {
  return ESTIMATE_MAP[uuid] || 0;
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

// --- Current week (Sun-Sat, UTC) ---
function currentWeekName() {
  const d = new Date();
  const u = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  const y = u.getUTCFullYear();
  const j = new Date(Date.UTC(y, 0, 1));
  const w = Math.ceil(((u - j) / 864e5 + j.getUTCDay() + 1) / 7);
  return `${y}/${String(w).padStart(2, "0")}`;
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

// --- Parse module and version from tier 1 name: [vX.Y.Z | Module] Title ---
function parseTier1Name(name) {
  const match = name.match(/^\[(v[\d.]+)\s*\|\s*(.+?)\]/);
  if (match) return { module: match[2].trim(), version: match[1] };
  return { module: name, version: "unknown" };
}

// --- Main ---
async function main() {
  const cycleName =
    cliArgs.find((a) => a.match(/^\d{4}\/\d{2}$/)) || currentWeekName();

  const api = createApi();

  // 1. Find cycle
  console.log(`Looking for cycle: ${cycleName}`);
  const cyclesData = await api("/cycles/");
  const cycles = cyclesData.results || cyclesData;
  const cycle = cycles.find((c) => c.name === cycleName);

  if (!cycle) {
    console.error(`Cycle "${cycleName}" not found.`);
    console.error(
      "Available:",
      cycles.map((c) => c.name).join(", ")
    );
    process.exit(1);
  }

  console.log(
    `Found: ${cycle.name} (${cycle.completed_issues} done of ${cycle.total_issues} total)`
  );

  // 2. Fetch all cycle items (paginated)
  const projBase = `${config.PLANE_BASE_URL}/api/v1/workspaces/${config.PLANE_WORKSPACE_SLUG}/projects/${PROJECT_ID}`;
  const headers = { "X-API-Key": config.PLANE_API_KEY };
  const allItems = await fetchCycleItems(projBase, headers, cycle.id);

  // 3. Filter to Done items only
  const doneItems = allItems.filter((i) => i.state === DONE_STATE);

  // 4. Separate tiers (within Done items)
  const tier1Done = doneItems.filter((i) => i.parent === null);
  const tier1Ids = new Set(tier1Done.map((i) => i.id));

  // Tier 2 = Done items whose parent is a Done tier 1
  const tier2Done = doneItems.filter((i) => tier1Ids.has(i.parent));

  // Build parent→children map (tier 2 under tier 1)
  const childrenOf = {};
  for (const item of tier2Done) {
    if (!childrenOf[item.parent]) childrenOf[item.parent] = [];
    childrenOf[item.parent].push(item);
  }

  // Sort tier 1 by sequence_id
  tier1Done.sort((a, b) => a.sequence_id - b.sequence_id);

  // 5. Calculate points (final + original for reassessed items)
  let totalPoints = 0;
  let totalOriginalPoints = 0;
  let reassessedCount = 0;
  const pointsByVersion = {};
  const pointsByModule = {};

  for (const t2 of tier2Done) {
    const pts = estimateValue(t2.estimate_point);
    const originalPts = extractOriginalEstimate(t2.description_html);
    totalPoints += pts;
    totalOriginalPoints += originalPts !== null ? originalPts : pts;
    if (originalPts !== null) reassessedCount++;

    // Store for per-item output
    t2._finalPts = pts;
    t2._originalPts = originalPts;

    // Find parent tier 1 to get version/module
    const parent = tier1Done.find((t1) => t1.id === t2.parent);
    if (parent) {
      const { module, version } = parseTier1Name(parent.name);
      pointsByVersion[version] = (pointsByVersion[version] || 0) + pts;
      pointsByModule[module] = (pointsByModule[module] || 0) + pts;
    }
  }

  // 6. Group tier 1 by version
  const byVersion = {};
  for (const item of tier1Done) {
    const { module, version } = parseTier1Name(item.name);
    if (!byVersion[version]) byVersion[version] = [];
    byVersion[version].push({ ...item, _module: module, _version: version });
  }

  // 7. Build markdown
  const lines = [];
  lines.push(`# Cycle ${cycleName} — Report Data`);
  lines.push("");
  lines.push(`> Generated: ${new Date().toISOString().split("T")[0]}`);
  lines.push(
    `> Cycle: ${cycle.start_date || "?"} → ${cycle.end_date || "?"}`
  );
  const estimateNote = reassessedCount > 0
    ? ` | Original: ${totalOriginalPoints} | Reassessed: ${reassessedCount} items`
    : "";
  lines.push(
    `> Done: ${doneItems.length} items | Tier 1: ${tier1Done.length} | Tier 2: ${tier2Done.length} | Points: ${totalPoints}${estimateNote}`
  );
  lines.push("");

  // Points breakdown
  lines.push("## Points Summary");
  lines.push("");
  lines.push("**By version:**");
  lines.push("");
  for (const [ver, pts] of Object.entries(pointsByVersion).sort()) {
    lines.push(`- ${ver}: ${pts} pts`);
  }
  lines.push("");
  lines.push("**By module:**");
  lines.push("");
  const sortedModules = Object.entries(pointsByModule).sort(
    (a, b) => b[1] - a[1]
  );
  for (const [mod, pts] of sortedModules) {
    lines.push(`- ${mod}: ${pts} pts`);
  }
  lines.push("");

  // Summary table
  const identifier = config.PLANE_PROJECT_IDENTIFIER || "ITEM";
  lines.push("## Summary");
  lines.push("");
  lines.push(
    `| ${identifier} | Module | Version | Tier 2 | Points | Outline |`
  );
  lines.push("|-------|--------|---------|--------|--------|---------|");

  for (const item of tier1Done) {
    const { module, version } = parseTier1Name(item.name);
    const children = childrenOf[item.id] || [];
    const pts = children.reduce(
      (sum, c) => sum + estimateValue(c.estimate_point),
      0
    );
    const outlineLink = extractOutlineLink(item.description_html) || "—";
    const outlineCell =
      outlineLink !== "—" ? `[link](${outlineLink})` : "—";
    lines.push(
      `| ${identifier}-${item.sequence_id} | ${module} | ${version} | ${children.length} | ${pts} | ${outlineCell} |`
    );
  }
  lines.push("");

  // Detailed breakdown per version
  const sortedVersions = Object.keys(byVersion).sort();
  for (const version of sortedVersions) {
    const items = byVersion[version];
    const versionPts = pointsByVersion[version] || 0;
    lines.push(`## ${version} (${versionPts} pts)`);
    lines.push("");

    for (const item of items) {
      const children = childrenOf[item.id] || [];
      const modulePts = children.reduce(
        (sum, c) => sum + estimateValue(c.estimate_point),
        0
      );
      lines.push(
        `### ${identifier}-${item.sequence_id}: ${item._module} (${modulePts} pts)`
      );
      lines.push("");

      const outlineLink = extractOutlineLink(item.description_html);
      if (outlineLink) {
        lines.push(`- Version doc: ${outlineLink}`);
      }
      lines.push(
        `- Plane: ${config.PLANE_BASE_URL}/${config.PLANE_WORKSPACE_SLUG}/projects/${PROJECT_ID}/work-items/${item.id}/`
      );
      lines.push("");

      // Tier 2 children with estimates
      if (children.length > 0) {
        children.sort((a, b) => a.sequence_id - b.sequence_id);
        lines.push("**Features (Tier 2):**");
        lines.push("");
        for (const child of children) {
          const shortName = child.name.replace(/^\[.+?\]\s*/, "");
          const pts = child._finalPts !== undefined ? child._finalPts : estimateValue(child.estimate_point);
          const originalPts = child._originalPts;
          const ptsLabel = originalPts !== null && originalPts !== undefined
            ? `${pts} pts, originally ${originalPts} pts`
            : `${pts} pts`;
          lines.push(
            `- ${identifier}-${child.sequence_id}: ${shortName} (${ptsLabel})`
          );
        }
        lines.push("");
      } else {
        lines.push("_Baseline — no tier 2 items._");
        lines.push("");
      }
    }
  }

  // 8. Write output
  const safeName = cycleName.replace("/", "-");
  const cycleDir = path.join(__dirname, "..", "cycles", safeName);
  if (!fs.existsSync(cycleDir)) fs.mkdirSync(cycleDir, { recursive: true });

  const outPath = path.join(cycleDir, "cycle-report-data.md");
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`\nOutput: ${outPath}`);
  console.log(`  Tier 1 Done: ${tier1Done.length}`);
  console.log(`  Tier 2 Done: ${tier2Done.length}`);
  console.log(`  Total points: ${totalPoints}`);
  console.log(`  Versions: ${sortedVersions.join(", ")}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
