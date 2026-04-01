#!/usr/bin/env node

/**
 * Plane Latest Version
 *
 * Scans all tier 1 work items (no parent) to determine the latest app-wide
 * version. This is the source of truth for version bumps — agents MUST run
 * this before creating new versions instead of relying on memory.
 *
 * Usage:
 *   node scripts/plane-latest-version.js            → prints latest version
 *   node scripts/plane-latest-version.js --all       → prints all versions with state
 *
 * Requires: .env with PLANE_API_KEY, PLANE_WORKSPACE_SLUG, PLANE_BASE_URL
 * Requires: config.json with PROJECT_ID, state UUIDs
 */

const { loadConfig, parseFlags, buildStateNames } = require("./lib/config");

// --- Load config ---
const { workspace, project, args: cliArgs } = parseFlags(process.argv.slice(2));
const config = loadConfig(workspace, project).project;
const PROJECT_ID = config.PLANE_PROJECT_ID;

const STATE_NAMES = buildStateNames(config);
const DONE_STATE = config.STATE_DONE_UUID;
const CANCELLED_STATE = config.STATE_CANCELLED_UUID;

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

// --- Parse version from tier 1 title: [vX.Y.Z | Module] Title ---
function parseVersion(title) {
  const match = title.match(/^\[\s*(v(\d+)\.(\d+)\.(\d+))\s*\|/);
  if (!match) return null;
  return {
    raw: match[1],
    major: parseInt(match[2], 10),
    minor: parseInt(match[3], 10),
    patch: parseInt(match[4], 10),
  };
}

// --- Parse module name from tier 1 title ---
function parseModuleName(title) {
  const match = title.match(/\|\s*(.+?)\s*\]/);
  return match ? match[1].trim() : title;
}

// --- Compare semver (descending) ---
function compareSemver(a, b) {
  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  return b.patch - a.patch;
}

// --- Main ---
async function main() {
  const showAll = cliArgs.includes("--all");

  const api = createApi();

  // Fetch all work items
  const data = await api("/work-items/");
  const items = data.results || data;

  // Filter to tier 1 (no parent) with parseable version
  const tier1Items = [];
  for (const item of items) {
    if (item.parent !== null) continue;
    const version = parseVersion(item.name);
    if (!version) continue;
    tier1Items.push({
      id: item.id,
      sequenceId: item.sequence_id,
      name: item.name,
      module: parseModuleName(item.name),
      version,
      state: item.state,
      stateName: stateName(item.state),
    });
  }

  if (tier1Items.length === 0) {
    console.error("No tier 1 work items with version found.");
    process.exit(1);
  }

  // Sort by semver descending
  tier1Items.sort((a, b) => compareSemver(a.version, b.version));

  // Group by version string
  const byVersion = {};
  for (const item of tier1Items) {
    const key = item.version.raw;
    if (!byVersion[key]) byVersion[key] = { version: item.version, items: [] };
    byVersion[key].items.push(item);
  }

  // Determine latest: highest semver regardless of state
  const latest = tier1Items[0].version.raw;

  // Active: not Done and not Cancelled
  const activeItems = tier1Items.filter(
    (i) => i.state !== DONE_STATE && i.state !== CANCELLED_STATE
  );
  const activeVersions = [...new Set(activeItems.map((i) => i.version.raw))];

  // Print output
  console.log(`Latest: ${latest}`);

  if (activeVersions.length > 0) {
    const activeDetails = activeVersions.map((v) => {
      const modules = byVersion[v].items
        .filter((i) => i.state !== DONE_STATE && i.state !== CANCELLED_STATE)
        .map((i) => `${i.module} (${i.stateName})`)
        .join(", ");
      return `${v} — ${modules}`;
    });
    console.log(`Active: ${activeDetails.join(" | ")}`);
  } else {
    console.log("Active: none");
  }

  if (showAll) {
    console.log("\nAll versions:");
    const sortedVersionKeys = Object.keys(byVersion).sort((a, b) => {
      return compareSemver(byVersion[a].version, byVersion[b].version);
    });
    for (const key of sortedVersionKeys) {
      const entry = byVersion[key];
      const modules = entry.items.map((i) => `${i.module} (${i.stateName})`).join(", ");
      console.log(`  ${key} — ${modules}`);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
