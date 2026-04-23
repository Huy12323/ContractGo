// Product-level upload-size gate. The edge-fn `files_r2_upload-start` enforces
// a separate 500MB API-abuse ceiling; this constant is the softer policy cap
// surfaced to users. Bump here when a real need arises; infra tolerates ≤500MB.
export const MAX_UPLOAD_SIZE_MB = 50;
export const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
