/**
 * signing_ai_ask — one question about the document, answered from the document.
 *
 * PUBLIC: deployed with `verify_jwt = false` (enumerated explicitly in
 * config.toml, never disabled globally). The access token in the POST body is
 * the only credential and `resolveSignerToken` is the mandatory first statement.
 *
 * ORCHESTRATION ONLY. No prompt strings, no vendor code, no verification logic
 * live here — those are `_shared/aiPrompt.ts` (pure, unit tested) and
 * `_shared/ai.*.ts` (the driver seam). This file decides WHEN to call, what to
 * charge for it, and what to give back when it fails.
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS THAT LOOK LIKE DETAILS AND ARE NOT
 * ---------------------------------------------------------------------------
 *
 * 1. `countUse: false`, for CG-031's exact reason. A leaked link firing thirty
 *    questions must not exhaust the REAL signer's hundred uses and lock them out
 *    of the document they were sent. Chatting is not "the document was opened".
 *
 * 2. `assertCanAct`, deliberately gated rather than open. A CC observer cannot
 *    chat, nor can a signer whose turn has not come, nor one on a declined or
 *    expired envelope. Fail closed, matching every other public signing
 *    function — and it means a dead envelope cannot burn shared quota. This is a
 *    stated decision, not an oversight; widening it later is one line.
 *
 * 3. HISTORY IS LOADED FROM POSTGRES AND IS NEVER ACCEPTED FROM THE CLIENT.
 *    On a `verify_jwt = false` endpoint, client-supplied history means the
 *    attacker authors the MODEL'S OWN prior turns — the most reliable jailbreak
 *    there is, because a model's strongest prior is its own apparent past
 *    behaviour. Every control in `aiPrompt.ts` is defeated at once by it. It
 *    also makes the 1000-character question cap decorative: thirty allowed turns
 *    times an unbounded history field is thirty arbitrary prompts on the
 *    sender's quota. The cost of doing it properly is one indexed SELECT per
 *    turn, and it buys a transcript that survives a page reload — which on the
 *    emailed-link flow, on a phone, is most of them.
 *
 * ---------------------------------------------------------------------------
 * CHARGE AND REFUND
 * ---------------------------------------------------------------------------
 * `signer_ai_message_begin` charges the turn and both daily counters BEFORE the
 * model call, because a check that runs before the call and a write that runs
 * after it is a gap two concurrent POSTs walk straight through. Every path that
 * fails to produce an answer therefore calls `signer_ai_message_fail`, which
 * gives all three back. A safety block is NOT a failure — the upstream call
 * really happened and really spent quota — so it completes with `blocked`.
 *
 * The audit chain gets ONE event per token, on the first question only, with no
 * question and no answer text. The reasoning is argued in full in the CG-049
 * migration under PHASE 7; the short version is that a signer's questions are
 * their own words about why they hesitate, the Certificate of Completion goes to
 * the counterparty, and a chained entry is one you can never lawfully redact.
 */

import {
    assertCanAct,
    jsonResponse,
    logSignerEvent,
    resolveSignerToken,
    servePublicSigningFunction,
    SignerAuthError,
} from "../_shared/signerAuth.ts";
import { sha256Bytes } from "../_shared/http.ts";
import { getStorageDriver } from "../_shared/storage.ts";
import { getAiDriver, getAiDriverName } from "../_shared/ai.ts";
import type { AiHistoryTurn } from "../_shared/ai.ts";
import {
    buildAskRequest,
    DISCLAIMER,
    mintNonce,
    NO_CONTEXT_ANSWER,
    SAFETY_ANSWER,
    verifyAnswer,
} from "../_shared/aiPrompt.ts";
import type { AiFieldDescriptor, AiPage } from "../_shared/aiPrompt.ts";
import { extractDocumentText } from "../_shared/pdfText.ts";
import type { Rpc_SignerAiMessageBegin } from "../_shared/rpcRows.ts";

/** How long the signer waits before we give up and hand back the turn. */
const MODEL_TIMEOUT_MS = 20_000;

/** How many prior exchanges are replayed. Six is roughly a screen of context. */
const HISTORY_TURNS = 6;

const MAX_QUESTION_CHARS = 1000;

type SnapshotField = {
    id: string;
    label: string;
    type: string;
    role_id: string;
    required?: boolean;
    page: number;
};

type Snapshot = {
    layout?: SnapshotField[];
    pdf_file_path?: string | null;
};

type ContextRow = {
    id: string;
    document_text: string;
    pages: AiPage[];
    source_pdf_sha256: string;
    context_sha256: string | null;
    extraction_status: string;
};

