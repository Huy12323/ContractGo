/**
 * Object-storage driver seam.
 *
 * The product targets Cloudflare R2 (presigned S3 PUT for writes, a CF Worker
 * serving reads behind an HS256 token). Until an R2 account exists, the `local`
 * driver backs the exact same three operations with the Supabase Storage bucket
 * that already ships with the local stack — no Cloudflare account, no Worker,
 * no `pnpm dev:w`.
 *
 * Everything R2-specific stays intact behind `driver === "r2"`; flipping
 * STORAGE_DRIVER back to `r2` restores the original behaviour with no other
 * code change. Object keys (`r2_key`) are identical under both drivers, so rows
 * written while on `local` keep pointing at the right path after the swap — only
 * the bytes need migrating.
 *
 * Selected by env STORAGE_DRIVER: "local" | "r2" (default "r2").
 */

import { createClient } from "supabase";

export type StorageDriverName = "local" | "r2";

export type ReadUrlClaims = {
    userId: string;
    /**
     * NULL for user-scoped resources (CG-029's saved signatures), which belong to
     * a person rather than to an organization — the same reason `user_signatures`
     * carries no `organization_id` column.
     *
     * The Worker is the enforcement: its `orgs/**` branch rejects a token whose
     * `orgId` is absent, and its `users/{id}/signatures/**` branch ignores `orgId`
     * and matches `userId` against the path instead. So a null here cannot be used
     * to reach an org object.
     */
    orgId: string | null;
    resourceId: string;
    resourceType: string;
};

export type StorageDriver = {
    name: StorageDriverName;
    /** Presigned URL the browser PUTs the raw file body to. */
    createUploadUrl(args: {
        key: string;
        contentType: string;
        expiresIn: number;
    }): Promise<{ uploadUrl: string; expiresAt: string }>;
    /** Time-limited URL the browser GETs the object from. */
    createReadUrl(args: { key: string; expiresIn: number; claims: ReadUrlClaims }): Promise<string>;
    /**
     * Permanent URL for an object in the PUBLIC namespace — the server-side twin
     * of `Utils_Files_PublicUrl` in `src/utils/`. Note the coupling: both build
     * the same URL from the same key, and both must branch on the same driver.
     *
     * Synchronous and unsigned, because the Worker serves these with no token.
     * CG-050 needs it so an org logo can be embedded in outbound email, where a
     * signed URL cannot work: the recipient's mail client has no credential and
     * opens the message weeks later.
     *
     * ONLY VALID FOR `isPublicObjectKey` KEYS. Handing it a document key produces
     * a URL the Worker answers with 401.
     */
    publicUrl(key: string): string;
    /** Best-effort delete; individual key failures are logged, never thrown. */
    deleteObjects(keys: string[]): Promise<void>;
    /**
     * Server-side read. Needed by the signing pipeline, which fetches the source
     * PDF, the font and the signature image inside the edge function rather than
     * round-tripping them through the browser.
     */
    getObject(key: string): Promise<Uint8Array>;
    /**
     * Server-side write. The burned and signed PDFs are produced on the server
     * and must never be uploaded by the client — a presigned PUT would let the
     * signer substitute a different document for the one they were shown.
     */
    putObject(args: { key: string; body: Uint8Array; contentType: string }): Promise<void>;
};

export function getStorageDriverName(): StorageDriverName {
    return Deno.env.get("STORAGE_DRIVER") === "local" ? "local" : "r2";
}

/**
 * Is this an object the Worker serves to anyone, with no token?
 *
 * MUST STAY IN STEP WITH `isAvatarPath` in `cloudflare/workers/files/src/index.js`.
 * The two are the same rule stated in the two runtimes that need it, and the rule
 * is a security boundary in both: the Worker uses it to decide what to serve
 * unauthenticated, and the local driver below uses it to decide which bucket an
 * object belongs in.
 *
 * Three shapes, because CG-036 refoldered avatars without moving existing objects:
 *
 *   users/{id}/avatar-{ts}-{uid}.{ext}              legacy, pre-CG-036
 *   users/{id}/avatars/{ts}-{uid}.{ext}             current
 *   users/{id}/avatars/thumbnails/{ts}-{uid}.webp   current, derived
 *
 * Signatures share the `users/` prefix and are emphatically NOT public — hence
 * the exact segment counts rather than a prefix test.
 */
