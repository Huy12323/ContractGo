#!/usr/bin/env node

/**
 * Plane Intake Handling — Tracking Checklist
 *
 * Manages a "## Tracking" section at the TOP of an intake item's description.
 * Each T1 work item linked to the intake gets a checkbox line with a Plane link.
 *
 * Modes:
 *   add   — Adds one or more T1 tracking entries (unchecked) to the intake item
 *   tick  — Checks off a T1 by SPARK-N and reports completion status
 *   status — Reads the tracking section and reports completion status
 *
 * Usage:
 *   node scripts/plane-intake-handling.js <intake-id> add <T1-id> [<T1-id> ...]
 *   node scripts/plane-intake-handling.js <intake-id> tick <T1-id>
 *   node scripts/plane-intake-handling.js <intake-id> status
 *
 * Examples:
 *   node scripts/plane-intake-handling.js SPARK-1216 add SPARK-1217 SPARK-1218
 *   node scripts/plane-intake-handling.js SPARK-1216 tick SPARK-1217
 *   node scripts/plane-intake-handling.js SPARK-1216 status
 *
 * Tracking section format (Plane-rendered HTML):
 *   ## Tracking
 *   - [ ] [v3.7.0 | Production: Script](plane_url) SPARK-1217
 *   - [x] [v3.7.0 | Scripts](plane_url) SPARK-1218
 *
 * The section is placed BEFORE any existing content (Intake Context, Technical Context).
 * When all checkboxes are ticked, the script outputs "All complete".
 *
 * Requires: .env with PLANE_API_KEY, PLANE_WORKSPACE_SLUG, PLANE_BASE_URL
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

// --- API helpers ---
function createApi() {
  const base = `${config.PLANE_BASE_URL}/api/v1/workspaces/${config.PLANE_WORKSPACE_SLUG}/projects/${PROJECT_ID}`;
  return {
    async get(endpoint) {
      const url = `${base}${endpoint}`;
      const res = await fetch(url, {
        headers: { "X-API-Key": config.PLANE_API_KEY },
      });
      return { status: res.status, data: res.status === 200 ? await res.json() : null };
    },
    async patch(endpoint, body) {
      const url = `${base}${endpoint}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          "X-API-Key": config.PLANE_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.status !== 200) {
        const text = await res.text();
        throw new Error(`PATCH ${res.status}: ${url}\n${text}`);
      }
      return res.json();
    },
  };
}

// --- Resolve parsed input → { id, sequence_id, name, description_html } ---
async function resolveItem(api, input) {
  // UUID: try direct project-level lookup first
  if (input.type === "uuid") {
    const result = await api.get(`/work-items/${input.value}/`);
    if (result.status === 200 && result.data) return result.data;
    // Fallback: search intake items by work item UUID
    const intakeResult = await api.get(`/intake-issues/`);
    if (intakeResult.status === 200) {
      const items = intakeResult.data.results || intakeResult.data;
      const intake = items.find((i) => i.issue_detail && i.issue_detail.id === input.value);
      if (intake) {
        return { ...intake.issue_detail, _intakeWrapperId: intake.id, _isIntake: true };
      }
    }
    throw new Error(`UUID ${input.value} not found`);
  }
  // Sequence: try work-items list
  const seqId = input.value;
  const result = await api.get(`/work-items/`);
  if (result.status === 200) {
    const items = result.data.results || result.data;
    const item = items.find((i) => i.sequence_id === seqId);
    if (item) return item;
  }
  // Fallback: intake items (Plane v1 uses /intake-issues/, NOT /inbox-issues/)
  const intakeResult = await api.get(`/intake-issues/`);
  if (intakeResult.status === 200) {
    const items = intakeResult.data.results || intakeResult.data;
    const intake = items.find(
      (i) => i.issue_detail && i.issue_detail.sequence_id === seqId
    );
    if (intake) {
      return { ...intake.issue_detail, _intakeWrapperId: intake.id, _isIntake: true };
    }
  }
  throw new Error(`${IDENTIFIER}-${seqId} not found`);
}

// --- Build Plane browse URL ---
function browseUrl(seqId) {
  return `${BASE_URL}/${WORKSPACE_SLUG}/browse/${IDENTIFIER}-${seqId}/`;
}

// --- Tracking section HTML helpers ---

const TRACKING_HEADING = "Tracking";
const HEADING_REGEX = /<h2[^>]*>\s*Tracking\s*<\/h2>/i;

function findTrackingSection(html) {
  const match = html.match(HEADING_REGEX);
  if (!match) return null;

  const start = match.index;
  const afterHeading = html.slice(start + match[0].length);
  // Section ends at next <h2> or end of string
  const nextH2 = afterHeading.match(/<h2[^>]*>/i);
  const end = nextH2 ? start + match[0].length + nextH2.index : html.length;

  return { start, end, content: html.slice(start, end) };
}

// Parse tracking lines from section HTML
// Each line: - [ ] or - [x] followed by link and SPARK-N
function parseTrackingLines(sectionHtml) {
  const lines = [];
  // Match task list items: checked or unchecked, with link and identifier
  const itemRegex = /<li[^>]*>.*?<label[^>]*>.*?<input[^>]*?(checked)?[^>]*>.*?<\/label>.*?<span[^>]*>(.*?)<\/span>.*?<\/li>/gis;
  let m;
  while ((m = itemRegex.exec(sectionHtml)) !== null) {
    const checked = !!m[1];
    const content = m[2];
    const idMatch = content.match(new RegExp(`${IDENTIFIER}-(\\d+)`));
    const sparkId = idMatch ? `${IDENTIFIER}-${idMatch[1]}` : null;
    lines.push({ checked, content, sparkId, raw: m[0] });
  }

  // Fallback: simpler pattern for plain list items without task list markup
  if (lines.length === 0) {
    const simpleLiRegex = /<li[^>]*>(.*?)<\/li>/gis;
    while ((m = simpleLiRegex.exec(sectionHtml)) !== null) {
      const inner = m[1];
      const checked = /\[x\]/i.test(inner) || /checked/i.test(inner);
      const idMatch = inner.match(new RegExp(`${IDENTIFIER}-(\\d+)`));
      const sparkId = idMatch ? `${IDENTIFIER}-${idMatch[1]}` : null;
      lines.push({ checked, content: inner, sparkId, raw: m[0] });
    }
  }

  return lines;
}

// Build a single tracking line as HTML
function buildTrackingLineHtml(t1Name, t1Url, sparkId, checked = false) {
  const checkbox = checked ? "[x]" : "[ ]";
  return `<li><p>${checkbox} <a href="${t1Url}" target="_blank">${escapeHtml(t1Name)}</a> ${sparkId}</p></li>`;
}

// Build the full tracking section HTML
function buildTrackingSectionHtml(lines) {
  if (lines.length === 0) return "";
  const listItems = lines.join("\n");
  return `<h2>Tracking</h2>\n<ul>\n${listItems}\n</ul>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- Update description on the correct endpoint ---
// PATCH /work-items/{id}/ works for both regular and intake items
async function updateDescription(api, item, newDescHtml) {
  const id = item._isIntake ? item.id : item.id;
  await api.patch(`/work-items/${id}/`, { description_html: newDescHtml });
}

// --- Report completion status ---
function reportStatus(lines) {
  const total = lines.length;
  const done = lines.filter((l) => l.checked).length;
  console.log(`\nTracking: ${done}/${total} complete`);
  for (const l of lines) {
    console.log(`  ${l.checked ? "[x]" : "[ ]"} ${l.sparkId || "unknown"}`);
  }
  if (total > 0 && done === total) {
    console.log("\nAll complete");
  }
  return { total, done, allComplete: total > 0 && done === total };
}

// ============================================================
// MODE: add
// ============================================================
async function modeAdd(api, intakeItem, t1Inputs) {
  const desc = intakeItem.description_html || "";

  // Resolve each T1 to get name and UUID
  const t1Infos = [];
  for (const input of t1Inputs) {
    const t1 = await resolveItem(api, input);
    t1Infos.push({
      sparkId: `${IDENTIFIER}-${t1.sequence_id}`,
      name: t1.name,
      url: browseUrl(t1.sequence_id),
    });
  }

  // Parse existing tracking section
  const existing = findTrackingSection(desc);
  const existingLines = existing ? parseTrackingLines(existing.content) : [];
  const existingSparkIds = new Set(existingLines.map((l) => l.sparkId));

  // Build new lines (skip duplicates)
  const newLineHtmls = [];
  let addedCount = 0;
  for (const t1 of t1Infos) {
    if (existingSparkIds.has(t1.sparkId)) {
      console.log(`  ${t1.sparkId} already tracked — skipping`);
      continue;
    }
    newLineHtmls.push(buildTrackingLineHtml(t1.name, t1.url, t1.sparkId, false));
    console.log(`  + ${t1.sparkId} — ${t1.name}`);
    addedCount++;
  }

  if (addedCount === 0) {
    console.log("No new items to add.");
    reportStatus(existingLines);
    return;
  }

  // Rebuild tracking section
  const existingLineHtmls = existingLines.map((l) => l.raw);
  const allLineHtmls = [...existingLineHtmls, ...newLineHtmls];
  const trackingHtml = buildTrackingSectionHtml(allLineHtmls);

  // Insert at top of description
  let updatedDesc;
  if (existing) {
    // Replace existing section
    updatedDesc = desc.slice(0, existing.start) + trackingHtml + desc.slice(existing.end);
  } else {
    // Prepend before existing content
    updatedDesc = trackingHtml + "\n" + desc;
  }

  await updateDescription(api, intakeItem, updatedDesc);
  console.log(`\nAdded ${addedCount} tracking item(s).`);

  // Report
  const allLines = [...existingLines, ...newLineHtmls.map((_, i) => ({
    checked: false,
    sparkId: t1Infos.filter((t) => !existingSparkIds.has(t.sparkId))[i]?.sparkId,
  }))];
  reportStatus(allLines);
}

// ============================================================
// MODE: tick
// ============================================================
async function modeTick(api, intakeItem, t1Input) {
  const desc = intakeItem.description_html || "";
  // For tick, we need the SPARK-N identifier to match in the tracking section
  // If UUID was passed, resolve it first to get the sequence_id
  let sparkId;
  if (t1Input.type === "uuid") {
    const t1 = await resolveItem(api, t1Input);
    sparkId = `${IDENTIFIER}-${t1.sequence_id}`;
  } else {
    sparkId = `${IDENTIFIER}-${t1Input.value}`;
  }

  const existing = findTrackingSection(desc);
  if (!existing) {
    console.error("No Tracking section found on this intake item.");
    process.exit(1);
  }

  const lines = parseTrackingLines(existing.content);
  const target = lines.find((l) => l.sparkId === sparkId);
  if (!target) {
    console.error(`${sparkId} not found in Tracking section.`);
    console.error("Tracked items:", lines.map((l) => l.sparkId).join(", "));
    process.exit(1);
  }

  if (target.checked) {
    console.log(`${sparkId} already checked.`);
    reportStatus(lines);
    return;
  }

  // Replace [ ] with [x] in the target line's raw HTML
  let updatedSection = existing.content;
  const tickedRaw = target.raw
    .replace(/\[ \]/g, "[x]")
    .replace(/<input(?!.*checked)/i, "<input checked");
  updatedSection = updatedSection.replace(target.raw, tickedRaw);

  // Rebuild description
  const updatedDesc = desc.slice(0, existing.start) + updatedSection + desc.slice(existing.end);
  await updateDescription(api, intakeItem, updatedDesc);
  console.log(`Checked: ${sparkId}`);

  // Update in-memory for reporting
  target.checked = true;
  const result = reportStatus(lines);
  return result;
}

// ============================================================
// MODE: status
// ============================================================
function modeStatus(intakeItem) {
  const desc = intakeItem.description_html || "";
  const existing = findTrackingSection(desc);
  if (!existing) {
    console.log("No Tracking section found.");
    return { total: 0, done: 0, allComplete: false };
  }
  const lines = parseTrackingLines(existing.content);
  return reportStatus(lines);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  if (cliArgs.length < 2) {
    console.error(`Usage:`);
    console.error(`  node scripts/plane-intake-handling.js [--project <label>] <${IDENTIFIER}-N|uuid> add <${IDENTIFIER}-N|uuid> [...]`);
    console.error(`  node scripts/plane-intake-handling.js [--project <label>] <${IDENTIFIER}-N|uuid> tick <${IDENTIFIER}-N|uuid>`);
    console.error(`  node scripts/plane-intake-handling.js [--project <label>] <${IDENTIFIER}-N|uuid> status`);
    process.exit(1);
  }

  const intakeInput = parseIdentifier(cliArgs[0]);
  const mode = cliArgs[1];

  if (!intakeInput) {
    console.error(`Invalid intake identifier: ${args[0]}`);
    process.exit(1);
  }

  const api = createApi();

  const intakeLabel = intakeInput.type === "uuid" ? intakeInput.value.slice(0, 8) + "..." : `${IDENTIFIER}-${intakeInput.value}`;
  console.log(`Resolving intake ${intakeLabel}...`);
  const intakeItem = await resolveItem(api, intakeInput);
  console.log(`Intake: ${intakeItem.name}`);

  switch (mode) {
    case "add": {
      const t1Args = cliArgs.slice(2);
      if (t1Args.length === 0) {
        console.error("add mode requires at least one T1 identifier.");
        process.exit(1);
      }
      const t1Inputs = t1Args.map((a) => {
        const input = parseIdentifier(a);
        if (!input) { console.error(`Invalid T1 identifier: ${a}`); process.exit(1); }
        return input;
      });
      await modeAdd(api, intakeItem, t1Inputs);
      break;
    }
    case "tick": {
      if (!cliArgs[2]) {
        console.error("tick mode requires a T1 identifier.");
        process.exit(1);
      }
      const t1Input = parseIdentifier(cliArgs[2]);
      if (!t1Input) { console.error(`Invalid T1 identifier: ${args[2]}`); process.exit(1); }
      const result = await modeTick(api, intakeItem, t1Input);
      // Exit code 0 = all complete, 1 = not all complete (for scripting)
      if (result && result.allComplete) process.exit(0);
      break;
    }
    case "status": {
      const result = modeStatus(intakeItem);
      if (result.allComplete) process.exit(0);
      break;
    }
    default:
      console.error(`Unknown mode: ${mode}. Use "add", "tick", or "status".`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
