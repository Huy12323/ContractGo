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

function isAvatarPath(r2Key) {
    if (!r2Key.startsWith("users/")) return false;
    const segments = r2Key.split("/");
    return segments.length === 3 && segments[2].startsWith("avatar-");
}

function getCacheStrategy(r2Key) {
    if (isAvatarPath(r2Key)) {
        return { shared: true, ttl: 3600 };
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
            if (isAvatarPath(r2Key)) {
                return await serveFromR2(r2Key, env, ctx, url);
            }

            if (!r2Key.startsWith("orgs/")) {
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
            if (!payload.orgId) {
                return jsonResponse({ error: "Missing org claim" }, 401);
            }

            return await serveFromR2(r2Key, env, ctx, url);
        } catch (err) {
            console.error("Worker error:", err);
            return jsonResponse({ error: "Internal error" }, 500);
        }
    },
};
