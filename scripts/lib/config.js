/**
 * Unified configuration loader.
 *
 * Single config file supports both PA (multi-workspace) and standard (single-workspace) consumers.
 *
 * Config format:
 *   {
 *     "default_project": "wclv1",
 *     "workspaces": {
 *       "wc": {
 *         "name": "WorldCraft Logistics",
 *         "folder": "wc",
 *         "comms_mcp": "wc_ms365",
 *         "detection_keywords": ["teams", "outlook"],
 *         "projects": {
 *           "wclv1": {
 *             "PLANE_PROJECT_ID": "...",
 *             "env": { "PLANE_API_KEY": "WC_PLANE_API_KEY" }
 *           }
 *         }
 *       }
 *     }
 *   }
 *
 * PA-only workspace fields (folder, comms_mcp, detection_keywords) are optional.
 * Standard consumers have one workspace with one project.
 *
 * Env vars in .env are resolved via the "env" mapping in project config.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

// --- Core loaders ---

/**
 * Load and resolve configuration.
 *
 * @param {string|null} workspaceKey - Workspace key (e.g., "wc"). Null = auto-resolve from project.
 * @param {string|null} projectKey - Project label (e.g., "wclv1"). Null = use default_project (or workspace-only if workspaceKey set).
 * @returns {{ workspace: object|null, project: object|null }} Resolved config.
 */
