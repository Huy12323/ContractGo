import { Utils_Files_PublicUrl } from "@/utils/Utils_Files_PublicUrl";

/**
 * The one place that turns a profile row into an <Avatar src>.
 *
 * CG-042 moved avatars onto `profiles.avatar_file_id` — a real FK into `files`,
 * like every other object in the product since CG-037 — and stopped storing a URL
 * string. So a caller can no longer read `avatar_url` and be done; it has to
 * resolve the key through the `files` row, and every consumer resolving it inline
 * would be six copies of the same concatenation.
 *
 * WHY THE URL IS BUILT RATHER THAN SIGNED. The Worker serves `users/*` avatars
 * with no token at all, which is why this is plain string concatenation and not a
 * `files_r2_sign-read-url` call. That endpoint refuses `user_avatar` outright and
 * tells the caller to do exactly this. Note that CG-029's signatures share the
 * `users/` prefix and explicitly CANNOT be built this way — they need a signed
 * URL, and `Utils_Signature_*` is where that lives.
 *
 * WHY IT BRANCHES ON THE DRIVER. Concatenating the Worker origin unconditionally
 * is wrong under `STORAGE_DRIVER=local`, where there is no Worker and the bytes
 * are in Supabase Storage — the URL resolved to `localhost:8787`, nothing was
 * listening, and every avatar rendered broken. The local driver now mirrors the
 * Worker's public branch with a public bucket (`files-public`, see
 * `_shared/storage.ts`), so both drivers have a real public origin and this stays
 * a synchronous string build. That matters: an async resolve would mean an
 * edge-function round trip per face in a members list.
 *
 * `avatar_url` is still consulted, and the order matters. It is now a staging
 * slot rather than storage: `handle_new_user` writes the provider's own URL there
 * on a fresh Google signup, and `profile_avatar-mirror` replaces it with a
 * `files` row moments later. Preferring the file means a mirrored avatar wins as
 * soon as it exists, while the provider URL still renders during the seconds
 * before the mirror completes — and keeps rendering for an account whose host is
 * not on the mirror's allow-list.
 */
/**
 * The driver branch and the bucket-name coupling now live in
 * `Utils_Files_PublicUrl` — CG-050 added a second public namespace (org branding)
 * and one implementation must serve both.
 */
const publicObjectUrl = Utils_Files_PublicUrl;

export const Utils_Avatar_Src = (
    profile:
        | {
              avatar_url?: string | null;
              /**
               * The joined `files` row. Shaped as PostgREST returns an embedded resource so
               * callers can hand over what they selected without reshaping it — and as an
               * array too, because an embed through a nullable FK is typed that way in some
               * of the generated query types.
               */
              files?: { r2_key: string } | { r2_key: string }[] | null;
          }
        | null
        | undefined
): string | undefined => {
    if (!profile) return undefined;

    const file = Array.isArray(profile.files) ? profile.files[0] : profile.files;
    if (file?.r2_key) return publicObjectUrl(file.r2_key);

    return profile.avatar_url ?? undefined;
};

/**
 * The same URL for a key the caller already holds — the settings screen's
 * optimistic preview, which has the upload result but not yet a refetched row.
 */
export const Utils_Avatar_SrcFromKey = publicObjectUrl;

/**
 * The PostgREST embed every avatar-rendering query needs, named once so the six
 * callsites cannot drift into five slightly different spellings.
 *
 * `files:avatar_file_id (r2_key)` — aliased to `files` because `Utils_Avatar_Src`
 * above reads that key, and disambiguated by column because `profiles` has
 * exactly one FK into `files` today but will not necessarily always.
 */
export const AVATAR_FILE_SELECT = "files:avatar_file_id (r2_key)";
