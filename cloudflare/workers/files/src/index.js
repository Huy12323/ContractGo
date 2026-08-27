import { jwtVerify } from "jose";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
};

function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
}

/**
 * The public, UNAUTHENTICATED branch — an avatar is served to anyone who asks.
 * That makes the shapes matched here a security boundary rather than a routing
 * convenience, so each is enumerated exactly and by segment count. A loose
 * `startsWith("users/")` here would serve signatures to the world.
 *
 * Three shapes, because CG-036 refoldered avatars and existing objects were
 * deliberately NOT moved:
 *
 *   users/{id}/avatar-{ts}-{uid}.{ext}              legacy, pre-CG-036
 *   users/{id}/avatars/{ts}-{uid}.{ext}             current
 *   users/{id}/avatars/thumbnails/{ts}-{uid}.webp   current, derived
 *
 * The thumbnail is public for the same reason its parent is: it is a smaller copy
 * of an image already served without a token, so requiring one would protect
 * nothing while breaking every `<img>` that renders it.
 *
 * Note `segments[2] === "avatars"` and not `startsWith("avatar")` — the latter
 * would also match `users/{id}/avatar-x/...`, an attacker-chosen deep path.
 */
function isAvatarPath(r2Key) {
    if (!r2Key.startsWith("users/")) return false;
    const segments = r2Key.split("/");
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
 * A deliberate hole in the `orgs/` token gate below, and the only one. Everything
 * else under `orgs/` is a customer document and requires a signed token; a
 * branding logo is the opposite kind of object, because its two audiences
 * structurally CANNOT present one:
 *
 *   - an ANONYMOUS signer, who has a signing token for an envelope and no
 *     session at all, and
 *   - an EMAIL CLIENT, fetching `<img src>` from a message opened weeks later.
 *
 * The alternative — a very-long-TTL signed URL baked into outbound mail — is
 * strictly worse: a bearer credential that lives forever in a mail archive. So a
 * logo takes the avatar posture instead: unauthenticated read, unguessable key,
 * and nothing sensitive behind it. The org id in the path is not a secret; the
 * `{ts}-{uid}` filename is what makes the object unenumerable.
 *
 * Exactly four segments, and `segments[2] === "branding"` rather than a
 * `startsWith` — the same discipline `isAvatarPath` documents above, for the same
 * reason. A prefix test would also match `orgs/{id}/branding-x/{doc}.pdf`, an
 * attacker-chosen deep path, and would hand out signed documents for free.
 * There are no thumbnails in this namespace, so there is no five-segment case.
 */
function isOrgBrandingPath(r2Key) {
    if (!r2Key.startsWith("orgs/")) return false;
    const segments = r2Key.split("/");
    return segments.length === 4 && segments[2] === "branding";
}

/**
 * CG-029: `users/{user_id}/signatures/{uuid}.png`.
 *
 * A sibling of the avatar namespace in the key space and its exact opposite in
 * posture. An avatar is served to anyone who asks; a signature is forgeable
 * material, so this path requires a token whose `userId` claim matches the id in
 * the path — see the auth branch in `fetch` below.
 *
 * The segment count is checked rather than a `startsWith` on the prefix, so a key
 * like `users/x/signatures/a/b` cannot match and then be served under a token
 * minted for a different depth.
 */
function isUserSignaturePath(r2Key) {
    if (!r2Key.startsWith("users/")) return false;
    const segments = r2Key.split("/");
    return segments.length === 4 && segments[2] === "signatures";
}

function getCacheStrategy(r2Key) {
    if (isAvatarPath(r2Key)) {
        return { shared: true, ttl: 3600 };
    }
    // BEFORE the extension check below, which would otherwise match `.png` and
    // put a signature in `caches.default` — a SHARED cache, keyed by path with
    // the token stripped. That would make the object retrievable by URL alone,
    // without a token, for a week: exactly the property this namespace exists to
    // deny. Private and short-lived instead.
    if (isUserSignaturePath(r2Key)) {
        return { shared: false, ttl: 300 };
    }
    const ext = (r2Key.split(".").pop() || "").toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "mp4", "webm", "mov"].includes(ext)) {
        return { shared: true, ttl: 604800 };
    }
    if (ext === "pdf") {
        return { shared: false, ttl: 300 };
    }
    return { shared: false, ttl: 0, noCache: true };
}

