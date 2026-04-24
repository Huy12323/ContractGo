#!/usr/bin/env node
/**
 * Backfill AHR-1791: lift file-type fieldInput nodes out of contract_templates.layout
 * and contract_template_versions.layout into the new attachment_field_keys JSONB column.
 *
 * Strategy:
 *   1. Load all rows (both tables) via one `psql -c "SELECT jsonb_agg(...)"` call
 *   2. Walk each row's layout tree, collect fieldKeys of nodes where
 *        `type === 'fieldInput' && attrs.fieldType === 'file'`,
 *      strip those nodes from the layout tree (dedupe keys)
 *   3. Generate a single SQL file with:
 *        - UPDATE contract_template_versions SET layout=..., attachment_field_keys=...
 *        - UPDATE contract_template_versions SET content_hash = digest(...)  -- recompute ALL hashes with new formula
 *        - UPDATE contract_templates SET layout=..., attachment_field_keys=...
 *      Versions first + hash recompute guarantees the trigger on `contract_templates`
 *      sees a matching latest-version hash → dedup → no new version row spawned
 *   4. Execute via `psql -f`
 *
 * Skips rows where neither the layout nor attachment_field_keys needs changing
 * (idempotent re-runs).
 *
 * Flags:
 *   --dry-run    Print counts without writing the SQL file / executing it
 */

import { execSync } from "node:child_process";

const DRY_RUN = process.argv.includes("--dry-run");
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_aiur-hr";

/**
 * Run arbitrary SQL through psql inside the Supabase Docker container — avoids the
 * need for psql on the host PATH (Windows dev boxes typically don't have it).
 * Pipes the SQL via stdin to dodge shell-quoting hell for multi-statement bodies.
 */
function psqlExec(sqlText) {
    return execSync(
        `docker exec -i ${DB_CONTAINER} psql -U postgres -d postgres --no-psqlrc -v ON_ERROR_STOP=1 -At`,
        {
            encoding: "utf-8",
            input: sqlText,
            maxBuffer: 256 * 1024 * 1024,
        },
    );
}

/**
 * Recursive walk — removes file-type fieldInput nodes from the layout tree,
 * collecting their fieldKeys. Pure transform, no side effects.
 */
function walkNode(node) {
    if (!node || typeof node !== "object") return { cleaned: node, keys: [] };

    if (node.type === "fieldInput" && node.attrs?.fieldType === "file") {
        return { cleaned: null, keys: node.attrs.fieldKey ? [node.attrs.fieldKey] : [] };
    }

    const keys = [];
    const nextNode = { ...node };

    if (Array.isArray(node.content)) {
        const nextContent = [];
        for (const child of node.content) {
            const result = walkNode(child);
            if (result.cleaned !== null) nextContent.push(result.cleaned);
            keys.push(...result.keys);
        }
        nextNode.content = nextContent;
    }

    return { cleaned: nextNode, keys };
}

function dedupe(list) {
    return Array.from(new Set(list));
}

function sqlEscape(jsonText) {
    return jsonText.replace(/'/g, "''");
}

function main() {
    console.log("[ahr1791] Loading rows from local DB...");

    const loadSql = `
        SELECT jsonb_build_object(
            'templates', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id', id,
                    'layout', layout,
                    'attachment_field_keys', attachment_field_keys
                )) FROM public.contract_templates
            ), '[]'::jsonb),
            'versions', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id', id,
                    'layout', layout,
                    'attachment_field_keys', attachment_field_keys
                )) FROM public.contract_template_versions
            ), '[]'::jsonb)
        )::text;
    `;
    const raw = psqlExec(loadSql).trim();
    const { templates, versions } = JSON.parse(raw);

    console.log(`[ahr1791] Loaded ${templates.length} templates, ${versions.length} versions`);

    const templateUpdates = [];
    const versionUpdates = [];

    // A row needs updating iff the walk still finds file-type nodes in its layout.
    // When walkKeys is empty, either the row never had file fields OR the backfill
    // already ran (layout was stripped, attachment_field_keys was populated) — both
    // are "done" states, skip. Merge extracted keys with any existing column value
    // to be safe against partial prior runs.
    const planUpdate = (row) => {
        const { cleaned, keys } = walkNode(row.layout);
        const walkKeys = dedupe(keys);
        if (walkKeys.length === 0) return null;
        const currentKeys = row.attachment_field_keys ?? [];
        const merged = dedupe([...currentKeys, ...walkKeys]);
        return { id: row.id, cleanedLayout: cleaned, keys: merged };
    };

    for (const row of templates) {
        const u = planUpdate(row);
        if (u) templateUpdates.push(u);
    }

    for (const row of versions) {
        const u = planUpdate(row);
        if (u) versionUpdates.push(u);
    }

    console.log(
        `[ahr1791] Updates queued: ${templateUpdates.length} templates, ${versionUpdates.length} versions`,
    );

    if (DRY_RUN) {
        console.log("[ahr1791] --dry-run set, exiting without writing");
        return;
    }

    if (templateUpdates.length === 0 && versionUpdates.length === 0) {
        console.log("[ahr1791] Nothing to do — already backfilled");
        return;
    }

    const parts = [];
    parts.push("BEGIN;");

    // Versions first — write layout + keys. content_hash is refreshed in the batch
    // UPDATE below so the trigger on contract_templates (next) dedups against the
    // NEW formula's hash instead of the stale one.
    for (const u of versionUpdates) {
        const layoutLit = sqlEscape(JSON.stringify(u.cleanedLayout));
        const keysLit = sqlEscape(JSON.stringify(u.keys));
        parts.push(
            `UPDATE public.contract_template_versions SET layout = '${layoutLit}'::jsonb, attachment_field_keys = '${keysLit}'::jsonb WHERE id = '${u.id}';`,
        );
    }

    // Recompute content_hash on EVERY version row using the new formula
    // (attachment_field_keys-inclusive). Safe to blanket-apply — the new formula
    // produces the same result as the old one for rows with attachment_field_keys = []
    // only insofar as the concatenated text differs; we always want the NEW formula's
    // output so future trigger-fired comparisons match.
    parts.push(`
UPDATE public.contract_template_versions
   SET content_hash = encode(
       digest(
           type::text || layout::text
               || coalesce(pdf_file_path, '')
               || coalesce(mandatory_field_keys::text, '')
               || coalesce(hr_field_keys::text, '')
               || coalesce(attachment_field_keys::text, ''),
           'sha256'
       ),
       'hex'
   );
    `);

    // Templates last — trigger on contract_templates will compute hash from NEW
    // (rewritten) layout + attachment_field_keys and compare against the latest
    // version's content_hash (refreshed above) → match → dedup → no new version row
    for (const u of templateUpdates) {
        const layoutLit = sqlEscape(JSON.stringify(u.cleanedLayout));
        const keysLit = sqlEscape(JSON.stringify(u.keys));
        parts.push(
            `UPDATE public.contract_templates SET layout = '${layoutLit}'::jsonb, attachment_field_keys = '${keysLit}'::jsonb WHERE id = '${u.id}';`,
        );
    }

    parts.push("COMMIT;");

    const sql = parts.join("\n");
    console.log(`[ahr1791] Applying ${templateUpdates.length + versionUpdates.length + 1} statements in a single transaction...`);
    psqlExec(sql);
    console.log("[ahr1791] Backfill complete");
}

main();
