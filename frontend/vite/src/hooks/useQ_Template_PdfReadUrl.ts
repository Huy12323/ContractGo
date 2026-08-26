import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

// Renamed from `useQ_ContractTemplate_PdfReadUrl` in Phase F. The edge function's
// `resource_type` is still `contract_template_pdf` — that string is part of the
// deployed function's contract and is re-keyed to `template_pdf` in Phase G,
// together with the rest of the `files_r2_*` resource types.

type ReadUrlResponse = {
    url: string;
    expiresAt: string;
};

const SIX_DAYS_MS = 6 * 24 * 3600 * 1000;

const fetchReadUrl = async (templateId: string): Promise<ReadUrlResponse> => {
    const sb_FunctionsFilesR2SignReadUrl_Invoke = await supabase.functions.invoke(
        "files_r2_sign-read-url",
        {
            body: {
                resource_type: "contract_template_pdf",
                contract_template_id: templateId,
            },
        }
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
 * Resolves a signed URL for a template's source PDF.
 *
 * The PDF lives as a raw r2_key on `contract_templates.pdf_file_path` — no `files`
 * row. `pdfFilePathKey` is a cache discriminator, not a fetch argument: pass the
 * current `pdf_file_path` so a Replace-PDF save refetches without manual
 * invalidation, and pass null while an unsaved local file is being previewed.
 */
export const useQ_Template_PdfReadUrl = ({
    templateId,
    pdfFilePathKey,
}: {
    templateId: string | null | undefined;
    pdfFilePathKey: string | null | undefined;
}) => {
    const query = useQuery({
        enabled: !!templateId && !!pdfFilePathKey,
        queryKey: [
            ...QueryKeys.contract_templates.record(templateId ?? ""),
            "pdf-read-url",
            { pdfFilePathKey },
        ],
        queryFn: () => fetchReadUrl(templateId as string),
        staleTime: SIX_DAYS_MS,
    });

    return {
        query,
        url: query.data?.url,
        expiresAt: query.data?.expiresAt,
    };
};