function isPublicAvatarKey(key: string): boolean {
    if (!key.startsWith("users/")) return false;
    const segments = key.split("/");
    if (segments.length === 3) return segments[2].startsWith("avatar-");
    if (segments.length === 4) return segments[2] === "avatars";
    if (segments.length === 5) {
        return segments[2] === "avatars" && segments[3] === "thumbnails";
    }
    return false;
}

/**
 * CG-050: `orgs/{org_id}/branding/{ts}-{uid}.{ext}` — exactly four segments.
 *
 * MUST STAY IN STEP WITH `isOrgBrandingPath` in the Worker, whose docblock
 * carries the full argument for why a logo is public at all. The short version:
 * its two audiences are an anonymous signer and an email client, and neither can
 * present a token.
 *
 * `segments[2] === "branding"` and never a `startsWith` — a prefix test would
 * also match `orgs/{id}/branding-x/{doc}.pdf` and serve customer documents
 * without a token. There are no thumbnails here, so there is no five-segment
 * case. Every OTHER key under `orgs/` is a document and stays token-gated.
 */
function isPublicOrgBrandingKey(key: string): boolean {
    if (!key.startsWith("orgs/")) return false;
    const segments = key.split("/");
    return segments.length === 4 && segments[2] === "branding";
}

/**
 * The full public namespace: avatars (CG-036) and org branding (CG-050).
 *
 * This is the predicate the local driver routes buckets by, and it must be the
 * union of every unauthenticated branch in the Worker's `fetch`. A key that is
 * public there and private here means `STORAGE_DRIVER=local` renders a broken
 * image; the reverse means an object sits in a public bucket that the Worker
 * would have refused to serve.
 */
export function isPublicObjectKey(key: string): boolean {
    return isPublicAvatarKey(key) || isPublicOrgBrandingKey(key);
}

/**
 * Builds the configured driver. Env is read lazily *inside* each driver so a
 * `local` deployment never needs R2 credentials present (and vice versa).
 */
export function getStorageDriver(): StorageDriver {
    return getStorageDriverName() === "local" ? createLocalDriver() : createR2Driver();
}

