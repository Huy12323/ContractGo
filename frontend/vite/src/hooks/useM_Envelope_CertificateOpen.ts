import { useMutation } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";
import {
    useM_Envelope_CertificateGenerate,
    type UseM_Envelope_CertificateGenerate_Body,
} from "@/hooks/useM_Envelope_CertificateGenerate";

/**
 * Issue the certificate, then open it. The whole gesture, from the caller's side.
 *
 * The two SERVER endpoints stay separate on purpose — `envelopes_certificate_generate`
 * writes (it stores the PDF, updates the row, may append to the chain) and
 * `envelopes_document-url` deliberately writes nothing, so returning a URL from
 * the write endpoint would have made every re-download a new audit entry. But
 * every CALLER wants both, in that order, and duplicating the sequence at each
 * call site is how the detail page and the archive end up disagreeing about what
 * pressing "Certificate" does.
 *
 * The URL is fetched with a direct `functions.invoke` rather than through
 * `useQ_Envelope_DocumentUrl`: that hook is a query keyed by envelope, which is
 * the right shape for the viewer pane and the wrong one inside a table row, where
 * the envelope is not known until the button is pressed.
 *
 * It never caches the URL. These expire in minutes, and a stale one opens a blank
 * tab — which reads as "the certificate is broken" rather than "that link aged
 * out".
 */
export const useM_Envelope_CertificateOpen = () => {
    const { message } = App.useApp();
    const mGenerate = useM_Envelope_CertificateGenerate();

    const mutation = useMutation({
        mutationKey: ["envelopes", "certificate-open"],
        mutationFn: async (body: UseM_Envelope_CertificateGenerate_Body) => {
            // Generate first, always. It is idempotent on the audit chain, so a
            // certificate that is still current costs one round trip and no
            // rewrite — and one that has gone stale is silently refreshed rather
            // than handing someone a summary that disagrees with the trail.
            await mGenerate.mutation.mutateAsync(body);

            const sb_FunctionsEnvelopesDocumentUrl_Invoke = await supabase.functions.invoke(
                "envelopes_document-url",
                { body: { ...body, variant: "certificate" } }
            );
            if (sb_FunctionsEnvelopesDocumentUrl_Invoke.error) {
                throw await utils_Signing_UnwrapError(
                    sb_FunctionsEnvelopesDocumentUrl_Invoke.error
                );
            }
            return sb_FunctionsEnvelopesDocumentUrl_Invoke.data as { url: string };
        },
        onSuccess: (result) => {
            // Opened rather than assigned to `location`, matching the signed
            // download: navigating away from the detail page would lose the
            // hashes shown beside the button.
            if (result?.url) window.open(result.url, "_blank", "noopener,noreferrer");
        },
        onError: (err: Error) => {
            // `useM_Envelope_CertificateGenerate` surfaces its own failures, so
            // this only speaks for the URL half — otherwise a failed generate
            // would stack two toasts for one press.
            if (mGenerate.mutation.isError) return;
            console.error(err);
            message.error(err.message || "Failed to open the certificate");
        },
    });

    return { mutation };
};
