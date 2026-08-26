/**
 * HTTP plumbing every edge function repeats identically.
 *
 * Extracted from `signerAuth.ts`, which still re-exports `corsHeaders` and
 * `jsonResponse` so its existing consumers are untouched. The split exists
 * because the SENDER-side functions need the same three lines and importing
 * them from a module named "signerAuth" would imply an authorization model they
 * do not use.
 */

export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

export function requireEnv(name: string): string {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

/** First hop only — later entries in `x-forwarded-for` are attacker-controlled. */
export function getRequestIp(req: Request): string | null {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded || req.headers.get("cf-connecting-ip") || null;
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
    // `BufferSource` narrowed to `ArrayBufferView<ArrayBuffer>` in TypeScript 5.7,
    // so a plain `Uint8Array` (i.e. `Uint8Array<ArrayBufferLike>`) no longer
    // satisfies it. The cast is type-level only — widening the parameter instead
    // would push the same complaint out to every caller.
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
