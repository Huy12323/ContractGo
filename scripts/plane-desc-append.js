#!/usr/bin/env node

/**
 * Plane Description Section Append/Replace
 *
 * Reads a work item's current description_html, finds a target section
 * (by <h2> heading), and replaces it with new HTML content from a file.
 * If the section doesn't exist, appends after the last <hr> or at the end.
 *
 * Handles both regular work items and pending intake items:
 * - Tries /work-items/ first (regular items)
 * - Falls back to /intake-issues/ (pending intake items, status -2)
 *
 * API note: Plane v1 uses /intake-issues/ (NOT /inbox-issues/).
 * PATCH /work-items/{id}/ works for both regular and intake items.
 *
 * Designed for /triage to append Technical Context without regenerating
 * the entire description (which risks losing Intake Context).
 *
 * Usage:
 *   node scripts/plane-desc-append.js <uuid> <section-file>
 *   node scripts/plane-desc-append.js <PROJ-N> <section-file>
 *
 * The section file should contain HTML starting with <h2>Section Name</h2>.
 * The script extracts the heading text and uses it to find/replace in the
 * existing description.
 *
 * Requires: .env with PLANE_API_KEY, PLANE_WORKSPACE_SLUG, PLANE_BASE_URL
 * Requires: project-config.json with PROJECT_ID
 */

const fs = require("fs");
const path = require("path");

