/**
 * SHA-256 of a file, computed IN THE BROWSER.
 *
 * The file never leaves the machine, and that is a product requirement rather
 * than an optimisation: the documents people will drop here are contracts they
 * have every reason not to upload to a stranger. A verification tool that
 * appeared to send the file somewhere would not be used by the people it exists
 * for — so the page says so, and this is the function that makes the claim true.
 *
 * `crypto.subtle` is available on any secure context (https, and localhost),
 * which is every context this page can legitimately be served from.
 *
 * Its own file rather than an inline expression so it is unit-testable without
 * rendering anything, matching `utils_PageSign_IdentityCheckReady`.
 */
export const utils_Verify_FileSha256 = async (file: Blob): Promise<string> =>
    utils_Verify_Sha256FromBuffer(await file.arrayBuffer());

/**
 * The digest itself, separated from getting the bytes out of a `Blob`.
 *
 * Split because jsdom's `Blob` has no `arrayBuffer()`, so a test that went
 * through the wrapper could only ever assert against a polyfill rather than
 * against the real vectors — and the vectors are the whole point: this value has
 * to agree exactly with `sha256Bytes` in the edge functions, or a genuine
 * document fails to verify with no error anyone can see.
 *
 * The wrapper above is then one line with nothing left to get wrong.
 */
export const utils_Verify_Sha256FromBuffer = async (buffer: ArrayBuffer): Promise<string> =>
    utils_Verify_HexFromBuffer(await crypto.subtle.digest("SHA-256", buffer));

/**
 * Lowercase hex, because that is what the server compares against.
 * `signature_request_verify_by_hash` guards on `^[0-9a-f]{64}$`, and
 * `sha256Bytes` in the edge functions produces the same casing — a mismatch here
 * would be an unverifiable document with no error to explain it.
 */
export const utils_Verify_HexFromBuffer = (buffer: ArrayBuffer): string =>
    Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

/** The shape the server accepts. Used to tell "not ours" from "not a digest". */
export const utils_Verify_IsSha256 = (value: string): boolean =>
    /^[0-9a-f]{64}$/.test(value.trim().toLowerCase());