function requireEnv(name: string): string {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

// ============================================================
// local driver — Supabase Storage (temporary R2 stand-in)
// ============================================================

const LOCAL_BUCKET = Deno.env.get("STORAGE_LOCAL_BUCKET") || "files";

/**
 * The stand-in for the Worker's public branch.
 *
 * WHY A SECOND BUCKET. The R2 path serves avatars with no token at all — that is
 * what makes an avatar cheap enough to put in a members list, and it is why
 * `files_r2_sign-read-url` refuses `user_avatar` outright and tells callers to
 * build the URL from the key. The local driver had no equivalent: everything went
 * into one PRIVATE bucket, so the concatenated URL resolved to nothing and every
 * avatar rendered as a broken image under `STORAGE_DRIVER=local`.
 *
 * A signed-URL path for avatars would have "fixed" it while quietly changing the
 * shape of the product — an edge-function round trip per face in every list, and
 * a seam that no longer models the thing it stands in for. Two buckets is the
 * faithful version: public for exactly what the Worker serves publicly, private
 * for everything else.
 *
 * Keys are IDENTICAL in both buckets and identical to R2, so the promise at the
 * top of this file still holds — flipping STORAGE_DRIVER back to `r2` needs no
 * row rewrite, only the bytes migrated.
 */
const LOCAL_PUBLIC_BUCKET = Deno.env.get("STORAGE_LOCAL_PUBLIC_BUCKET") || "files-public";

function createLocalDriver(): StorageDriver {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    // Inside the edge runtime container SUPABASE_URL resolves to an internal host
    // (kong:8000) that a browser can't reach, so signed URLs get their origin
    // rewritten to the browser-facing one before being handed back.
    const publicUrl = (Deno.env.get("STORAGE_LOCAL_PUBLIC_URL") || supabaseUrl).replace(/\/+$/, "");
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const toPublicUrl = (url: string): string => {
        try {
            const parsed = new URL(url);
            return `${publicUrl}${parsed.pathname}${parsed.search}`;
        } catch {
            return url;
        }
    };

    // Which bucket an object lives in is decided by the KEY, never by the caller.
    // A caller that could choose would be a caller that could put a contract PDF
    // in the public bucket.
    const bucketFor = (key: string) =>
        isPublicObjectKey(key) ? LOCAL_PUBLIC_BUCKET : LOCAL_BUCKET;

    const bucketReady: Record<string, Promise<void> | undefined> = {};
    const ensureBucket = (bucket: string) => {
        // Created on first use rather than by migration — the buckets are an
        // artifact of this stand-in, and shouldn't leak into a real (R2-backed)
        // deployment.
        bucketReady[bucket] ??= (async () => {
            const { error } = await admin.storage.createBucket(bucket, {
                public: bucket === LOCAL_PUBLIC_BUCKET,
                fileSizeLimit: 500 * 1024 * 1024,
            });
            // "already exists" is the steady state, not a failure.
            if (error && !/exist/i.test(error.message)) {
                bucketReady[bucket] = undefined;
                throw new Error(`Failed to create storage bucket ${bucket}: ${error.message}`);
            }
        })();
        return bucketReady[bucket];
    };

    return {
        name: "local",
        // Mirrors the Worker's public branch: the local driver keeps public
        // objects in a public Supabase Storage bucket, so the URL is the bucket
        // object path rather than a Worker origin.
        publicUrl: (key: string) =>
            `${publicUrl}/storage/v1/object/public/${LOCAL_PUBLIC_BUCKET}/${key}`,

        async createUploadUrl({ key, expiresIn }) {
            await ensureBucket(bucketFor(key));
            const { data, error } = await admin.storage
                .from(bucketFor(key))
                .createSignedUploadUrl(key, { upsert: true });
            if (error || !data) {
                throw new Error(`Failed to sign upload URL: ${error?.message ?? "unknown error"}`);
            }
            return {
                uploadUrl: toPublicUrl(data.signedUrl),
                expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
            };
        },

        async createReadUrl({ key, expiresIn }) {
            const bucket = bucketFor(key);
            await ensureBucket(bucket);

            // A public-bucket object has no signature to add, and asking for one
            // would produce a URL that expires — for bytes the R2 path serves
            // forever, cached, to anyone. Same answer as the frontend's
            // `Utils_Avatar_Src` builds without a round trip.
            if (bucket === LOCAL_PUBLIC_BUCKET) {
                const { data } = admin.storage.from(bucket).getPublicUrl(key);
                return toPublicUrl(data.publicUrl);
            }

            const { data, error } = await admin.storage
                .from(bucket)
                .createSignedUrl(key, expiresIn);
            if (error || !data) {
                throw new Error(`Failed to sign read URL: ${error?.message ?? "unknown error"}`);
            }
            return toPublicUrl(data.signedUrl);
        },

        async deleteObjects(keys) {
            if (!keys.length) return;
            // Grouped, because a batch can legitimately span both buckets — an
            // avatar and its thumbnail are public, the file beside them may not be.
            const byBucket = new Map<string, string[]>();
            for (const key of keys) {
                const bucket = bucketFor(key);
                byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), key]);
            }
            for (const [bucket, bucketKeys] of byBucket) {
                const { error } = await admin.storage.from(bucket).remove(bucketKeys);
                if (error) {
                    console.error(`Local storage delete failed (continuing):`, error);
                }
            }
        },

        async getObject(key) {
            await ensureBucket(bucketFor(key));
            const { data, error } = await admin.storage.from(bucketFor(key)).download(key);
            if (error || !data) {
                throw new Error(`Failed to read object ${key}: ${error?.message ?? "not found"}`);
            }
            return new Uint8Array(await data.arrayBuffer());
        },

        async putObject({ key, body, contentType }) {
            await ensureBucket(bucketFor(key));
            const { error } = await admin.storage
                .from(bucketFor(key))
                .upload(key, body, { contentType, upsert: true });
            if (error) {
                throw new Error(`Failed to write object ${key}: ${error.message}`);
            }
        },
    };
}

