/**
 * Copies a Google/OIDC profile picture into R2, once, so that every avatar in the
 * product is an object we hold (CG-042).
 *
 * WHY. `handle_new_user` seeds `profiles.avatar_url` with the provider's own URL —
 * `lh3.googleusercontent.com/...` — and until now that is where it stayed. Every
 * other file in this product got a `files` row and an FK under CG-037; the OAuth
 * avatar was the one asset still living on somebody else's host, with no row, no
 * recorded size, no uploader, and no way to tell whether it still resolves. It
 * also meant `profiles.avatar_url` had to hold two incompatible things: an
 * external URL for Google accounts, and one of ours for uploaded avatars.
 *
 * After this runs, the account has `avatar_file_id` and `avatar_url` is NULL. The
 * column stops being storage and becomes what it now is: the staging slot a
 * provider URL sits in for the few seconds before it is mirrored.
 *
 * IDEMPOTENT AND SAFE TO SPAM. `auth.callback` fires it on every OAuth return
 * without awaiting it. An account that already has `avatar_file_id` returns
 * `{ mirrored: false, reason: "already_mirrored" }` before doing any work, so the
 * common case is one SELECT.
 *
 * BEST EFFORT BY DESIGN. Every failure path returns 200 with `mirrored: false`
 * and a reason, rather than an error status. Nothing the user asked for has
 * failed if we cannot copy their Google picture — they signed in, which is what
 * they wanted. A red toast on a successful login would be strictly worse than the
 * default-initials avatar they get instead.
 *
 * ------------------------------------------------------------------
 * THE SSRF PROBLEM, AND WHY THE URL COMES FROM WHERE IT DOES
 * ------------------------------------------------------------------
 * This function makes a server-side GET to a URL that originates outside our
 * code. That is the whole risk, and it is addressed in two independent places.
 *
 *   1. THE SOURCE. The URL is read via `oauth_avatar_source()` (CG-041), which
 *      reads `auth.identities.identity_data` — written by GoTrue from the
 *      provider's OIDC claims, and not editable by the account holder.
 *      Deliberately NOT `profiles.avatar_url` (the user can write that column
 *      through their own update policy) and NOT `raw_user_meta_data`
 *      (`auth.updateUser({ data })` writes that). Either would let any signed-in
 *      user point this fetch at an internal address.
 *
 *   2. THE TARGET. Even a provider-written value is checked before it is
 *      fetched: https only, and the host must be on ALLOWED_AVATAR_HOSTS below.
 *      "Provider-supplied" says who wrote the string, not where it points.
 *
 * Redirects are refused for the same reason — an allowed host that 302s to an
 * internal address would walk straight past check 2.
 */

import { getStorageDriver, type StorageDriver } from "../_shared/storage.ts";
import { jsonResponse } from "../_shared/http.ts";
import { resolveSelf, serveSenderFunction } from "../_shared/senderAuth.ts";

// Built on first request rather than at boot so a driver whose credentials are
// missing surfaces as a 500 on the call, not a dead worker.
let storage: StorageDriver | null = null;
const getStorage = () => (storage ??= getStorageDriver());

/**
 * Exact-suffix host allow-list. Every entry is an OAuth provider's own image CDN.
 *
 * Matched as ".suffix" or an exact equal, never `endsWith(suffix)` on its own —
 * that would accept `evilgoogleusercontent.com`, which is a domain an attacker
 * can simply register.
 *
 * Adding a provider means adding its CDN here. That is intentional friction: this
 * list is the entire outbound reach of this function.
 */
const ALLOWED_AVATAR_HOSTS = ["googleusercontent.com", "google.com"];

/** 5MB. A provider avatar is a few tens of KB; anything near this is not one. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** The fetch is on a login path, so it gets a short leash. */
const FETCH_TIMEOUT_MS = 8000;

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
};

function isAllowedAvatarUrl(raw: string): boolean {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }

    // https only. `http:` is trivially redirectable and `file:`/`data:`/`gopher:`
    // are not things we ever want Deno resolving on our behalf.
    if (url.protocol !== "https:") return false;

    // Credentials in the URL are never present on a real provider avatar and are
    // a classic way to confuse host parsing in whatever reads it next.
    if (url.username || url.password) return false;

    const host = url.hostname.toLowerCase();
    return ALLOWED_AVATAR_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function generateRandomId(): string {
    return crypto.randomUUID().replace(/-/g, "").substring(0, 12);
}

