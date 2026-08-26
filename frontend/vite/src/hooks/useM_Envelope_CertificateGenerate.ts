import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Envelope_CertificateGenerate_Body = {
    organization_id: string;
    envelope_id: string;
};

export type UseM_Envelope_CertificateGenerate_Result = {
    /**
     * False when the stored certificate was still current and was returned
     * unchanged. The server decides this by comparing the recorded commitment
     * against the chain's last substantive entry — the client never re-judges it.
     */
    regenerated: boolean;
    certificate_sha256: string | null;
    generated_at: string | null;
    events_seq: number | null;
    chain_intact: boolean | null;
};

/**
 * Issues (or re-issues) the Certificate of Completion.
 *
 * A MUTATION, and for `useM_Envelope_DownloadSigned`'s reason rather than by
 * analogy: the call WRITES. It stores a PDF, updates six columns and — when it
 * actually regenerates — appends `certificate_generated` to the hash chain. A
 * query would refire all of that on every cache revalidation and window focus,
 * manufacturing entries in an append-only log that cannot be corrected.
 *
 * It is separate from fetching the certificate's URL, which stays a query
 * (`useQ_Envelope_DocumentUrl` with `variant: "certificate"`) because that call
 * deliberately writes nothing. Same split, same reasoning, as
 * `envelopes_download-signed` versus `envelopes_document-url`.
 */
export const useM_Envelope_CertificateGenerate = () => {
    const { message } = App.useApp();
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationKey: ["envelopes", "certificate-generate"],
        mutationFn: async (body: UseM_Envelope_CertificateGenerate_Body) => {
            const sb_FunctionsEnvelopesCertificateGenerate_Invoke = await supabase.functions.invoke(
                "envelopes_certificate_generate",
                { body }
            );
            if (sb_FunctionsEnvelopesCertificateGenerate_Invoke.error) {
                throw await utils_Signing_UnwrapError(
                    sb_FunctionsEnvelopesCertificateGenerate_Invoke.error
                );
            }
            return sb_FunctionsEnvelopesCertificateGenerate_Invoke.data as UseM_Envelope_CertificateGenerate_Result;
        },
        onSuccess: (result, body) => {
            // Two invalidations, and both are needed for different reasons —
            // the hybrid policy means realtime is additive, never a substitute.
            //
            // The request row carries the six `certificate_*` columns the detail
            // page renders. `signature_requests` DOES have a realtime trigger,
            // but relying on it here would make the button's own result arrive
            // by a slower path than the button's response did.
            queryClient.invalidateQueries({ queryKey: QueryKeys.signature_requests.all() });

            // The trail gained a `certificate_generated` entry — but ONLY when
            // the server actually regenerated. `signature_audit_log` has no
            // realtime trigger (deliberately: it is chatty), so local
            // invalidation is the only path, and firing it on a cached response
            // would refetch a trail that did not move.
            if (result.regenerated) {
                queryClient.invalidateQueries({ queryKey: QueryKeys.signature_audit_log.all() });
            }

            // The stored URL is keyed by variant and now points at different
            // bytes. Without this, pressing the button after a request-changes
            // loop would hand back the previous certificate from cache.
            queryClient.invalidateQueries({
                queryKey: QueryKeys.signature_requests.record(body.envelope_id),
            });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to issue the certificate");
        },
    });

    return { mutation };
};