servePublicSigningFunction("signing_ai_ask", async (body, req) => {
    const ctx = await resolveSignerToken(req, body, { countUse: false });
    await assertCanAct(ctx);

    // Before any database work: a deployment with the assistant switched off
    // should not open a session or move a counter to say so.
    if (getAiDriverName() === "off") {
        throw new SignerAuthError(503, "The document assistant is not available right now.");
    }

    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
        throw new SignerAuthError(400, "Ask a question about the document.");
    }
    if (question.length > MAX_QUESTION_CHARS) {
        throw new SignerAuthError(
            400,
            `That question is too long — keep it under ${MAX_QUESTION_CHARS} characters.`
        );
    }

    // ---- Charge first. See the header.
    const { data: begun, error: beginError } = await ctx.admin
        .rpc("signer_ai_message_begin", {
            p_token_id: ctx.tokenId,
            p_question: question,
            p_ip: ctx.ip,
        })
        .maybeSingle<Rpc_SignerAiMessageBegin>();

    if (beginError || !begun) {
        console.error("signer_ai_message_begin failed:", beginError);
        throw new SignerAuthError(500, "Internal error");
    }

    switch (begun.status) {
        case "ok":
            break;
        case "invalid_token":
            // Identical to every other dead-credential answer, so this endpoint
            // is not an oracle for which links are still live.
            throw new SignerAuthError(401, "This signing link is no longer valid.");
        case "disabled":
            throw new SignerAuthError(403, "The document assistant is turned off for this sender.");
        case "cooldown":
            return jsonResponse(
                {
                    error: "Just a moment — you can ask again shortly.",
                    retry_after_seconds: begun.retry_after_seconds ?? 5,
                },
                429
            );
        case "rate_limited":
            return jsonResponse(
                {
                    error: "You've asked a lot of questions in a short time. Try again in a while.",
                    retry_after_seconds: begun.retry_after_seconds ?? 3600,
                },
                429
            );
        case "turn_limit":
            return jsonResponse(
                {
                    error:
                        "You've reached the limit of questions for this document. " +
                        "For anything else, contact whoever sent it to you.",
                    turns_remaining: 0,
                },
                429
            );
        // IDENTICAL TEXT AND IDENTICAL STATUS, deliberately. Distinguishing them
        // would tell an anonymous caller whether ANOTHER TENANT'S usage is what
        // stopped them — a usage-volume side channel across organizations.
        case "org_quota":
        case "global_quota":
            return jsonResponse(
                { error: "The document assistant is busy right now. Please try again later." },
                503
            );
        default:
            console.error("signer_ai_message_begin returned unknown status:", begun.status);
            throw new SignerAuthError(500, "Internal error");
    }

    const messageId = begun.message_id!;

    /** Give the turn and both counters back. Idempotent on the SQL side. */
    const refund = async (reason: string) => {
        const { error } = await ctx.admin.rpc("signer_ai_message_fail", {
            p_message_id: messageId,
            p_reason: reason.slice(0, 200),
        });
        if (error) console.error("signer_ai_message_fail failed:", error);
    };

    try {
        // ---- Document context: extracted once per envelope, reused by every
        // question from every signer on it.
        const context = await ensureDocumentContext(ctx);

        if (context.extraction_status !== "ready") {
            // An honest refusal, and the turn handed back — the signer did
            // nothing wrong and a scan is not their fault.
            await refund(`no_context:${context.extraction_status}`);
            return jsonResponse(
                {
                    status: "refused",
                    answer: NO_CONTEXT_ANSWER,
                    bullets: [],
                    citations: [],
                    grounded: false,
                    refusal_reason: "no_context",
                    turns_remaining: begun.turns_remaining ?? 0,
                    disclaimer: DISCLAIMER,
                },
                200
            );
        }

        const history = await loadHistory(ctx, begun.session_id!);
        const nonce = mintNonce();
        const built = buildAskRequest({
            title: ctx.request.title,
            documentText: context.document_text,
            pages: context.pages,
            fields: describeFields(ctx),
            entries: describeEntries(ctx),
            question,
            nonce,
        });

        const driver = await getAiDriver();
        const result = await driver.ask({
            systemInstruction: built.systemInstruction,
            prompt: built.prompt,
            history,
            signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
        });

        if (!result.ok) {
            return await handleDriverFailure(ctx, result, refund, driver.model, messageId, begun);
        }

        const verified = verifyAnswer(
            result.text,
            context.document_text,
            context.pages,
            built.includedPages,
            nonce
        );

        if (verified.leaked) {
            // Not a bad answer — evidence of a successful extraction attempt
            // against the system instruction. Loud, because it means somebody is
            // working on this envelope's PDF rather than reading it.
            console.error(
                `signing_ai_ask: canary tripped on request ${ctx.request.id} ` +
                    `(signer ${ctx.signer.id}) — answer discarded.`
            );
        }

        const { error: completeError } = await ctx.admin.rpc("signer_ai_message_complete", {
            p_message_id: messageId,
            p_status: verified.status,
            p_answer: verified.answer,
            p_citations: verified.citations,
            p_grounded: verified.grounded,
            p_refusal_reason: verified.refusalReason,
            p_model: driver.model,
        });
        if (completeError) console.error("signer_ai_message_complete failed:", completeError);

        // ONE EVENT PER TOKEN, on the first question only — the
        // `signer_token_redeemed` first-use idiom. No question text, no answer
        // text; see the migration's PHASE 7.
        if (begun.turn_index === 1) {
            await logSignerEvent(ctx, "signer_ai_question_asked", {
                session_id: begun.session_id,
                grounding_mode: built.groundingMode,
                context_sha256: context.context_sha256,
                model: driver.model,
            });
        }

        return jsonResponse(
            {
                status: verified.status,
                answer: verified.answer,
                bullets: verified.bullets,
                citations: verified.citations,
                grounded: verified.grounded,
                refusal_reason: verified.refusalReason,
                turns_remaining: begun.turns_remaining ?? 0,
                // A SERVER CONSTANT on every response. The one sentence that
                // must never go missing is not left to the client to remember.
                disclaimer: DISCLAIMER,
            },
            200
        );
    } catch (err) {
        // Anything between the charge and the answer. The signer keeps their
        // turn; the operator gets the reason.
        await refund("exception");
        throw err;
    }
});

