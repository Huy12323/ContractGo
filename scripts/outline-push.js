#!/usr/bin/env node

/**
 * Outline Document Push
 *
 * Pushes a local .md file back to Outline, updating the document.
 * The document ID is extracted from the filename (must be <uuid>.md).
 *
 * Usage:
 *   node scripts/outline-push.js temp/outline/<uuid>.md
 *   node scripts/outline-push.js <file-path>
 *
 * Env required: OUTLINE_API_KEY, OUTLINE_API_URL in root .env
 */

const fs = require("fs");
const path = require("path");
const { loadConfig, parseFlags } = require("./lib/config");

// --- Load config ---
const { workspace, project, args: cliArgs } = parseFlags(process.argv.slice(2));
const config = loadConfig(workspace, project).project;

// --- Extract UUID from filename ---
function extractDocId(filePath) {
  const basename = path.basename(filePath, ".md");
  const uuidMatch = basename.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  return uuidMatch ? uuidMatch[0] : null;
}

// --- Main ---
async function main() {
  const filePath = cliArgs[0];

  if (!filePath) {
    console.error("Usage: node scripts/outline-push.js [--project <label>] <file-path>");
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const docId = extractDocId(resolvedPath);
  if (!docId) {
    throw new Error(
      "Could not extract document ID from filename. Expected: <uuid>.md"
    );
  }

  const text = fs.readFileSync(resolvedPath, "utf-8");
  const lineCount = text.split("\n").length;

  const apiUrl = config.OUTLINE_API_URL;
  const apiKey = config.OUTLINE_API_KEY;

  if (!apiUrl || !apiKey) {
    console.error("Missing OUTLINE_API_URL or OUTLINE_API_KEY in .env");
    process.exit(1);
  }

  console.log(`Pushing: ${resolvedPath}`);
  console.log(`  ID:    ${docId}`);
  console.log(`  Lines: ${lineCount}`);

  const res = await fetch(`${apiUrl}/documents.update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ id: docId, text }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText}`);
  }

  const { data } = await res.json();
  console.log(`\nPushed: ${data.title}`);
  console.log(`  Updated: ${data.updatedAt}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
