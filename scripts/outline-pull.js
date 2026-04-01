#!/usr/bin/env node

/**
 * Outline Document Pull
 *
 * Downloads an Outline document to a local .md file for editing.
 * Use the Edit tool to make changes, then push back with outline-push.js.
 *
 * Usage:
 *   node scripts/outline-pull.js <doc-id>           → by UUID
 *   node scripts/outline-pull.js <outline-url>      → by URL
 *   node scripts/outline-pull.js bible              → alias for Specifications
 *   node scripts/outline-pull.js versions           → alias for Versions root
 *   node scripts/outline-pull.js cycles             → alias for Cycles root
 *
 * Output: temp/outline/<uuid>.md
 *
 * Aliases are resolved from config.json (Outline doc IDs).
 * Env required: OUTLINE_API_KEY, OUTLINE_API_URL in root .env
 */

const fs = require("fs");
const path = require("path");
const { loadConfig, parseFlags } = require("./lib/config");

// --- Load config ---
const { workspace, project, args: cliArgs } = parseFlags(process.argv.slice(2));
const config = loadConfig(workspace, project).project;

// --- Build aliases from config ---
function loadAliases() {
  const aliases = {};
  if (config.OUTLINE_SPECIFICATIONS_DOC_ID) {
    aliases.bible = config.OUTLINE_SPECIFICATIONS_DOC_ID;
    aliases.specs = config.OUTLINE_SPECIFICATIONS_DOC_ID;
    aliases.specifications = config.OUTLINE_SPECIFICATIONS_DOC_ID;
  }
  if (config.OUTLINE_VERSIONS_DOC_ID) {
    aliases.versions = config.OUTLINE_VERSIONS_DOC_ID;
  }
  if (config.OUTLINE_CYCLES_DOC_ID) {
    aliases.cycles = config.OUTLINE_CYCLES_DOC_ID;
  }
  return aliases;
}

// --- Parse input to document ID ---
function parseInput(input, aliases) {
  const lower = input.toLowerCase();

  // Check aliases
  if (aliases[lower]) return aliases[lower];

  // UUID pattern
  const uuidMatch = input.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  if (uuidMatch) return uuidMatch[0];

  // Outline URL slug (e.g., /doc/design-system-E4rYwLUiP3)
  const slugMatch = input.match(/\/doc\/([a-zA-Z0-9-]+)/);
  if (slugMatch) return slugMatch[1];

  return null;
}

// --- Main ---
async function main() {
  const input = cliArgs[0];

  if (!input) {
    console.error("Usage: node scripts/outline-pull.js [--project <label>] <doc-id|url|alias>");
    console.error("");
    console.error("Aliases: bible, versions, cycles");
    process.exit(1);
  }

  const aliases = loadAliases();
  const docId = parseInput(input, aliases);
  if (!docId) {
    console.error("Could not parse document ID from:", input);
    process.exit(1);
  }

  const apiUrl = config.OUTLINE_API_URL;
  const apiKey = config.OUTLINE_API_KEY;

  if (!apiUrl || !apiKey) {
    console.error("Missing OUTLINE_API_URL or OUTLINE_API_KEY in .env");
    process.exit(1);
  }

  console.log(`Pulling document: ${docId}`);

  const res = await fetch(`${apiUrl}/documents.info`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ id: docId }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText}`);
  }

  const { data } = await res.json();
  const uuid = data.id;
  const title = data.title;
  const text = data.text;
  const lineCount = text.split("\n").length;

  // Write to temp/outline/<uuid>.md
  const outDir = path.join(__dirname, "..", "temp", "outline");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, `${uuid}.md`);
  fs.writeFileSync(outPath, text);

  console.log(`\nPulled: ${title}`);
  console.log(`  ID:    ${uuid}`);
  console.log(`  File:  ${outPath}`);
  console.log(`  Lines: ${lineCount}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
