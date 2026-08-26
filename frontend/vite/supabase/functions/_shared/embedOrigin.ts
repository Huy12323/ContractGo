/**
 * Origin matching for embedded signing — CG-047, v1.4.0 Phase E.
 *
 * IMPORTS NOTHING, deliberately, so `docs/testing.md`'s rule lets the unit silo
 * import it directly. This is the one comparison standing between "a key's owner
 * registered this origin" and "a signing session will postMessage its events
 * there", and it is exactly the kind of string comparison that is quietly wrong
 * for years: a trailing slash, a capital letter in a hostname, an explicit `:443`
 * on one side and not the other. Every one of those failure modes is a REFUSAL
 * rather than an over-permission, which is the safe direction — but a refusal
 * that nobody can explain gets "fixed" later by someone relaxing the check.
 *
 * ═══ WHAT IS DELIBERATELY NOT SUPPORTED ═══
 *
 *   - WILDCARDS. Not `*`, not `*.example.com`, not an empty allowlist meaning
 *     "any". `api_key_issue`'s regex already refuses to store one; this refuses
 *     to match one if it ever got stored by another route. A subdomain wildcard
 *     is a real convenience and a real hole: one forgotten staging host on the
 *     apex domain receives every customer's signing events.
 *   - PATHS. An origin is scheme + host + port and nothing else. A browser's
 *     `event.origin` never carries a path, and `postMessage`'s `targetOrigin`
 *     ignores everything after it — so accepting one would mean storing a string
 *     that reads as narrower than it behaves.
 *   - CASE-SENSITIVE HOSTS. Hostnames are case-insensitive; `EXAMPLE.com` and
 *     `example.com` are the same host, and treating them as different would
 *     refuse an integrator whose config file happens to be capitalised.
 *     Everything AFTER the host in a URL is case-sensitive, which is one more
 *     reason paths are not accepted here.
 */

/**
 * Reduce an origin to its canonical comparable form, or `null` if it is not a
 * bare origin at all.
 *
 * `null` is the answer for anything with a path, a query, a fragment,
 * credentials, a wildcard, or a scheme other than http/https — never a
 * best-effort repair. A function that quietly rewrote `https://a.com/embed` into
 * `https://a.com` would be silently widening what the caller asked for.
 */
export function normalizeOrigin(raw: string | null | undefined): string | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // The same shape `api_key_issue` enforces at storage time, asserted again at
    // comparison time. Two checks of one rule, because the storage side cannot
    // see what a future caller sends and this side cannot see what an older key
    // already holds.
    // Case-INSENSITIVE on the scheme. `api_key_issue`'s copy of this pattern is
    // not, deliberately — it refuses a mixed-case entry at storage time, which is
    // the safe direction for something written once by an admin. This side is
    // read on every call from an integrator's config file, where `HTTPS://` is a
    // spelling and not a different origin.
    if (!/^https?:\/\/[A-Za-z0-9._-]+(:[0-9]{1,5})?$/i.test(trimmed)) return null;

    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }

    // `URL.origin` lowercases the scheme and host and drops the port when it is
    // the scheme's default — so `https://App.Example.com:443` and
    // `https://app.example.com` both reduce to the same string, and a key that
    // registered either matches a caller sending either.
    const origin = url.origin;
    return origin === "null" ? null : origin;
}

/**
 * Whether `requested` is one of the origins this key registered.
 *
 * AN EMPTY ALLOWLIST IS NOT A WILDCARD — it is the answer "this key was never
 * enabled for embedding", and it returns `false` for every input. That is the
 * property CG-044's column comment states and the reason the column defaults to
 * `'{}'`: a key minted before anyone thought about embedding cannot be used to
 * aim signing events anywhere.
 *
 * A registered entry that does not normalize is skipped rather than compared
 * raw, so a malformed row can never match by accident.
 */
export function isOriginAllowed(requested: string, allowed: readonly string[]): boolean {
    const target = normalizeOrigin(requested);
    if (target === null) return false;
    if (!Array.isArray(allowed) || allowed.length === 0) return false;

    return allowed.some((candidate) => normalizeOrigin(candidate) === target);
}
