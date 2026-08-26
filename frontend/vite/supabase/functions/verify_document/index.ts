/**
 * verify_document — the product's only unauthenticated READ surface.
 *
 * A counterparty holding a signed ContractGo PDF has, until now, had no way to
 * confirm it is the document that was actually signed. The evidence existed and
 * was readable only by someone logged into the sending organization. This closes
 * that, and it is the whole point of v1.3.0's compliance half.
 *
 * ═══ THE SHA-256 IS THE CREDENTIAL ═══
 *
 * The caller presents a digest OF THE ARTIFACT — not a document id. That
 * distinction is the security design, not a detail:
 *
 *   * A document id is short, enumerable, and ends up in URLs, browser history,
 *     Referer headers and server logs. A public endpoint keyed on one is an
 *     oracle for "does envelope X exist".
 *   * A sha256 cannot be minted, cannot be guessed (2^256), and can ONLY be
 *     produced by someone who actually holds the file. Possession of the digest
 *     therefore proves possession of the document.
 *
 * That is what licenses the disclosure set: everything returned is something the
 * holder can already read off the page in front of them. Nothing else is — no
 * field values, no R2 keys, no row ids, no audit payloads, and no unmasked email
 * address (`mask_email` runs in SQL so no caller here can forget).
 *
 * ═══ WHY THIS IS A FUNCTION AND NOT AN RLS POLICY ═══
 *
 * CG-009 and CG-010 both assert, inside the migration, that no RLS policy
 * anywhere targets `anon`, and CG-010's tripwire fails `db push` if a new
 * function becomes anon-executable. A public read therefore cannot be a policy
 * and cannot be an anon RPC. It is a `verify_jwt = false` edge function calling a
 * service_role-only routine — the same shape the entire external signer surface
 * already uses, and the project's settled answer to "an unauthenticated caller
 * needs one specific fact".
 *
 * ═══ IT WRITES NOTHING TO THE AUDIT CHAIN ═══
 *
 * `signature_audit_append` takes `FOR UPDATE` on the request, so anonymous
 * traffic appending to the chain would serialize the signing surface against
 * unauthenticated callers — and would drown the genuine entries besides, exactly
 * as `envelopes_document-url`'s header says a viewer must never do. Verifying is
 * a read. Taking a copy of the finished document is the act worth recording, and
 * `envelopes_download-signed` already records it.
 *
 * ═══ ONE NEGATIVE SHAPE, THREE CAUSES ═══
 *
 * An unknown hash, a request that is not `completed`, and a throttled caller are
 * ALL `{ verified: false }`. Distinguishing them would hand an attacker a
 * progress signal. This mirrors `resolveSignerToken`, which refuses expired,
 * revoked and nonexistent tokens with one opaque message for the same reason.
 */

import { createClient } from "supabase";
import { corsHeaders, getRequestIp, jsonResponse, requireEnv } from "../_shared/http.ts";

/** Matches `signature_request_verify_by_hash`'s own guard. */
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Calls per hour per client. Generous for a human checking documents, and low
 * enough that the endpoint cannot be used to hammer the database — which is the
 * only thing the limit is defending, since the digests themselves are
 * unguessable.
 */
const MAX_PER_HOUR = 60;

/**
 * The aggregate cap for callers whose IP cannot be resolved.
 *
 * FOUND BY SMOKE-TESTING, NOT BY REVIEW: `getRequestIp` returns null unless the
 * gateway sets `x-forwarded-for` or `cf-connecting-ip`, and under a local
 * `supabase functions serve` neither is present. Passing that null through as the
 * throttle key made the limit INERT — 62 calls in a row left `verify_rate_limits`
 * completely empty. A defence that silently does nothing is worse than none,
 * because the risk register says it is there.
 *
 * So an unattributable caller falls back to ONE SHARED BUCKET rather than to no
 * bucket. The cap is an order of magnitude higher than the per-IP one precisely
 * because it is shared: on a deployment where the header never arrives, every
 * legitimate visitor lands here together, and a 60/hour aggregate would deny
 * service to the people the page exists for. It bounds a runaway loop without
 * punishing normal use, which is the honest shape of the trade.
 */
