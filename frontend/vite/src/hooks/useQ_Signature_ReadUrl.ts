import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

type ReadUrlResponse = {
    url: string;
    expiresAt: string;
};

/** The token is minted for seven days; refetching a day early keeps it well clear of expiry. */
const SIX_DAYS_MS = 6 * 24 * 3600 * 1000;

const fetchSignatureUrl = async (signatureId: string): Promise<ReadUrlResponse> => {
    const sb_FunctionsFilesR2SignReadUrl_Invoke = await supabase.functions.invoke(
        "files_r2_sign-read-url",
        {
            body: {
                resource_type: "user_signature",
                signature_id: signatureId,
            },
        }
    );
    if (sb_FunctionsFilesR2SignReadUrl_Invoke.error) {
        let serverMessage = "Failed to load signature";
        try {
            const ctx = (
                sb_FunctionsFilesR2SignReadUrl_Invoke.error as {
                    context?: { json?: () => Promise<{ error?: string }> };
                }
            ).context;
            const errBody = await ctx?.json?.();
            if (errBody?.error) serverMessage = errBody.error;
        } catch {
            /* fall back to generic message */
        }
        throw new Error(serverMessage);
    }
    return sb_FunctionsFilesR2SignReadUrl_Invoke.data as ReadUrlResponse;
};

/**
 * Shared so the signing picker can resolve a URL IMPERATIVELY — via
 * `queryClient.fetchQuery` when a card is clicked — and land in the same cache
 * entry the `<img>` already populated. Two shapes of the same request with
 * different keys would sign the same object twice per selection.
 */
export const Signature_ReadUrl_QueryOptions = (signatureId: string) => ({
    queryKey: [...QueryKeys.user_signatures.record(signatureId), "read-url"] as const,
    queryFn: () => fetchSignatureUrl(signatureId),
    staleTime: SIX_DAYS_MS,
});

/**
 * Resolves a signed URL for one saved signature image (CG-029).
 *
 * A signature CANNOT take the avatar shortcut of concatenating the Worker origin
 * onto its `r2_key`: that works only because the avatar namespace is served
 * without a token, and the signature namespace deliberately is not. So every
 * `<img>` that renders a saved signature resolves its URL through here.
 */
export const useQ_Signature_ReadUrl = ({
    signatureId,
}: {
    signatureId: string | null | undefined;
}) => {
    const query = useQuery({
        ...Signature_ReadUrl_QueryOptions(signatureId ?? ""),
        enabled: !!signatureId,
    });

    return { query, url: query.data?.url };
};
