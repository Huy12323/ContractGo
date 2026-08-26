import { useMutation } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_AuthHeaders, utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

export type UseM_Signing_DownloadCopy_Body = {
    /**
     * The short-lived `view` credential `signing_submit` returned, or — for a
     * party returning later through `signing_link_for_me` — the token their link
     * already carries. NOT the token they signed with: that one is consumed the
     * moment the signature lands.
     */
    access_token: string;
    /** Names the saved file. */
    title: string;
};

/**
 * Take a copy of the document this signer just signed.
 *
 * A SAVED FILE, not a new tab. Every other document action in the app opens a
 * signed R2 URL with `window.open`, and that is right for a sender standing on a
 * page they can come back to. This is the opposite situation: the signer is about
 * to close the tab, the link dies with it, and "opened in a viewer" is exactly
 * the outcome that leaves them with nothing. `signing_document_download` returns
 * the bytes rather than a URL for the same reason — see its header.
 *
 * The object URL is revoked on the next frame; leaving it alive pins the whole
 * PDF in memory for the life of the tab. Same idiom as the audit-trail export.
 */
export const useM_Signing_DownloadCopy = () => {
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_Signing_DownloadCopy_Body) => {
            const sb_FunctionsSigningDocumentDownload_Invoke = await supabase.functions.invoke(
                "signing_document_download",
                {
                    body: { access_token: body.access_token },
                    headers: await utils_Signing_AuthHeaders(),
                }
            );
            if (sb_FunctionsSigningDocumentDownload_Invoke.error) {
                throw await utils_Signing_UnwrapError(
                    sb_FunctionsSigningDocumentDownload_Invoke.error
                );
            }

            // `functions.invoke` hands back a Blob for `application/pdf`, which is
            // what the function sets. Re-wrapped with an explicit type anyway: a
            // Blob whose type is empty saves as `.pdf` with no handler on some
            // platforms, and the cost of being sure is one allocation.
            const blob = new Blob([sb_FunctionsSigningDocumentDownload_Invoke.data as BlobPart], {
                type: "application/pdf",
            });

            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = utils_Signing_CopyFilename(body.title);
            anchor.click();
            requestAnimationFrame(() => URL.revokeObjectURL(url));
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Could not download a copy of this document");
        },
    });

    return { mutation };
};

/**
 * A filename a signer will recognise months later, derived from the document's
 * own title.
 *
 * Stripped rather than escaped: `/`, `\` and `:` are path syntax on one platform
 * or another, and a browser that sanitises them itself does so inconsistently —
 * one turns them into underscores, another silently drops everything before the
 * last slash and saves a file named after the tail of the title. Collapsing them
 * here means the name is decided once, by us.
 */
export const utils_Signing_CopyFilename = (title: string): string => {
    const safe = Array.from(title)
        // Control characters are legal in a JS string and not in a filename.
        // Filtered by code point rather than matched with a regex: every way of
        // writing that range trips `no-control-regex`, and the rule is right that
        // a control character inside a pattern is nearly always a mistake.
        .filter((char) => {
            const code = char.charCodeAt(0);
            return code > 31 && code !== 127;
        })
        .join("")
        .replace(/[/\\:*?"<>|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        // Long titles exist; 120 chars leaves room for the extension inside the
        // 255-byte limit every mainstream filesystem shares.
        .slice(0, 120)
        // A trailing dot or space is stripped by Windows on save, which would
        // leave the extension looking doubled.
        .replace(/[. ]+$/, "");

    return `${safe || "Signed document"}.pdf`;
};