const UNATTRIBUTED_KEY = "unattributed";
const UNATTRIBUTED_MAX_PER_HOUR = 600;

type VerifyRow = {
    document_title: string;
    organization_name: string;
    finished_at: string | null;
    matched_artifact: "signed_document" | "certificate";
    signer_count: number;
    signers: Array<{
        name: string;
        email_masked: string | null;
        signed_at: string | null;
        status: string;
        auth_methods: string[];
    }>;
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let body: Record<string, unknown>;
    try {
        body = (await req.json()) as Record<string, unknown>;
    } catch {
        return jsonResponse({ error: "Invalid request body" }, 400);
    }

    // Normalised, then validated. Someone pasting a digest from `sha256sum` on
    // Windows or from a hex viewer gets uppercase, and refusing that would be a
    // dead end over a detail the server can simply handle. Validation happens
    // BEFORE any database call so a malformed request never reaches Postgres —
    // the SQL guards again anyway, because that function is the security
    // boundary and must not trust its caller.
    const sha256 = String(body.sha256 ?? "")
        .trim()
        .toLowerCase();
    if (!SHA256_RE.test(sha256)) {
        return jsonResponse(
            {
                error: "invalid_hash",
                message: "A document fingerprint is 64 hexadecimal characters.",
            },
            400
        );
    }

    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));

    // The IP is the throttle key and nothing else: it is not stored against a
    // person, not joined to anything, and `verify_rate_limits` keeps it only for
    // the length of a window. When it cannot be resolved the caller shares one
    // bucket with every other unattributable caller rather than escaping the
    // limit entirely — see UNATTRIBUTED_KEY.
    const ip = getRequestIp(req);
    const clientKey = ip ?? UNATTRIBUTED_KEY;
    const maxPerHour = ip ? MAX_PER_HOUR : UNATTRIBUTED_MAX_PER_HOUR;

    // ═══ NOT `.maybeSingle()`, AND THIS IS NOT A STYLE CHOICE ═══
    //
    // `.maybeSingle()` sets `Accept: application/vnd.pgrst.object+json`. When the
    // RPC returns ZERO rows PostgREST answers **406** — an error response — and
    // PostgREST ROLLS BACK THE TRANSACTION on an error. This RPC WRITES (the
    // throttle counter) before it selects, so the rollback silently discarded the
    // very counter that is meant to bound this endpoint. Worse, supabase-js
    // swallows that 406 into `{ data: null, error: null }`, so nothing surfaced:
    // the refusal path looked perfect and the limit did not exist. It was
    // reverted on exactly the not-found path an attacker would hammer.
    //
    // Caught by smoke test — 62 calls left `verify_rate_limits` completely empty
    // — and confirmed by running the identical call as a raw `fetch` from inside
    // this function, which DID persist the row. Reading the array instead:
    // PostgREST returns `[]` with a 200, the transaction commits, the counter
    // survives.
    //
    // The rule generalises beyond this file: never `.single()` / `.maybeSingle()`
    // on an RPC that also writes.
    const { data, error } = await admin.rpc("signature_request_verify_by_hash", {
        p_sha256: sha256,
        p_client_key: clientKey,
        p_max_per_hr: maxPerHour,
    });

    if (error) {
        console.error("verify_document: lookup failed:", error);
        return jsonResponse({ error: "Internal error" }, 500);
    }

    const row = (data as VerifyRow[] | null)?.[0] ?? null;
    if (!row) {
        return jsonResponse({ verified: false }, 200);
    }

    return jsonResponse(
        {
            verified: true,
            // Which artifact the digest matched. A holder of the certificate and
            // a holder of the contract both get a positive answer, and telling
            // them WHICH one they are holding is the difference between "this is
            // genuine" and "this is genuine, and it is the contract".
            matched: row.matched_artifact,
            document_title: row.document_title,
            organization_name: row.organization_name,
            completed_at: row.finished_at,
            signer_count: row.signer_count,
            signers: row.signers ?? [],
        },
        200
    );
});