// ============================================================
// r2 driver — Cloudflare R2 + files-serving Worker (production path)
// ============================================================

function createR2Driver(): StorageDriver {
    const accountId = requireEnv("R2_ACCOUNT_ID");
    const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
    const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
    const bucketName = requireEnv("R2_BUCKET_NAME");

    // Imported lazily so the `local` driver never pulls the aws-sdk / jose deps.
    const s3Promise = import("@aws-sdk/client-s3");
    const presignerPromise = import("@aws-sdk/s3-request-presigner");

    const clientPromise = s3Promise.then(
        ({ S3Client }) =>
            new S3Client({
                region: "auto",
                endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
                credentials: { accessKeyId, secretAccessKey },
            })
    );

    return {
        name: "r2",
        // The Worker origin, unsigned — it serves the public namespace with no
        // token. Same string the frontend builds from the same key.
        publicUrl: (key: string) => `${requireEnv("R2_WORKER_URL").replace(/\/+$/, "")}/${key}`,

        async createUploadUrl({ key, contentType, expiresIn }) {
            const [{ PutObjectCommand }, { getSignedUrl }, client] = await Promise.all([
                s3Promise,
                presignerPromise,
                clientPromise,
            ]);
            const command = new PutObjectCommand({
                Bucket: bucketName,
                Key: key,
                ContentType: contentType,
            });
            const uploadUrl = await getSignedUrl(client, command, { expiresIn });
            return {
                uploadUrl,
                expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
            };
        },

        async createReadUrl({ key, expiresIn, claims }) {
            const { SignJWT } = await import("jose");
            const workerJwtSecret = requireEnv("WORKER_JWT_SECRET");
            const workerUrl = requireEnv("R2_WORKER_URL").replace(/\/+$/, "");
            const environment = Deno.env.get("ENVIRONMENT") || "development";

            const now = Math.floor(Date.now() / 1000);
            const jwt = await new SignJWT({
                userId: claims.userId,
                orgId: claims.orgId,
                r2Key: key,
                resourceId: claims.resourceId,
                resourceType: claims.resourceType,
                env: environment,
            })
                .setProtectedHeader({ alg: "HS256" })
                .setIssuedAt(now)
                .setExpirationTime(now + expiresIn)
                .sign(new TextEncoder().encode(workerJwtSecret));

            return `${workerUrl}/${key}?token=${jwt}`;
        },

        async deleteObjects(keys) {
            const [{ DeleteObjectCommand }, client] = await Promise.all([s3Promise, clientPromise]);
            // Tolerate intermittent failures by logging and continuing — the DB row is
            // the audit record; orphaned objects are cheap and detectable later.
            for (const key of keys) {
                try {
                    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
                } catch (err) {
                    console.error(`R2 delete failed for key ${key} (continuing):`, err);
                }
            }
        },

        async getObject(key) {
            const [{ GetObjectCommand }, client] = await Promise.all([s3Promise, clientPromise]);
            const result = await client.send(
                new GetObjectCommand({ Bucket: bucketName, Key: key })
            );
            if (!result.Body) throw new Error(`Failed to read object ${key}: empty body`);
            return new Uint8Array(await result.Body.transformToByteArray());
        },

        async putObject({ key, body, contentType }) {
            const [{ PutObjectCommand }, client] = await Promise.all([s3Promise, clientPromise]);
            await client.send(
                new PutObjectCommand({
                    Bucket: bucketName,
                    Key: key,
                    Body: body,
                    ContentType: contentType,
                })
            );
        },
    };
}
