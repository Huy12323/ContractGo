import { ENVs } from "@/utils/ENVs/ENVs";

/**
 * The URL of an object the Worker serves to anyone, with no token.
 *
 * Lifted out of `Utils_Avatar_Src.ts` by CG-050, which added a second public
 * namespace: an organization's branding logo at `orgs/{id}/branding/{file}`. A
 * logo is not an avatar, and leaving this function named `Utils_Avatar_*` is the
 * kind of misnaming that sends the next person looking for logos under `users/`.
 *
 * WHY THE URL IS BUILT RATHER THAN SIGNED, and why that is not a shortcut: the
 * Worker serves both public namespaces unauthenticated, so `files_r2_sign-read-url`
 * refuses them outright and tells the caller to concatenate. Being synchronous is
 * the point — an async resolve would mean an edge-function round trip per face in
 * a members list.
 *
 * THIS IS NOT A GENERAL FILE-URL BUILDER. It is correct only for keys matching
 * `isPublicObjectKey` in `supabase/functions/_shared/storage.ts`. Handing it a
 * document key produces a URL the Worker answers with 401, and handing it a
 * CG-029 signature key would be a bug of a worse kind — signatures share the
 * `users/` prefix, are forgeable material, and need a signed URL from
 * `Utils_Signature_*`.
 *
 * WHY IT BRANCHES ON THE DRIVER. Under `STORAGE_DRIVER=local` there is no Worker;
 * the local driver mirrors the Worker's public branch with a public Supabase
 * Storage bucket, so both drivers have a real public origin.
 */

/**
 * Must match `STORAGE_LOCAL_PUBLIC_BUCKET`'s default in
 * `supabase/functions/_shared/storage.ts`. Two runtimes, no shared module — so
 * the coupling is stated here rather than left to be discovered.
 */
const LOCAL_PUBLIC_BUCKET = "files-public";

export const Utils_Files_PublicUrl = (r2Key: string): string =>
    ENVs.ViteStorageDriver === "local"
        ? `${ENVs.ViteSupabaseUrl}/storage/v1/object/public/${LOCAL_PUBLIC_BUCKET}/${r2Key}`
        : `${ENVs.ViteR2WorkerUrl}/${r2Key}`;

/**
 * The PostgREST embed for an organization's logo, named once for the same reason
 * `AVATAR_FILE_SELECT` is.
 *
 * Aliased to `logo_file` rather than `files`, because a query that selects the
 * org row may legitimately want to embed a second `files` row later, and
 * `organizations` already has exactly one FK into `files` that must not become
 * ambiguous by accident.
 */
export const ORGANIZATION_LOGO_SELECT = "logo_file:logo_file_id (r2_key)" as const;

/**
 * Resolves an organization row's logo to a `<img src>`, tolerating both shapes
 * PostgREST returns an embedded resource in — an object, or a single-element
 * array when the embed goes through a nullable FK.
 */
export const Utils_Organization_LogoSrc = (
    organization:
        | { logo_file?: { r2_key: string } | { r2_key: string }[] | null }
        | null
        | undefined
): string | undefined => {
    if (!organization) return undefined;
    const file = Array.isArray(organization.logo_file)
        ? organization.logo_file[0]
        : organization.logo_file;
    return file?.r2_key ? Utils_Files_PublicUrl(file.r2_key) : undefined;
};
