import { Store, useStore } from "@tanstack/react-store";
import type { Signing_Ask_Citation } from "@/hooks/useM_Signing_Ask";

/**
 * The signer assistant's transcript and open/closed state — CG-049.
 *
 * A STORE RATHER THAN COMPONENT STATE, because two mount points (the wide rail
 * and the drawer) must read one thread, and because component state dies on a
 * reload — and the emailed-link flow reloads constantly, on a phone especially.
 *
 * AND NOT THE QUERY CACHE. A transcript is not a server resource: there is no
 * key to invalidate, nothing to refetch, and `setQueryData` on a fabricated key
 * is the cache being used as a mutable global with extra steps.
 *
 * PERSISTED TO `sessionStorage`, NOT `localStorage`. The transcript quotes
 * clauses out of a contract and must not outlive the tab on a shared or borrowed
 * browser — the same reasoning `configs/auth/oauthRedirect.ts` already applies.
 *
 * THE KEY IS FIXED AND THE TOKEN IS NOT IN IT. Keying by access token would put
 * a live bearer credential into storage under a name anything can enumerate.
 * Instead the payload carries the last six characters of the token, and a
 * mismatch DISCARDS the stored thread — so signer A's questions can never
 * surface for signer B in the same tab, without a credential ever being written.
 */

export type SigningAssistant_Turn = {
    id: string;
    question: string;
    /** `pending` renders a skeleton in the answer bubble; the question stays up. */
    state: "pending" | "ok" | "error";
    answer?: string;
    bullets?: string[];
    citations?: Signing_Ask_Citation[];
    /** False renders the muted "not found in this document" treatment. */
    grounded?: boolean;
    /** The server's sentence, shown in place of an answer. */
    error?: string;
};

const STORAGE_KEY = "cg_signing_assistant";

/**
 * Twenty exchanges is well past the thirty-question server cap's useful span and
 * bounds what a hostile response can grow the payload to. Storage is a courtesy,
 * not a record — the server holds the real transcript.
 */
const MAX_TURNS = 20;

class State_SigningAssistant {
    open: boolean = false;
    turns: SigningAssistant_Turn[] = [];
    /** Server-reported, so the composer can say how many questions are left. */
    turnsRemaining: number | null = null;
    /** Seconds until the composer re-enables. Owned by the panel's interval. */
    cooldown: number = 0;
    /** Set on a 401: the link can no longer be used to ask. Never navigates. */
    disabled: boolean = false;
    /** Last six characters of the access token this thread belongs to. */
    tokenTail: string = "";
}

/**
 * EVERY read and write is wrapped, and this is not defensive padding: Safari in
 * private mode throws on `sessionStorage` access, and a courtesy feature must
 * never be able to break the signing surface. A failed persist costs a
 * transcript; an uncaught throw costs a signature.
 */
const readStored = (tokenTail: string): Partial<State_SigningAssistant> | null => {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<State_SigningAssistant>;
        if (parsed.tokenTail !== tokenTail) return null;
        return {
            turns: Array.isArray(parsed.turns) ? parsed.turns.slice(-MAX_TURNS) : [],
            turnsRemaining:
                typeof parsed.turnsRemaining === "number" ? parsed.turnsRemaining : null,
        };
    } catch {
        return null;
    }
};

const writeStored = (state: State_SigningAssistant) => {
    try {
        // NOTHING TO KEEP MEANS NOTHING STORED, not an empty shell. The
        // subscriber fires on every setState including `clear`'s reset, so
        // without this the key is removed and immediately rewritten — leaving a
        // record on a shared browser saying a conversation happened here.
        if (!state.tokenTail || state.turns.length === 0) {
            sessionStorage.removeItem(STORAGE_KEY);
            return;
        }
        sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                tokenTail: state.tokenTail,
                turns: state.turns.slice(-MAX_TURNS),
                turnsRemaining: state.turnsRemaining,
            })
        );
    } catch {
        // Full, or blocked. The thread stays in memory for this page load.
    }
};

export const Store_SigningAssistant = new Store(new State_SigningAssistant());

Store_SigningAssistant.subscribe(() => writeStored(Store_SigningAssistant.state));

// Selectors
export const useStore_SigningAssistant_Open = () => useStore(Store_SigningAssistant, (s) => s.open);
export const useStore_SigningAssistant_Turns = () =>
    useStore(Store_SigningAssistant, (s) => s.turns);
export const useStore_SigningAssistant_TurnsRemaining = () =>
    useStore(Store_SigningAssistant, (s) => s.turnsRemaining);
export const useStore_SigningAssistant_Cooldown = () =>
    useStore(Store_SigningAssistant, (s) => s.cooldown);
export const useStore_SigningAssistant_Disabled = () =>
    useStore(Store_SigningAssistant, (s) => s.disabled);

// Actions
export const Store_SigningAssistant_Actions = {
    /**
     * Called once per ceremony with the token this thread belongs to. Rehydrates
     * a matching thread and discards a foreign one — see the header.
     */
    hydrate: (accessToken: string) => {
        const tokenTail = accessToken.slice(-6);
        const stored = readStored(tokenTail);
        Store_SigningAssistant.setState((s) => ({
            ...s,
            tokenTail,
            turns: stored?.turns ?? [],
            turnsRemaining: stored?.turnsRemaining ?? null,
            // Never restored: both are momentary server verdicts, and reviving a
            // stale one would disable a composer the server would now accept.
            cooldown: 0,
            disabled: false,
        }));
    },

    setOpen: (open: boolean) => Store_SigningAssistant.setState((s) => ({ ...s, open })),
    toggle: () => Store_SigningAssistant.setState((s) => ({ ...s, open: !s.open })),

    askStart: (id: string, question: string) =>
        Store_SigningAssistant.setState((s) => ({
            ...s,
            turns: [...s.turns, { id, question, state: "pending" } as SigningAssistant_Turn].slice(
                -MAX_TURNS
            ),
        })),

    askResolve: (id: string, patch: Omit<SigningAssistant_Turn, "id" | "question">) =>
        Store_SigningAssistant.setState((s) => ({
            ...s,
            turns: s.turns.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)),
        })),

    setTurnsRemaining: (turnsRemaining: number | null) =>
        Store_SigningAssistant.setState((s) => ({ ...s, turnsRemaining })),

    setCooldown: (cooldown: number) => Store_SigningAssistant.setState((s) => ({ ...s, cooldown })),

    tickCooldown: () =>
        Store_SigningAssistant.setState((s) => ({ ...s, cooldown: Math.max(s.cooldown - 1, 0) })),

    setDisabled: (disabled: boolean) =>
        Store_SigningAssistant.setState((s) => ({ ...s, disabled })),

    /**
     * Called on a successful submit and on a decline. The ceremony is over and
     * the questions that led to it are the signer's own business — leaving them
     * in a shared browser's tab is the one avoidable disclosure this feature has.
     */
    clear: () => {
        try {
            sessionStorage.removeItem(STORAGE_KEY);
        } catch {
            // Nothing to do; the reset below still empties the live state.
        }
        Store_SigningAssistant.setState(() => new State_SigningAssistant());
    },
};
