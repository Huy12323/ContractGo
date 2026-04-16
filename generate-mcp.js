#!/usr/bin/env node

/**
 * Generate .mcp.json from .env
 *
 * Reads PLANE_* and OUTLINE_* env vars from the root .env (populated by
 * scripts/env-apply.js from the [MCP] section) and writes .mcp.json with
 * the MCP server configuration for Plane and Outline.
 *
 * Run after env:apply and whenever the template below changes:
 *   pnpm mcp:gen    (or: node generate-mcp.js)
 *
 * Claude Code loads .mcp.json at session start — restart the session after
 * regenerating.
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config();

const template = {
    mcpServers: {
        "plane-aiur-hr": {
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

function substituteEnvVars(obj) {
    if (typeof obj === "string") {
        return obj.replace(/\$\{([^}]+)\}/g, (_, varName) => process.env[varName] || `\${${varName}}`);
    }
    if (Array.isArray(obj)) return obj.map(substituteEnvVars);
    if (obj && typeof obj === "object") {
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, substituteEnvVars(v)]));
    }
    return obj;
}

const mcpConfig = substituteEnvVars(template);
const outputPath = path.join(__dirname, ".mcp.json");
fs.writeFileSync(outputPath, JSON.stringify(mcpConfig, null, 2) + "\n");

console.log(`✓ Generated .mcp.json (${path.relative(__dirname, outputPath)})`);

const unresolved = JSON.stringify(mcpConfig).match(/\$\{([^}]+)\}/g);
if (unresolved) {
    const unique = [...new Set(unresolved.map((m) => m.slice(2, -1)))];
    console.warn("\n! Unresolved env vars — set them in .env then rerun:");
    unique.forEach((v) => console.warn(`   ${v}`));
    process.exit(1);
}
console.log("\nRestart Claude Code to load the new MCP servers.");
