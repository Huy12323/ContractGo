/**
 * Shared identifier parser for Plane scripts.
 *
 * Accepts three input formats:
 *   - UUID:       "a538ee8f-87ee-4074-bdab-06b34f68f661"
 *   - Identifier: "SPARK-1421"
 *   - Bare number: "1421"
 *
 * Returns { type: 'uuid', value: '<uuid-string>' }
 *      or { type: 'sequence', value: <number> }
 *      or null if unparseable.
 */

function parseIdentifier(arg) {
    if (!arg) return null;
    // UUID: 8-4-4-4-12 hex
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg)) {
        return { type: "uuid", value: arg };
    }
    // PROJ-N or bare number
    const match = arg.match(/(?:\w+-)?(\d+)/i);
    if (match) {
        return { type: "sequence", value: parseInt(match[1], 10) };
    }
    return null;
}

module.exports = { parseIdentifier };