/**
 * Turns a driver failure into the right HTTP answer AND the right accounting.
 *
 * The distinction that matters: a call that never produced anything is refunded,
 * and a call the upstream really served — a safety block — is charged. Getting
 * this backwards either punishes signers for our outages or gives away free
 * requests on a shared quota.
 */
async function handleDriverFailure(
    ctx: Awaited<ReturnType<typeof resolveSignerToken>>,
    result: Extract<
        Awaited<ReturnType<Awaited<ReturnType<typeof getAiDriver>>["ask"]>>,
        { ok: false }
    >,
    refund: (reason: string) => Promise<void>,
    model: string,
    messageId: string,
    begun: Rpc_SignerAiMessageBegin
): Promise<Response> {
    if (result.reason === "safety") {
        // CHARGED: the request reached the model and spent upstream quota.
        // Answered as a normal 200 rather than an error, because to the signer
        // this is the assistant declining, not the product breaking.
        const { error } = await ctx.admin.rpc("signer_ai_message_complete", {
            p_message_id: messageId,
            p_status: "blocked",
            p_answer: SAFETY_ANSWER,
            p_citations: [],
            p_grounded: false,
            p_refusal_reason: "safety",
            p_model: model,
        });
        if (error) console.error("signer_ai_message_complete failed:", error);

        return jsonResponse(
            {
                status: "refused",
                answer: SAFETY_ANSWER,
                bullets: [],
                citations: [],
                grounded: false,
                refusal_reason: "safety",
                turns_remaining: begun.turns_remaining ?? 0,
                disclaimer: DISCLAIMER,
            },
            200
        );
    }

    await refund(result.reason);

    if (result.reason === "config") {
        // OUR fault: a bad key, a disabled API, a model name that does not
        // exist. Loud in the log, opaque to the signer.
        console.error(`signing_ai_ask: AI configuration fault — ${result.detail}`);
        throw new SignerAuthError(500, "Internal error");
    }
    if (result.detail) console.warn(`signing_ai_ask: ${result.reason} — ${result.detail}`);

    if (result.reason === "rate_limited") {
        // OUR daily caps are set below the upstream's precisely so this branch
        // stays unreached. Arriving here means the caps need revisiting.
        console.warn("signing_ai_ask: upstream rate limit reached despite local caps.");
        return jsonResponse(
            {
                error: "The document assistant is busy right now. Please try again in a moment.",
                retry_after_seconds: result.retryAfterSeconds ?? 60,
            },
            503
        );
    }
    if (result.reason === "timeout") {
        return jsonResponse({ error: "That took too long. Please try asking again." }, 504);
    }

    return jsonResponse(
        { error: "The document assistant is unavailable right now. Please try again." },
        502
    );
}

/**
 * Reads the cached extraction, or produces it.
 *
 * `source_pdf_sha256` IS THE INVALIDATION KEY. A cached row whose hash no longer
 * matches the request's is about a document nobody is being shown, and answering
 * from it would be the most convincing kind of wrong. Re-extract instead.
 */
