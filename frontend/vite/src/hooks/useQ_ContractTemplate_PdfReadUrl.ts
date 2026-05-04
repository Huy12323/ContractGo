import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

type ReadUrlResponse = {
    url: string;
    expiresAt: string;
};

const SIX_DAYS_MS = 6 * 24 * 3600 * 1000;

const fetchReadUrl = async (contractTemplateId: string): Promise<ReadUrlResponse> => {
    const sb_FunctionsFilesR2SignReadUrl_Invoke = await supabase.functions.invoke(
        "files_r2_sign-read-url",
        {
            body: {
                resource_type: "contract_template_pdf",
                contract_template_id: contractTemplateId,
            },
        },
    );
    if (sb_FunctionsFilesR2SignReadUrl_Invoke.error) {
        let serverMessage = "Failed to get PDF read URL";
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
 * Resolves a signed URL for a contract template's source PDF (PDF-kind templates only).
 * The PDF lives as a raw r2_key on `contract_templates.pdf_file_path` — no `files` row.
 * Re-fetches when the underlying r2_key changes via the `pdfFilePathKey` cache hint;
 * pass the `pdf_file_path` value to invalidate the cache cleanly when HR replaces the PDF.
 */
export const useQ_ContractTemplate_PdfReadUrl = ({
    contractTemplateId,
    pdfFilePathKey,
}: {
    contractTemplateId: string | null | undefined;
    /** The current `pdf_file_path` value on the template — used as a cache discriminator
     *  so a Replace-PDF flow refetches without manual invalidation. */
    pdfFilePathKey: string | null | undefined;
}) => {
    const query = useQuery({
        enabled: !!contractTemplateId && !!pdfFilePathKey,
        queryKey: [
            ...QueryKeys.contract_templates.record(contractTemplateId ?? ""),
            "pdf-read-url",
            { pdfFilePathKey },
        ],
        queryFn: () => fetchReadUrl(contractTemplateId as string),
        staleTime: SIX_DAYS_MS,
    });

    return {
        query,
        url: query.data?.url,
        expiresAt: query.data?.expiresAt,
    };
};