function cacheControlHeader(strategy) {
    if (strategy.noCache) return "no-cache";
    const scope = strategy.shared ? "public" : "private";
    return `${scope}, max-age=${strategy.ttl}`;
}

async function serveFromR2(r2Key, env, ctx, requestUrl) {
    const strategy = getCacheStrategy(r2Key);

    const cacheKey = strategy.shared
        ? new Request(new URL(`/${r2Key}`, requestUrl.origin), { method: "GET" })
        : null;

    if (cacheKey) {
        const hit = await caches.default.match(cacheKey);
        if (hit) return hit;
    }

    const object = await env.FILES_BUCKET.get(r2Key);
    if (!object) {
        return jsonResponse({ error: "File not found" }, 404);
    }

    const response = new Response(object.body, {
        headers: {
            ...CORS_HEADERS,
            "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
            "Content-Length": object.size.toString(),
            ETag: object.httpEtag,
            "Cache-Control": cacheControlHeader(strategy),
            "Cross-Origin-Resource-Policy": "cross-origin",
        },
    });

    if (cacheKey) {
        ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    }

    return response;
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        if (request.method !== "GET") {
            return jsonResponse({ error: "Method not allowed" }, 405);
        }

        const url = new URL(request.url);
        const r2Key = decodeURIComponent(url.pathname.slice(1));
        if (!r2Key) {
            return jsonResponse({ error: "Missing path" }, 404);
        }

        try {
            // The two unauthenticated namespaces, checked BEFORE the `orgs/`
            // token gate below — that gate is what they are exceptions to.
            if (isAvatarPath(r2Key) || isOrgBrandingPath(r2Key)) {
                return await serveFromR2(r2Key, env, ctx, url);
            }

            const isSignature = isUserSignaturePath(r2Key);
            if (!isSignature && !r2Key.startsWith("orgs/")) {
                return jsonResponse({ error: "Unknown path namespace" }, 403);
            }

            const token = url.searchParams.get("token");
            if (!token) {
                return jsonResponse({ error: "Missing token" }, 401);
            }

            const secret = new TextEncoder().encode(env.WORKER_JWT_SECRET);
            let payload;
            try {
                const verified = await jwtVerify(token, secret, { algorithms: ["HS256"] });
                payload = verified.payload;
            } catch (err) {
                if (err?.code === "ERR_JWT_EXPIRED" || err?.name === "JWTExpired") {
                    return jsonResponse({ error: "Token expired" }, 401);
                }
                return jsonResponse({ error: "Invalid token" }, 401);
            }

            if (payload.r2Key !== r2Key) {
                return jsonResponse({ error: "Token/path mismatch" }, 401);
            }
            if (payload.env !== env.ENVIRONMENT) {
                return jsonResponse({ error: "Token env mismatch" }, 401);
            }
            // Which claim carries the authorization depends on the namespace,
            // because the two namespaces are scoped to different things: an
            // `orgs/**` object belongs to an organization, a signature belongs to
            // a person. Checking `orgId` on a signature would be checking a claim
            // that is legitimately absent, and checking it on nothing at all is
            // how a token minted for one user serves another's mark.
            if (isSignature) {
                // The token is bound to the exact key by the `payload.r2Key`
                // check above, so this second comparison is what stops a user
                // from being issued a token for their OWN signature and it also
                // covering someone else's — the id in the path must be theirs.
                const ownerId = r2Key.split("/")[1];
                if (!payload.userId || payload.userId !== ownerId) {
                    return jsonResponse({ error: "Token/owner mismatch" }, 401);
                }
            } else if (!payload.orgId) {
                return jsonResponse({ error: "Missing org claim" }, 401);
            }

            return await serveFromR2(r2Key, env, ctx, url);
        } catch (err) {
            console.error("Worker error:", err);
            return jsonResponse({ error: "Internal error" }, 500);
        }
    },
};
