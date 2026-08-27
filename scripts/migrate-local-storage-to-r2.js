#!/usr/bin/env node
/**
 * One-off: copy every object in the LOCAL Supabase Storage buckets (`files`,
 * `files-public`) into the R2 bucket, key-for-key.
 *
 * Object keys are identical under both storage drivers (see
 * supabase/functions/_shared/storage.ts) — the DB's `r2_key` values already
 * point at the right paths, so only the bytes need moving. Nothing in the DB
 * is touched by this script.
 *
 * Usage:
 *   node scripts/migrate-local-storage-to-r2.js --dry-run
 *   node scripts/migrate-local-storage-to-r2.js
 *   node scripts/migrate-local-storage-to-r2.js --overwrite   # re-put keys already in R2
 *
 * Local source is read from `supabase status` (never from .env, which now
 * points at the remote project). R2 target is read from .env.dev.
 */

const { execFileSync } = require("child_process");
const path = require("path");
const { config } = require("dotenv");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const ROOT = path.resolve(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");
const OVERWRITE = process.argv.includes("--overwrite");
const DB_CONTAINER = "supabase_db_aiur-hr";

function localStatus() {
    const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
        cwd: path.join(ROOT, "frontend", "vite"),
        encoding: "utf-8",
        shell: true,
    });
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    return JSON.parse(json);
}

function listLocalObjects() {
    const sql =
        "select bucket_id || E'\t' || name || E'\t' || coalesce(metadata->>'mimetype','application/octet-stream') " +
        "from storage.objects order by bucket_id, name;";
    const out = execFileSync(
        "docker",
        ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", sql],
        { encoding: "utf-8" }
    );
    return out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
            const [bucket, key, contentType] = l.split("\t");
            return { bucket, key, contentType };
        });
}

async function main() {
    const env = config({ path: path.join(ROOT, ".env.dev") }).parsed || {};
    const need = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
    const missing = need.filter((k) => !env[k]);
    if (missing.length) {
        console.error(`Missing in .env.dev: ${missing.join(", ")}`);
        process.exit(1);
    }

    const status = localStatus();
    const localUrl = status.API_URL;
    const localKey = status.SECRET_KEY || status.SERVICE_ROLE_KEY;

    const s3 = new S3Client({
        region: "auto",
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        },
    });

    const objects = listLocalObjects();
    console.log(
        `${objects.length} local object(s) -> r2://${env.R2_BUCKET_NAME}` +
            `${DRY_RUN ? "  [DRY RUN]" : ""}\n`
    );

    let copied = 0,
        skipped = 0,
        failed = 0,
        bytes = 0;

    for (const { bucket, key, contentType } of objects) {
        const label = `${bucket}/${key}`;
        try {
            if (!OVERWRITE) {
                try {
                    await s3.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
                    console.log(`  = exists   ${label}`);
                    skipped++;
                    continue;
                } catch (e) {
                    if (e?.$metadata?.httpStatusCode !== 404 && e.name !== "NotFound") throw e;
                }
            }

            const res = await fetch(
                `${localUrl}/storage/v1/object/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`,
                { headers: { Authorization: `Bearer ${localKey}`, apikey: localKey } }
            );
            if (!res.ok) throw new Error(`download ${res.status} ${await res.text()}`);
            const body = Buffer.from(await res.arrayBuffer());

            if (DRY_RUN) {
                console.log(`  + would copy ${label} (${body.length} B)`);
            } else {
                await s3.send(
                    new PutObjectCommand({
                        Bucket: env.R2_BUCKET_NAME,
                        Key: key,
                        Body: body,
                        ContentType: contentType,
                    })
                );
                console.log(`  + copied   ${label} (${body.length} B)`);
            }
            bytes += body.length;
            copied++;
        } catch (err) {
            console.error(`  ! FAILED   ${label}: ${err.message}`);
            failed++;
        }
    }

    console.log(
        `\ncopied=${copied} skipped=${skipped} failed=${failed} bytes=${bytes}` +
            `${DRY_RUN ? "  [DRY RUN — nothing written]" : ""}`
    );
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
