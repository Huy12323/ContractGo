import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

export type UseM_Signing_LinkForMe_Body = {
    request_id: string;
};

/**
 * Where the server decided this person should be sent.
 *
 * A DISCRIMINATED UNION, because the two destinations have nothing in common:
 * one is a minted credential for another surface, the other is a route this app
 * already owns. Collapsing them into one optional-everything object would put
 * the "which is it" test on every reader.
 */
export type UseM_Signing_LinkForMe_Result =
    | {
          mode: "sign_link";
          /** Absolute, for the deployment where the signer portal is its own origin. */
          url: string;
          /** `/sign/<token>` — what the in-app router navigates to. */
          path: string;
          expires_at: string;
          purpose: "sign" | "view";
      }
    | {
          /**
           * The caller has already signed (or declined, or the document has
           * ended) AND is a member of the sending organization, so the document
           * detail page is open to them and is strictly better than a read-only
           * signing surface. No token was minted.
           */
          mode: "in_app";
          organization_id: string;
          request_id: string;
          /**
           * WHY there is nothing left for them to do — the sentence the caller
           * puts on screen when the navigation lands. The three cases are not
           * interchangeable: "you already signed this" is a receipt, "you
           * declined this" is a decision they may not remember making, and
           * `closed` covers a document that ended around them (completed,
           * expired, voided) while they still had something to do.
           */
          reason: "already_signed" | "declined" | "closed";
      };

/**
 * Opens a document addressed to the signed-in user, wherever it should open.
 *
 * The notification cannot carry a signing link — the plaintext token exists once,
 * in the mail (CG-005) — so this asks the server to mint the caller their own,
 * proving who they are with a session rather than with a forwarded URL. For a
 * party who has already signed and belongs to the sending organization it mints
 * nothing and names the in-app route instead; see the edge function's header.
 *
 * NO SUCCESS TOAST HERE. The user is navigating; a message congratulating them
 * on it is read by nobody. Failures DO speak, because they are the whole point:
 * "it is not your turn yet" is the answer the button exists to surface. The
 * `in_app` branch also speaks — but that is the CALLER's toast, not this hook's,
 * because it explains a redirect the caller performed.
 */
export const useM_Signing_LinkForMe = () => {
    const mutation = useMutation({
        mutationKey: ["signing", "link-for-me"],
        mutationFn: async (body: UseM_Signing_LinkForMe_Body) => {
            const sb_FunctionsSigningLinkForMe_Invoke = await supabase.functions.invoke(
                "signing_link_for_me",
                { body }
            );
            if (sb_FunctionsSigningLinkForMe_Invoke.error) {
                throw await utils_Signing_UnwrapError(sb_FunctionsSigningLinkForMe_Invoke.error);
            }
            return sb_FunctionsSigningLinkForMe_Invoke.data as UseM_Signing_LinkForMe_Result;
        },
    });

    return { mutation };
};

/**
 * What the toast says when the server sends a party to the document page rather
 * than to the signing surface.
 *
 * Keyed by the server's `reason` so a new one fails the build here rather than
 * arriving as an undefined message. Every line is in the past tense and about
 * the READER: they clicked something asking for a signature, and the sentence
 * has to account for why no signature is being asked of them.
 *
 * Lives BESIDE the mutation rather than in one of its callers. It belongs to the
 * `in_app` branch of the result union above, and the two surfaces that handle
 * that branch — the notification row and the dashboard's "waiting on you" list —
 * must not explain the same server answer in two different sentences.
 */
export const const_LinkForMe_ReasonCopy: Record<
    Extract<UseM_Signing_LinkForMe_Result, { mode: "in_app" }>["reason"],
    string
> = {
    already_signed: "You have already signed this document.",
    declined: "You declined this document.",
    closed: "This document is closed — it is no longer awaiting your signature.",
};
