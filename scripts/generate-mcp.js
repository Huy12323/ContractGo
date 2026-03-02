#!/usr/bin/env node

/**
 * MCP Configuration Generator
 *
 * Reads .env for API credentials and project-config.json for project-specific
 * naming, then generates .mcp.json with MCP servers configured.
 *
 * Usage:
 *   node scripts/generate-mcp.js
 *
 * Requires: .env with API keys
 * Requires: project-config.json with PLANE_MCP_SERVER_NAME, PLANE_WORKSPACE_SLUG
 */

const fs = require("fs");
const path = require("path");

// Load .env
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// Load project config
const configPath = path.join(__dirname, "..", "project-config.json");
if (!fs.existsSync(configPath)) {
  console.error("project-config.json not found. Run: node scripts/setup-po.js --init");
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const planeMcpName = config.PLANE_MCP_SERVER_NAME || `plane-${config.PLANE_WORKSPACE_SLUG}`;

// MCP configuration template
const template = {
  mcpServers: {
    context7: {
      type: "http",
      url: "https://mcp.context7.com/mcp",
    },
    [planeMcpName]: {
      command: "uvx",
      args: ["plane-mcp-server", "stdio"],
      env: {
        PLANE_API_KEY: "${PLANE_API_KEY}",
        PLANE_WORKSPACE_SLUG: "${PLANE_WORKSPACE_SLUG}",
        PLANE_BASE_URL: "${PLANE_BASE_URL}",
      },
    },
    outline: {
      command: "uvx",
      args: ["mcp-outline"],
      env: {
        OUTLINE_API_KEY: "${OUTLINE_API_KEY}",
        OUTLINE_API_URL: "${OUTLINE_API_URL}",
      },
    },
  },
};

// Recursively substitute ${VAR} with env values
function substituteEnvVars(obj) {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      return process.env[varName] || match;
    });
  } else if (Array.isArray(obj)) {
    return obj.map(substituteEnvVars);
  } else if (typeof obj === "object" && obj !== null) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVars(value);
    }
    return result;
  }
  return obj;
}

const mcpConfig = substituteEnvVars(template);

// Write .mcp.json
const outputPath = path.join(__dirname, "..", ".mcp.json");
fs.writeFileSync(outputPath, JSON.stringify(mcpConfig, null, 2));

console.log("Generated .mcp.json with environment variables substituted");
console.log(`Output: ${outputPath}`);

// Verify substitutions
const raw = JSON.stringify(mcpConfig, null, 2);
const remaining = raw.match(/\$\{([^}]+)\}/g);
if (remaining) {
  const uniqueVars = [...new Set(remaining.map((m) => m.slice(2, -1)))];
  console.log("\nMissing environment variables:");
  uniqueVars.forEach((v) => console.log(`  - ${v}`));
} else {
  console.log("\nAll environment variables successfully substituted.");
}
