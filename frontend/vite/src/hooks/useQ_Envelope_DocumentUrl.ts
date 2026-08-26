import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";
import { QueryKeys } from "@/utils/query/queryKeys";

export type Envelope_DocumentUrl_Variant = "signed" | "source" | "certificate";

export type Envelope_DocumentUrl_Result = {
    url: string;
    /** Which PDF the server actually resolved — not necessarily what was asked for. */
    variant: Envelope_DocumentUrl_Variant;
    expires_in: number;
    signed_pdf_sha256: string | null;
    /** CG-043, present only on the `certificate` variant. */
    certificate_sha256?: string | null;
};

const TTL_SECONDS = 60 * 30;

/**
 * A viewable URL for the envelope's document.
 *
 * A QUERY, not a mutation — the exact inverse of the reasoning in
 * `useM_Envelope_DownloadSigned`. That one had to be a mutation because the call
 * WRITES (it mints an `integrity_verified` audit entry), so a background
 * revalidation would have forged download records. `envelopes_document-url`
 * deliberately writes nothing, which is the whole reason it exists as a separate
 * function, so re-fetching it is free and a query is the honest shape.
 *
 * `staleTime` sits just under the server's TTL so the cached URL is replaced
 * shortly before it expires rather than after. `refetchOnWindowFocus` is off
 * because re-signing on every alt-tab would churn the PDF viewer for no gain.
 */
export const useQ_Envelope_DocumentUrl = ({
    organizationId,
    envelopeId,
    variant,
}: {
    organizationId: string;
    envelopeId: string;
    variant?: Envelope_DocumentUrl_Variant;
}) => {
    const query = useQuery({
        enabled: !!organizationId && !!envelopeId,
        queryKey: [...QueryKeys.signature_requests.record(envelopeId), "document-url", { variant }],
        staleTime: (TTL_SECONDS - 300) * 1000,
        refetchOnWindowFocus: false,
        queryFn: async () => {
            const sb_FunctionsEnvelopesDocumentUrl_Invoke = await supabase.functions.invoke(
                "envelopes_document-url",
                { body: { organization_id: organizationId, envelope_id: envelopeId, variant } }
            );
            if (sb_FunctionsEnvelopesDocumentUrl_Invoke.error) {
                throw await utils_Signing_UnwrapError(
                    sb_FunctionsEnvelopesDocumentUrl_Invoke.error
                );
            }
            return sb_FunctionsEnvelopesDocumentUrl_Invoke.data as Envelope_DocumentUrl_Result;
        },
    });

    return { query, document: query.data ?? null };
};
