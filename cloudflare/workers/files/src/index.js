/**
 * AHR files Worker — bootstrap stub.
 *
 * Auth-gated serving (JWT verification, MIME-based cache, orgs/ vs users/ rules)
 * lands in AHR-805. Keep this stub minimal until then.
 */

export default {
    async fetch(_request, env) {
        return new Response(
            `AHR files worker — bootstrap (${env.ENVIRONMENT ?? "unknown"})`,
            {
                status: 200,
                headers: { "Content-Type": "text/plain" },
            },
        );
    },
};