async function ensureDocumentContext(
    ctx: Awaited<ReturnType<typeof resolveSignerToken>>
): Promise<ContextRow> {
    const { data: cached } = await ctx.admin
        .from("signer_ai_document_context")
        .select("id, document_text, pages, source_pdf_sha256, context_sha256, extraction_status")
        .eq("request_id", ctx.request.id)
        .maybeSingle<ContextRow>();

    if (cached && cached.source_pdf_sha256 === ctx.request.source_pdf_sha256) {
        return cached;
    }

    const snapshot = (ctx.request.template_snapshot ?? {}) as Snapshot;
    const pdfKey = snapshot.pdf_file_path || ctx.request.source_pdf_r2_key;
    const bytes = await getStorageDriver().getObject(pdfKey);
    const extracted = await extractDocumentText(bytes);

    const contextSha =
        extracted.status === "ready"
            ? await sha256Bytes(new TextEncoder().encode(extracted.documentText))
            : null;

    const row = {
        request_id: ctx.request.id,
        document_text: extracted.documentText,
        pages: extracted.pages,
        char_count: extracted.charCount,
        page_count: extracted.pageCount,
        context_sha256: contextSha,
        source_pdf_sha256: ctx.request.source_pdf_sha256,
        extraction_method: "pdf_text",
        extraction_status: extracted.status,
        extraction_error: extracted.error ?? null,
    };

    // Upsert on request_id: two signers opening the panel at the same moment
    // both extract, and the second simply overwrites the first with the same
    // bytes. Cheaper than a lock on a path that runs once per envelope.
    const { error } = await ctx.admin
        .from("signer_ai_document_context")
        .upsert(row, { onConflict: "request_id" });
    if (error) console.error("Failed to cache document context:", error);

    return {
        id: cached?.id ?? "",
        document_text: extracted.documentText,
        pages: extracted.pages,
        source_pdf_sha256: ctx.request.source_pdf_sha256,
        context_sha256: contextSha,
        extraction_status: extracted.status,
    };
}

/** The last few ANSWERED exchanges, oldest first. Never from the client. */
async function loadHistory(
    ctx: Awaited<ReturnType<typeof resolveSignerToken>>,
    sessionId: string
): Promise<AiHistoryTurn[]> {
    const { data, error } = await ctx.admin
        .from("signer_ai_messages")
        .select("question, answer")
        .eq("session_id", sessionId)
        .in("status", ["answered", "refused"])
        .not("answer", "is", null)
        .order("turn_index", { ascending: false })
        .limit(HISTORY_TURNS);

    if (error) {
        // A missing history costs context, not correctness. The document is
        // still in the prompt and every quote is still verified.
        console.error("Failed to load assistant history:", error);
        return [];
    }

    return (data ?? [])
        .reverse()
        .map((row) => ({ question: row.question as string, answer: (row.answer ?? "") as string }));
}

/**
 * The fields this person is being asked to complete.
 *
 * WHY THEY EARN A PLACE IN THE PROMPT: "what am I actually being asked to fill
 * in here?" is a large fraction of real signer confusion, and it is a question
 * the document text alone cannot answer — the boxes are an overlay.
 *
 * LABELS ONLY, and untrusted: they were authored by the sender.
 */
function describeFields(ctx: Awaited<ReturnType<typeof resolveSignerToken>>): AiFieldDescriptor[] {
    const snapshot = (ctx.request.template_snapshot ?? {}) as Snapshot;
    const layout = Array.isArray(snapshot.layout) ? snapshot.layout : [];

    return layout
        .filter((field) => field.role_id === ctx.signer.role_id)
        .map((field) => ({
            label: field.label,
            type: field.type,
            page: field.page,
            required: !!field.required,
        }));
}

/**
 * What has already been entered, keyed by LABEL rather than by field id — a
 * field id means nothing to a model and nothing to the reader it is answering.
 *
 * Values are contract data authored outside this repo, so they are fenced with
 * everything else. They are included because a question like "is my address
 * right?" is unanswerable without them.
 */
function describeEntries(
    ctx: Awaited<ReturnType<typeof resolveSignerToken>>
): Record<string, string> {
    const snapshot = (ctx.request.template_snapshot ?? {}) as Snapshot;
    const layout = Array.isArray(snapshot.layout) ? snapshot.layout : [];
    const values: Record<string, unknown> = {
        ...((ctx.request.prefilled_values ?? {}) as Record<string, unknown>),
        ...((ctx.signer.field_values ?? {}) as Record<string, unknown>),
    };

    const entries: Record<string, string> = {};
    for (const field of layout) {
        const value = values[field.id];
        if (value === undefined || value === null || value === "") continue;
        // Signature marks are image data. There is nothing to say about them and
        // a base64 blob in a prompt is pure waste.
        if (field.type === "signature") continue;
        entries[field.label] = String(value).slice(0, 200);
    }
    return entries;
}