function loadConfig(workspaceKey, projectKey) {
  const configPath = path.join(ROOT, "config.json");
  if (!fs.existsSync(configPath)) {
    console.error("config.json not found. Fill in the template with your project values.");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  if (!raw.workspaces) {
    console.error("config.json must have a 'workspaces' key.");
    process.exit(1);
  }

  let workspace = null;
  let project = null;
  let resolvedWsKey = workspaceKey;

  const targetProject = projectKey || (!workspaceKey ? raw.default_project : null);

  if (workspaceKey && targetProject) {
    // Both specified — direct lookup
    workspace = raw.workspaces[workspaceKey];
    if (!workspace) {
      console.error(`Workspace "${workspaceKey}" not found. Available: ${Object.keys(raw.workspaces).join(", ")}`);
      process.exit(1);
    }
    project = workspace.projects?.[targetProject];
    if (!project) {
      console.error(`Project "${targetProject}" not found in workspace "${workspaceKey}". Available: ${Object.keys(workspace.projects || {}).join(", ")}`);
      process.exit(1);
    }
  } else if (workspaceKey && !targetProject) {
    // Workspace only — return workspace metadata, no project
    workspace = raw.workspaces[workspaceKey];
    if (!workspace) {
      console.error(`Workspace "${workspaceKey}" not found. Available: ${Object.keys(raw.workspaces).join(", ")}`);
      process.exit(1);
    }
    return { workspace: { _key: workspaceKey, ...workspace }, project: null };
  } else if (targetProject) {
    // Project only — search across all workspaces
    for (const [wsKey, ws] of Object.entries(raw.workspaces)) {
      if (ws.projects?.[targetProject]) {
        workspace = ws;
        resolvedWsKey = wsKey;
        project = ws.projects[targetProject];
        break;
      }
    }
    if (!project) {
      const allProjects = Object.entries(raw.workspaces)
        .flatMap(([, ws]) => Object.keys(ws.projects || {}));
      console.error(`Project "${targetProject}" not found. Available: ${allProjects.join(", ")}`);
      process.exit(1);
    }
  } else {
    console.error("No project specified and no default_project set in config.json.");
    process.exit(1);
  }

  // Resolve env mappings
  const resolvedProject = { ...project };
  const env = loadEnv();
  if (resolvedProject.env) {
    for (const [canonical, envVarName] of Object.entries(resolvedProject.env)) {
      const value = env[envVarName];
      if (!value) {
        console.error(`Missing env var: ${envVarName} (mapped from ${canonical})`);
        process.exit(1);
      }
      resolvedProject[canonical] = value;
    }
    delete resolvedProject.env;
  }

  return {
    workspace: { _key: resolvedWsKey, ...workspace },
    project: resolvedProject,
  };
}

/**
 * Parse .env file from project root.
 * @returns {object} Key-value map of env vars.
 */
function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    console.error(".env not found. Create one with API keys.");
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

// --- CLI helpers ---

/**
 * Extract --workspace <key> and --project <label> from CLI args array.
 *
 * @param {string[]} args - process.argv.slice(2)
 * @returns {{ workspace: string|null, project: string|null, args: string[] }}
 */
function parseFlags(args) {
  let workspace = null;
  let project = null;
  const remaining = [...args];

  const wsIdx = remaining.indexOf("--workspace");
  if (wsIdx !== -1) {
    if (wsIdx + 1 >= remaining.length) {
      console.error("--workspace requires a key (e.g., --workspace wc)");
      process.exit(1);
    }
    workspace = remaining[wsIdx + 1];
    remaining.splice(wsIdx, 2);
  }

  const projIdx = remaining.indexOf("--project");
  if (projIdx !== -1) {
    if (projIdx + 1 >= remaining.length) {
      console.error("--project requires a label (e.g., --project wclv1)");
      process.exit(1);
    }
    project = remaining[projIdx + 1];
    remaining.splice(projIdx, 2);
  }

  return { workspace, project, args: remaining };
}

// --- Convenience builders (common derived maps) ---

function buildStateMap(config) {
  const map = {};
  if (config.STATE_BACKLOG_UUID) map["backlog"] = config.STATE_BACKLOG_UUID;
  if (config.STATE_TODO_UUID) map["todo"] = config.STATE_TODO_UUID;
  if (config.STATE_IN_PROGRESS_UUID) map["in_progress"] = config.STATE_IN_PROGRESS_UUID;
  if (config.STATE_DONE_UUID) map["done"] = config.STATE_DONE_UUID;
  if (config.STATE_CANCELLED_UUID) map["cancelled"] = config.STATE_CANCELLED_UUID;
  return map;
}

function buildStateNames(config) {
  const map = {};
  if (config.STATE_BACKLOG_UUID) map[config.STATE_BACKLOG_UUID] = "Backlog";
  if (config.STATE_TODO_UUID) map[config.STATE_TODO_UUID] = "Todo";
  if (config.STATE_IN_PROGRESS_UUID) map[config.STATE_IN_PROGRESS_UUID] = "In Progress";
  if (config.STATE_DONE_UUID) map[config.STATE_DONE_UUID] = "Done";
  if (config.STATE_CANCELLED_UUID) map[config.STATE_CANCELLED_UUID] = "Cancelled";
  return map;
}

function buildEstimateMap(config) {
  const map = {};
  if (config.ESTIMATE_1_UUID) map[config.ESTIMATE_1_UUID] = 1;
  if (config.ESTIMATE_2_UUID) map[config.ESTIMATE_2_UUID] = 2;
  if (config.ESTIMATE_3_UUID) map[config.ESTIMATE_3_UUID] = 3;
  if (config.ESTIMATE_5_UUID) map[config.ESTIMATE_5_UUID] = 5;
  if (config.ESTIMATE_8_UUID) map[config.ESTIMATE_8_UUID] = 8;
  if (config.ESTIMATE_13_UUID) map[config.ESTIMATE_13_UUID] = 13;
  return map;
}

function buildEstimateReverse(config) {
  const map = {};
  if (config.ESTIMATE_1_UUID) map["1"] = config.ESTIMATE_1_UUID;
  if (config.ESTIMATE_2_UUID) map["2"] = config.ESTIMATE_2_UUID;
  if (config.ESTIMATE_3_UUID) map["3"] = config.ESTIMATE_3_UUID;
  if (config.ESTIMATE_5_UUID) map["5"] = config.ESTIMATE_5_UUID;
  if (config.ESTIMATE_8_UUID) map["8"] = config.ESTIMATE_8_UUID;
  if (config.ESTIMATE_13_UUID) map["13"] = config.ESTIMATE_13_UUID;
  return map;
}

module.exports = {
  loadConfig,
  parseFlags,
  buildStateMap,
  buildStateNames,
  buildEstimateMap,
  buildEstimateReverse,
};
