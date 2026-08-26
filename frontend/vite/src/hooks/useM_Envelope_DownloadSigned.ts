import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Envelope_DownloadSigned_Body = {
    organization_id: string;
    envelope_id: string;
};

export type UseM_Envelope_DownloadSigned_Result = {
    url: string;
    expires_in: number;
    signed_pdf_sha256: string | null;
};

/**
 * Resolves a short-lived URL for the completed document.
 *
 * A MUTATION rather than a query, despite reading: the call is a recorded event
 * — `envelopes_download-signed` appends to the audit chain, because who took a
 * copy of a signed document and when is part of the record — and a query would
 * refire that event on every cache revalidation and window focus.
 *
 * The URL expires in minutes, so it is never cached either.
 */
export const useM_Envelope_DownloadSigned = () => {
    const { message } = App.useApp();
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationKey: ["envelopes", "download-signed"],
        mutationFn: async (body: UseM_Envelope_DownloadSigned_Body) => {
            const sb_FunctionsEnvelopesDownloadSigned_Invoke = await supabase.functions.invoke(
                "envelopes_download-signed",
                { body }
            );
            if (sb_FunctionsEnvelopesDownloadSigned_Invoke.error) {
                throw await utils_Signing_UnwrapError(
                    sb_FunctionsEnvelopesDownloadSigned_Invoke.error
                );
            }
            return sb_FunctionsEnvelopesDownloadSigned_Invoke.data as UseM_Envelope_DownloadSigned_Result;
        },
        onSuccess: (result) => {
            // The download WRITES: `envelopes_download-signed` appends
            // `integrity_verified` to the chain, as the doc comment above says.
            // Without this the timeline rendered beside the button never shows
            // the entry the button just created — and unlike the envelope tables
            // there is no realtime trigger on `signature_audit_log` to cover for
            // a missing invalidation, deliberately (it would be chatty, and the
            // rest of the UI derives from recipient status). Local invalidation
            // is the only path here, which is the hybrid policy's point.
            queryClient.invalidateQueries({ queryKey: QueryKeys.signature_audit_log.all() });

            // Opened rather than assigned to `location`: the signed PDF is the
            // artifact the user came for, and navigating away from the detail
            // page to reach it would lose the hash shown beside it.
            window.open(result.url, "_blank", "noopener,noreferrer");
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to prepare the download");
        },
    });

    return { mutation };
};