// --- Load project config ---
function loadProjectConfig() {
  const configPath = path.join(__dirname, "..", "project-config.json");
  if (!fs.existsSync(configPath)) {
    console.error(
      "project-config.json not found. Run: node scripts/setup-po.js --init"
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

const config = loadProjectConfig();
const PROJECT_ID = config.PLANE_PROJECT_ID;
const IDENTIFIER = config.PLANE_PROJECT_IDENTIFIER || "ITEM";

// --- Read .env ---
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    console.error(
      ".env not found. Create one with PLANE_API_KEY, PLANE_WORKSPACE_SLUG, PLANE_BASE_URL"
    );
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

// --- API helpers ---
function createApi(env) {
  const base = `${env.PLANE_BASE_URL}/api/v1/workspaces/${env.PLANE_WORKSPACE_SLUG}/projects/${PROJECT_ID}`;
  return {
    async get(endpoint) {
      const url = `${base}${endpoint}`;
      const res = await fetch(url, {
        headers: { "X-API-Key": env.PLANE_API_KEY },
      });
      return { status: res.status, url, data: res.status === 200 ? await res.json() : null };
    },
    async patch(endpoint, body) {
      const url = `${base}${endpoint}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          "X-API-Key": env.PLANE_API_KEY,
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

// --- Parse input: UUID, PROJ-N, or bare number ---
function parseInput(arg) {
  if (!arg) return null;
  // UUID
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      arg
    )
  ) {
    return { type: "uuid", value: arg };
  }
  // PROJ-N or bare number
  const match = arg.match(/(?:\w+-)?(\d+)/i);
  if (match) {
    return { type: "sequence", value: parseInt(match[1], 10) };
  }
  return null;
}

// --- Fetch item: try work-items first, fallback to intake ---
async function fetchItem(api, issueId) {
  // Try regular work item endpoint
  const workItemResult = await api.get(`/work-items/${issueId}/`);
  if (workItemResult.status === 200) {
    const item = workItemResult.data;
    return {
      type: "work-item",
      id: item.id,
      name: item.name,
      description_html: item.description_html || "",
    };
  }

  // Fallback: fetch intake item directly by issue UUID
  console.log("Not found in /work-items/, checking intake...");
  const intakeResult = await api.get(`/intake-issues/${issueId}/`);
  if (intakeResult.status === 200) {
    const intake = intakeResult.data;
    return {
      type: "intake",
      id: intake.issue || issueId,
      name: intake.issue_detail.name,
      description_html: intake.issue_detail.description_html || "",
    };
  }

  throw new Error(
    `Item ${issueId} not found in work-items or intake. Check the UUID.`
  );
}

// --- Resolve identifier to issue UUID ---
async function resolveIssueId(api, input) {
  if (input.type === "uuid") return input.value;

  // Search regular work items by sequence_id
  const workResult = await api.get(`/work-items/`);
  if (workResult.status === 200) {
    const items = workResult.data.results || workResult.data;
    const item = items.find((i) => i.sequence_id === input.value);
    if (item) return item.id;
  }

  // Search intake items by sequence_id
  const intakeResult = await api.get(`/intake-issues/`);
  if (intakeResult.status === 200) {
    const items = intakeResult.data.results || intakeResult.data;
    const intake = items.find(
      (i) => i.issue_detail && i.issue_detail.sequence_id === input.value
    );
    if (intake) return intake.issue;
  }

  throw new Error(`${IDENTIFIER}-${input.value} not found`);
}

// --- Update item description ---
async function updateDescription(api, item, newDescHtml) {
  // PATCH /work-items/{id}/ works for both regular and intake items
  await api.patch(`/work-items/${item.id}/`, {
    description_html: newDescHtml,
  });
}

// --- Extract section heading from HTML content ---
function extractSectionHeading(html) {
  const match = html.match(/<h2[^>]*>(.*?)<\/h2>/i);
  if (!match) return null;
  return match[1].replace(/<[^>]+>/g, "").trim();
}

// --- Find section boundaries in description HTML ---
function findSectionBounds(descHtml, headingText) {
  const headingPattern = new RegExp(
    `<h2[^>]*>\\s*${escapeRegex(headingText)}\\s*</h2>`,
    "i"
  );
  const match = descHtml.match(headingPattern);
  if (!match) return null;

  const start = match.index;
  const afterHeading = descHtml.slice(start + match[0].length);
  const nextSection = afterHeading.match(/<h2[^>]*>/i);

  const end = nextSection
    ? start + match[0].length + nextSection.index
    : descHtml.length;

  return { start, end };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Merge section into description ---
function mergeDescription(currentDesc, newSectionHtml) {
  const heading = extractSectionHeading(newSectionHtml);
  if (!heading) {
    throw new Error(
      "Section file must start with an <h2> heading to identify the section"
    );
  }

  const current = currentDesc || "";
  const bounds = findSectionBounds(current, heading);

  if (bounds) {
    console.log(`Replacing existing "${heading}" section`);
    return (
      current.slice(0, bounds.start) +
      newSectionHtml +
      current.slice(bounds.end)
    );
  }

  // Look for the placeholder comment
  const placeholderPattern = new RegExp(
    `<!--\\s*To be added by /triage[^>]*-->`,
    "i"
  );
  const placeholderMatch = current.match(placeholderPattern);

  if (placeholderMatch) {
    const beforePlaceholder = current.slice(0, placeholderMatch.index);
    const headingBefore = beforePlaceholder.match(
      new RegExp(`<h2[^>]*>\\s*${escapeRegex(heading)}\\s*</h2>\\s*$`, "i")
    );

    if (headingBefore) {
      const replaceStart = headingBefore.index;
      const replaceEnd =
        placeholderMatch.index + placeholderMatch[0].length;
      console.log(`Replacing placeholder for "${heading}"`);
      return (
        current.slice(0, replaceStart) +
        newSectionHtml +
        current.slice(replaceEnd)
      );
    }
  }

  // Append after last <hr> or at end
  const lastHr = current.lastIndexOf("<hr");
  if (lastHr !== -1) {
    const hrEnd = current.indexOf(">", lastHr) + 1;
    console.log(`Appending "${heading}" after <hr>`);
    return (
      current.slice(0, hrEnd) +
      "\n" +
      newSectionHtml +
      current.slice(hrEnd)
    );
  }

  console.log(`Appending "${heading}" at end of description`);
  return current + "\n<hr>\n" + newSectionHtml;
}

// --- Main ---
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(
      `Usage: node scripts/plane-desc-append.js <${IDENTIFIER}-N|uuid> <section-file.html>`
    );
    console.error("");
    console.error(
      "The section file should contain HTML starting with <h2>."
    );
    console.error(
      "The script finds that section in the description and replaces it,"
    );
    console.error("or appends it if not found.");
    console.error("");
    console.error(
      "Works with both regular work items and pending intake items."
    );
    process.exit(1);
  }

  const input = parseInput(args[0]);
  if (!input) {
    console.error(`Invalid work item identifier: ${args[0]}`);
    process.exit(1);
  }

  const sectionFile = args[1];
  if (!fs.existsSync(sectionFile)) {
    console.error(`Section file not found: ${sectionFile}`);
    process.exit(1);
  }

  const newSectionHtml = fs.readFileSync(sectionFile, "utf-8").trim();
  if (!newSectionHtml) {
    console.error("Section file is empty");
    process.exit(1);
  }

  const env = loadEnv();
  const api = createApi(env);

  // Resolve identifier to issue UUID
  console.log(`Resolving ${args[0]}...`);
  const issueId = await resolveIssueId(api, input);
  console.log(`Issue ID: ${issueId}`);

  // Fetch item (auto-detects work-item vs intake)
  const item = await fetchItem(api, issueId);
  console.log(`Item: ${item.name} (${item.type})`);

  const updatedDesc = mergeDescription(item.description_html, newSectionHtml);

  if (updatedDesc === item.description_html) {
    console.log("No changes needed.");
    return;
  }

  // Update via the correct endpoint
  await updateDescription(api, item, updatedDesc);
  console.log("Description updated successfully.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
