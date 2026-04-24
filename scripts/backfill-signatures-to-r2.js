#!/usr/bin/env node
/**
 * Migrate contract signature PNGs from Supabase Storage (bucket `org-files`) to R2.
 *
 * Legacy signature_path format (Supabase Storage):
 *     {org_id}/contracts/{contract_id}/signature.png
 *
 * New R2 key format:
 *     orgs/{org_id}/contracts/{contract_id}/signature-{timestamp}.png
 *
 * For each contract whose signature_path does NOT start with `orgs/` (i.e. legacy):
 *   1. Download the PNG from Supabase Storage
 *   2. PutObject to R2 at the new key
 *   3. UPDATE contracts.signature_path to the new key
 *   4. (Optional) Remove the Supabase Storage object — gated by --delete-source
 *
 * Flags:
 *   --dry-run          Print actions without writing
 *   --delete-source    After successful migration, remove the Supabase Storage copy
 *
 * Env read from frontend/vite/supabase/functions/.env (via simple parse) — needs
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.
 */

import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const DRY_RUN = process.argv.includes("--dry-run");
const DELETE_SOURCE = process.argv.includes("--delete-source");

// Simple KEY=VALUE reader — handles the functions .env file which may contain
// ${VAR} interpolations (we ignore those; real values are the full literals in
// this project's convention).
function loadEnv(filePath) {
    const raw = readFileSync(filePath, "utf-8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!m) continue;
        out[m[1]] = m[2];
    }
    return out;
}

function resolveEnv(env, key) {
    let v = env[key];
    if (!v) return null;
    // Resolve simple ${OTHER_KEY} indirection once
    const m = v.match(/^\$\{([A-Z0-9_]+)\}$/);
    if (m) v = env[m[1]] ?? v;
    return v;
}

const envPath = path.join(ROOT, "frontend/vite/supabase/functions/.env");
const env = loadEnv(envPath);

const SUPABASE_URL = resolveEnv(env, "SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = resolveEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
const R2_ACCOUNT_ID = resolveEnv(env, "R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID = resolveEnv(env, "R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = resolveEnv(env, "R2_SECRET_ACCESS_KEY");
const R2_BUCKET_NAME = resolveEnv(env, "R2_BUCKET_NAME");

for (const [name, value] of [
    ["SUPABASE_URL", SUPABASE_URL],
    ["SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY],
    ["R2_ACCOUNT_ID", R2_ACCOUNT_ID],
    ["R2_ACCESS_KEY_ID", R2_ACCESS_KEY_ID],
    ["R2_SECRET_ACCESS_KEY", R2_SECRET_ACCESS_KEY],
    ["R2_BUCKET_NAME", R2_BUCKET_NAME],
]) {
    if (!value) {
        console.error(`[migrate-signatures] Missing env: ${name}`);
        process.exit(1);
    }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});

async function main() {
    console.log(`[migrate-signatures] ${DRY_RUN ? "DRY-RUN — " : ""}starting…`);
    const { data: contracts, error } = await supabase
        .from("contracts")
        .select("id, organization_id, signature_path")
        .not("signature_path", "is", null);
    if (error) {
        console.error("[migrate-signatures] Fetch contracts failed:", error);
        process.exit(1);
    }

    const legacy = (contracts ?? []).filter(
        (c) => c.signature_path && !c.signature_path.startsWith("orgs/"),
    );
    console.log(
        `[migrate-signatures] ${contracts?.length ?? 0} contracts with signatures, ${legacy.length} legacy (Supabase Storage)`,
    );

    if (legacy.length === 0) {
        console.log("[migrate-signatures] Nothing to migrate");
        return;
    }

    let migrated = 0;
    let skipped = 0;
    for (const c of legacy) {
        const legacyPath = c.signature_path;
        const newKey = `orgs/${c.organization_id}/contracts/${c.id}/signature-${Date.now()}.png`;
        console.log(`  → ${c.id}: ${legacyPath} → ${newKey}`);

        if (DRY_RUN) {
            migrated++;
            continue;
        }

        // 1. Download from Supabase Storage
        const download = await supabase.storage.from("org-files").download(legacyPath);
        if (download.error || !download.data) {
            console.error(`    download failed: ${download.error?.message ?? "no data"} — skipping`);
            skipped++;
            continue;
        }
        const bytes = new Uint8Array(await download.data.arrayBuffer());

        // 2. PutObject to R2
        try {
            await s3.send(
                new PutObjectCommand({
                    Bucket: R2_BUCKET_NAME,
                    Key: newKey,
                    Body: bytes,
                    ContentType: "image/png",
                }),
            );
        } catch (err) {
            console.error(`    R2 put failed:`, err.message);
            skipped++;
            continue;
        }

        // 3. UPDATE contracts.signature_path
        const updateRes = await supabase
            .from("contracts")
            .update({ signature_path: newKey })
            .eq("id", c.id);
        if (updateRes.error) {
            console.error(`    DB update failed:`, updateRes.error.message);
            // Roll back the R2 put so we don't orphan
            try {
                await s3.send(
                    new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: newKey }),
                );
            } catch {}
            skipped++;
            continue;
        }

        // 4. (Optional) remove from Supabase Storage
        if (DELETE_SOURCE) {
            const removeRes = await supabase.storage
                .from("org-files")
                .remove([legacyPath]);
            if (removeRes.error) {
                console.warn(
                    `    storage remove failed (non-fatal): ${removeRes.error.message}`,
                );
            }
        }

        migrated++;
    }

    console.log(
        `[migrate-signatures] done — migrated ${migrated}, skipped ${skipped}${DELETE_SOURCE ? "" : " (source copies retained)"}`,
    );
}

main().catch((err) => {
    console.error("[migrate-signatures] fatal:", err);
    process.exit(1);
});
