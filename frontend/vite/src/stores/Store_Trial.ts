// A one-slot hand-off for a file dropped on the landing page (CG-052).
//
// WHY A STORE FOR ONE VALUE. The landing hero's card looks like a drop target,
// so it has to behave like one — a dashed box that only navigates is a small
// lie, and the visitor who drags a contract onto it and watches nothing happen
// is the one this feature most wanted to reach. But the drop happens on `/` and
// the file is needed on `/try`, which is a different route, so the value cannot
// live in either page's `useState`. A router search param cannot carry a `File`,
// and nothing else crosses that boundary.
//
// This is the ONLY cross-route state in the whole trial. Everything else is
// local `useState` in `Page_Trial`, deliberately.
//
// NEVER PERSISTED, and that is load-bearing rather than incidental. The trial's
// promise is that the document does not leave the browser, and a `File` cannot
// be serialized into `localStorage` anyway. This slot lives in memory for the
// duration of one navigation and is emptied the moment it is read.

import { Store, useStore } from "@tanstack/react-store";

class State_Trial {
    /** A validated PDF, waiting to be picked up by `/try`. */
    pendingFile: File | null = null;
}

export const Store_Trial = new Store(new State_Trial());

export const useStore_Trial_PendingFile = () => useStore(Store_Trial, (s) => s.pendingFile);

export const Store_Trial_Actions = {
    /**
     * Hands a file to the trial. The caller MUST have validated it first
     * (`utils_Pdf_ValidateTrialFile`) — the trial trusts what it takes from
     * here, so an unvalidated file would skip the magic-byte check and surface
     * as an unreadable-PDF error two steps later.
     */
    setPendingFile: (file: File) => Store_Trial.setState((s) => ({ ...s, pendingFile: file })),

    /**
     * Reads the slot WITHOUT clearing it.
     *
     * Deliberately split from `clearPendingFile` rather than offered as one
     * read-and-clear call, which is what this was first written as. The consumer
     * reads it from a `useState` lazy initialiser, and `React.StrictMode`
     * double-invokes those on mount (that is the whole point of StrictMode) — so
     * a read with a side effect returns the file on the first pass, `null` on
     * the second, and React keeps the second. The file would vanish in
     * development and survive in production, which is the worst possible split.
     *
     * Reading is pure; clearing belongs in an effect, where running twice is
     * harmless.
     */
    peekPendingFile: (): File | null => Store_Trial.state.pendingFile,

    /**
     * Empties the slot. Idempotent.
     *
     * A stale file here is a real bug, not untidiness: a visitor who drops a
     * document, finishes the trial and later returns to `/try` from the nav must
     * get an empty upload step, not the document they signed twenty minutes ago.
     */
    clearPendingFile: () => Store_Trial.setState((s) => ({ ...s, pendingFile: null })),
};
