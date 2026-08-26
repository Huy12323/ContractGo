import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

/**
 * Asks the document assistant one question — CG-049.
 *
 * NO AUTH HEADERS, for the same reason `useM_Signing_OtpSend` sends none: the
 * caller is a recipient who may have no account and never will, so the token in
 * the body is the whole credential. `signing_ai_ask` does not look at a session.
 *
 * NO QUERY INVALIDATION EITHER, and here the omission is stronger than it is on
 * the passcode hooks. A transcript is not a server resource this client caches —
 * it is a conversation the page is holding — so it lives in
 * `Store_SigningAssistant`. Refetching the signing session to see it would burn
 * a use of the signer's link to learn something the response already said.
 *
 * THE ACCESS TOKEN TRAVELS IN THE BODY, never a query string. Query strings leak
 * through `Referer` headers, server logs and mail-scanner prefetches.
 */
export type UseM_Signing_Ask_Body = {
    access_token: string;
    question: string;
};

export type Signing_Ask_Citation = {
    page: number;
    quote: string;
};

export type UseM_Signing_Ask_Result = {
    /**
     * `answered` — a grounded answer with at least one verified quote.
     * `refused`  — the assistant declined, or nothing survived verification.
     *
     * A REFUSAL IS A BRANCH, NOT A SUBSTRING MATCH. It arrives as a 200 with a
     * flag, so the panel never has to test whether an answer "looks like" a
     * refusal — which is what a prose-only contract would have forced.
     */
    status: "answered" | "refused";
    answer: string;
    bullets?: string[];
    /** Only quotes the SERVER verified against the document. Never model output
     *  taken on trust — see `_shared/aiPrompt.ts`. */
    citations?: Signing_Ask_Citation[];
    grounded?: boolean;
    refusal_reason?: string | null;
    turns_remaining?: number;
    /** A server constant on every response. Rendered, never suppressed. */
    disclaimer?: string;
};

export const useM_Signing_Ask = () => {
    const mutation = useMutation({
        mutationFn: async (body: UseM_Signing_Ask_Body) => {
            const sb_FunctionsSigningAiAsk_Invoke = await supabase.functions.invoke(
                "signing_ai_ask",
                { body }
            );
            if (sb_FunctionsSigningAiAsk_Invoke.error) {
                // A 429 cooldown and a 429 rate-limit both arrive here, each
                // carrying `retry_after_seconds`. The panel reads it off the
                // unwrapped error to seed a countdown beside the disabled
                // composer — being told to wait is a normal outcome, not a
                // failure, and it is unrenderable without that field. This is
                // exactly the silent-loss hazard `utils_Signing_UnwrapError`'s
                // header warns about: a structured field not copied across
                // there is gone with no type error and no throw.
                throw await utils_Signing_UnwrapError(sb_FunctionsSigningAiAsk_Invoke.error);
            }
            return sb_FunctionsSigningAiAsk_Invoke.data as UseM_Signing_Ask_Result;
        },
    });

    return { mutation };
};