serveSenderFunction("profile_avatar-mirror", async (_body, req) => {
    const self = await resolveSelf(req);

    const { data: profile } = await self.admin
        .from("profiles")
        .select("id, avatar_url, avatar_file_id")
        .eq("id", self.userId)
        .maybeSingle();

    if (!profile) {
        return jsonResponse({ mirrored: false, reason: "no_profile" }, 200);
    }

    // The cheap exit, and the one almost every call takes. An avatar we already
    // hold — mirrored earlier, or uploaded from Settings — is finished business.
    if (profile.avatar_file_id) {
        return jsonResponse({ mirrored: false, reason: "already_mirrored" }, 200);
    }

    const { data: sourceUrl, error: sourceError } = await self.admin.rpc("oauth_avatar_source", {
        p_user_id: self.userId,
    });
    if (sourceError) {
        console.error("profile_avatar-mirror: oauth_avatar_source failed:", sourceError);
        return jsonResponse({ mirrored: false, reason: "source_lookup_failed" }, 200);
    }
    if (!sourceUrl || typeof sourceUrl !== "string") {
        // An email/password account. Nothing to mirror and nothing wrong.
        return jsonResponse({ mirrored: false, reason: "no_provider_avatar" }, 200);
    }

    if (!isAllowedAvatarUrl(sourceUrl)) {
        // Logged at warn: a provider-written URL that fails the allow-list is
        // either a provider we have not listed yet or something that deserves a
        // human look. The host is logged, never the full URL, which can carry
        // identifying path segments.
        console.warn(
            "profile_avatar-mirror: refusing disallowed avatar host",
            (() => {
                try {
                    return new URL(sourceUrl).hostname;
                } catch {
                    return "<unparseable>";
                }
            })()
        );
        return jsonResponse({ mirrored: false, reason: "host_not_allowed" }, 200);
    }

    // ---- fetch ------------------------------------------------------
    let response: Response;
    try {
        response = await fetch(sourceUrl, {
            // See the header: an allowed host that redirects to an internal
            // address would defeat the allow-list entirely. Google serves these
            // directly, so this costs nothing in practice.
            redirect: "error",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { Accept: "image/*" },
        });
    } catch (err) {
        console.warn("profile_avatar-mirror: fetch failed:", err);
        return jsonResponse({ mirrored: false, reason: "fetch_failed" }, 200);
    }

    if (!response.ok) {
        return jsonResponse({ mirrored: false, reason: `fetch_status_${response.status}` }, 200);
    }

    const contentType = (response.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
    const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
    if (!extension) {
        // An allow-list rather than a `startsWith("image/")` test: the value ends
        // up on a `files` row and in a Content-Type header the Worker serves back,
        // so `image/svg+xml` — which executes script in an <img> in some contexts
        // — must not be reachable this way.
        return jsonResponse({ mirrored: false, reason: "unsupported_content_type" }, 200);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    // Checked after reading rather than trusting Content-Length, which is a claim
    // the remote host makes and may omit.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
        return jsonResponse({ mirrored: false, reason: "unacceptable_size" }, 200);
    }

    // ---- store ------------------------------------------------------
    // The CG-036 avatar layout, byte-for-byte what `files_r2_upload-start` builds
    // for an uploaded one. A mirrored avatar is not a different kind of object and
    // must not be distinguishable by its key — the Worker serves this path
    // publicly, which is exactly the posture an avatar wants.
    const r2Key = `users/${self.userId}/avatars/${Date.now()}-${generateRandomId()}.${extension}`;

    try {
        await getStorage().putObject({ key: r2Key, body: bytes, contentType });
    } catch (err) {
        console.error("profile_avatar-mirror: putObject failed:", err);
        return jsonResponse({ mirrored: false, reason: "store_failed" }, 200);
    }

    // `organization_id` NULL — a person spans organizations, and AHR-803's
    // user-scope policies cover exactly this row shape. Unlike CG-037's backfilled
    // rows, `size` here is the real byte count: we just read it.
    const { data: fileRow, error: fileError } = await self.admin
        .from("files")
        .insert({
            r2_key: r2Key,
            name: `avatar.${extension}`,
            content_type: contentType,
            size: bytes.byteLength,
            uploaded_by: self.userId,
            organization_id: null,
        })
        .select("id")
        .single();

    if (fileError || !fileRow) {
        console.error("profile_avatar-mirror: files insert failed:", fileError);
        return jsonResponse({ mirrored: false, reason: "file_row_failed" }, 200);
    }

    // `avatar_url` to NULL is the point of the exercise, not a tidy-up. The column
    // held a URL on a host we do not control; the FK now names an object we do.
    // Readers resolve the URL from `files.r2_key` — see `Utils_Avatar_Src`.
    const { error: profileError } = await self.admin
        .from("profiles")
        .update({ avatar_file_id: fileRow.id, avatar_url: null })
        .eq("id", self.userId);

    if (profileError) {
        console.error("profile_avatar-mirror: profile update failed:", profileError);
        // The object and its row exist but nothing points at them. Reported rather
        // than swallowed, because the next call will find `avatar_file_id` still
        // NULL and mirror again — leaving an orphan behind each time.
        return jsonResponse({ mirrored: false, reason: "profile_update_failed" }, 200);
    }

    return jsonResponse({ mirrored: true, file_id: fileRow.id, r2_key: r2Key }, 200);
});
