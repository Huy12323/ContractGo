import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button } from "antd";
import { GoogleOutlined } from "@ant-design/icons";
import { Store_Auth_Actions } from "@/stores/Store_Auth";
import { consumeOAuthRedirect, stashOAuthRedirect } from "@/configs/auth/oauthRedirect";
import { onOAuthTabFinish } from "@/configs/auth/oauthTab";

interface GoogleSignInButtonProps {
    /** Path to land on after the round trip. Same `?redirect=` the forms receive. */
    redirect?: string;
    label: string;
}

/** How often to check whether the user closed the consent tab without finishing. */
const ABANDONED_TAB_POLL_MS = 500;

/**
 * Shared by /login and /signup — Google draws no distinction between the two, so
 * neither does this: the same call creates the account or signs into the existing
 * one, and only the label differs.
 *
 * The consent screen opens in its OWN tab, so this page never navigates away. That
 * tab finishes the exchange, reports back through `configs/auth/oauthTab` and
 * closes; this component then hard-navigates into the app. Three things follow from
 * that and none of them are optional:
 *
 *  1. The tab is opened SYNCHRONOUSLY in the click handler, blank, before any
 *     `await`. A `window.open` on the far side of one is no longer attributable to
 *     the click and every popup blocker stops it.
 *  2. A blocked popup is not an error. `window.open` returns null and the flow
 *     degrades to the original same-tab redirect, which still works everywhere.
 *  3. Closing the tab is not an event anyone reports, so an abandoned sign-in is
 *     found by polling `.closed` — otherwise the button spins forever.
 */
export const App_GoogleSignInButton = ({ redirect, label }: GoogleSignInButtonProps) => {
    const [loading, setLoading] = useState(false);
    const { message: messageApi } = App.useApp();
    const authTabRef = useRef<Window | null>(null);
    const pollRef = useRef<number | null>(null);

    const stopWatchingTab = useCallback(() => {
        if (pollRef.current !== null) window.clearInterval(pollRef.current);
        pollRef.current = null;
        authTabRef.current = null;
    }, []);

    useEffect(() => {
        const unsubscribe = onOAuthTabFinish((status) => {
            stopWatchingTab();

            if (status === "success") {
                // A hard navigation, not the router: it re-initializes the supabase
                // client from localStorage, so this tab boots holding the session
                // the other tab just wrote instead of racing whatever it has in
                // memory. `signOut` navigates this way for the same reason.
                //
                // The destination is read HERE because it was stashed here — it
                // lives in this tab's sessionStorage, which the opened tab never
                // had access to.
                window.location.href = consumeOAuthRedirect() || "/";
                return;
            }

            stashOAuthRedirect(undefined);
            setLoading(false);
            if (status === "failed") {
                messageApi.error("Google sign-in did not complete. Please try again.");
            }
        });

        return () => {
            unsubscribe();
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
        };
    }, [messageApi, stopWatchingTab]);

    async function onClick() {
        setLoading(true);

        // Synchronous and blank — see (1) in the docblock. Pointed at Google by
        // `signInWithGoogle` once the provider URL exists.
        const authTab = window.open("", "_blank");
        authTabRef.current = authTab;

        try {
            await Store_Auth_Actions.signInWithGoogle(redirect, authTab);
        } catch (err) {
            authTab?.close();
            stopWatchingTab();
            setLoading(false);
            const msg = err instanceof Error ? err.message : "";
            messageApi.error(msg || "Could not start Google sign-in. Please try again.");
            return;
        }

        // Popup blocked: the flow fell back to navigating THIS tab, so there is
        // nothing to watch and the spinner stays up for the whole handoff — the
        // page is already leaving and an idle button would flash over it.
        if (!authTab) return;

        pollRef.current = window.setInterval(() => {
            if (!authTabRef.current?.closed) return;
            // Deliberately does NOT clear the stashed destination. A success posts
            // its message and closes the tab in the same breath, so this can win
            // the race and run against a sign-in that actually worked; dropping the
            // destination would then cost the user their landing page. Leaving it
            // is harmless — the next attempt overwrites it either way.
            stopWatchingTab();
            setLoading(false);
        }, ABANDONED_TAB_POLL_MS);
    }

    return (
        <Button block size="large" icon={<GoogleOutlined />} loading={loading} onClick={onClick}>
            {label}
        </Button>
    );
};
