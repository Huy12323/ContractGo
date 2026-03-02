#!/usr/bin/env node

/**
 * PO Skill Setup Script
 *
 * Reads the templatized po/SKILL.md and replaces ${PLACEHOLDER} variables
 * with values from a project-config.json file.
 *
 * Usage:
 *   node scripts/setup-po.js <config-file>     → generate filled SKILL.md
 *   node scripts/setup-po.js --init            → create example config file
 *
 * The config file should contain all project-specific values.
 * See project-config.example.json for the full template.
 */

const fs = require("fs");
const path = require("path");

const SKILL_TEMPLATE = path.join(
  __dirname,
  "..",
  ".claude",
  "skills",
  "po",
  "SKILL.md"
);

function createExampleConfig() {
  const example = {
    // Plane
    PLANE_WORKSPACE_SLUG: "your-workspace",
    PLANE_PROJECT_ID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    PLANE_PROJECT_IDENTIFIER: "PROJ",
    PLANE_BASE_URL: "https://your-plane-instance.com",
    PLANE_MCP_SERVER_NAME: "plane-yourproject",

    // Default assignee (for cycle owned_by and fallback assignments)
    MEMBER_1_UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    MEMBER_1_NAME: "Default Assignee Name",

    // Work Item States
    STATE_BACKLOG_UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    STATE_TODO_UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    STATE_IN_PROGRESS_UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    STATE_DONE_UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    STATE_CANCELLED_UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",

    // Estimate Points
    ESTIMATE_ID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    ESTIMATE_1_UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    ESTIMATE_2_UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    ESTIMATE_3_UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    ESTIMATE_5_UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    ESTIMATE_8_UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    ESTIMATE_13_UUID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",

    // Outline
    OUTLINE_BASE_URL: "https://your-outline-instance.com",
    OUTLINE_ROOT_DOC_ID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    OUTLINE_SPECIFICATIONS_DOC_ID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    OUTLINE_VERSIONS_DOC_ID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    OUTLINE_CYCLES_DOC_ID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    OUTLINE_COLLECTION_ID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  };

  const outPath = path.join(__dirname, "..", "project-config.example.json");
  fs.writeFileSync(outPath, JSON.stringify(example, null, 2) + "\n");
  console.log(`Created: ${outPath}`);
  console.log(
    "\nCopy to your project as project-config.json and fill in real values."
  );
  console.log("Then run: node scripts/setup-po.js project-config.json");
}

function fillTemplate(configPath) {
  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    console.error("Run with --init to create an example config.");
    process.exit(1);
  }

  if (!fs.existsSync(SKILL_TEMPLATE)) {
    console.error(`Template not found: ${SKILL_TEMPLATE}`);
    console.error("Make sure you are running from the bible root directory.");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  let template = fs.readFileSync(SKILL_TEMPLATE, "utf-8");

  // Track substitutions
  const substituted = [];
  const missing = [];

  // Find all ${PLACEHOLDER} patterns
  const placeholders = template.match(/\$\{([^}]+)\}/g) || [];
  const uniquePlaceholders = [...new Set(placeholders.map((p) => p.slice(2, -1)))];

  for (const key of uniquePlaceholders) {
    if (config[key] !== undefined) {
      template = template.replace(
        new RegExp(`\\$\\{${key}\\}`, "g"),
        config[key]
      );
      substituted.push(key);
    } else {
      missing.push(key);
    }
  }

  // Write filled template
  const outPath = path.join(
    __dirname,
    "..",
    ".claude",
    "skills",
    "po",
    "SKILL.md"
  );
  fs.writeFileSync(outPath, template);

  console.log(`Generated: ${outPath}`);
  console.log(`\nSubstituted: ${substituted.length} values`);

  if (missing.length > 0) {
    console.log(`\nMissing (${missing.length}):`);
    for (const key of missing) {
      console.log(`  - ${key}`);
    }
    console.log(
      "\nThese placeholders were left as-is in the output. Add them to your config."
    );
  } else {
    console.log("\nAll placeholders filled successfully.");
  }
}

// --- Main ---
const args = process.argv.slice(2);

if (args.includes("--init")) {
  createExampleConfig();
} else if (args.length === 1) {
  fillTemplate(path.resolve(args[0]));
} else {
  console.log("PO Skill Setup Script");
  console.log("");
  console.log("Usage:");
  console.log("  node scripts/setup-po.js <config-file>   Fill template with config values");
  console.log("  node scripts/setup-po.js --init           Create example config file");
}
