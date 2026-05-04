import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

type ReadUrlResponse = {
    url: string;
    expiresAt: string;
};

const SIX_DAYS_MS = 6 * 24 * 3600 * 1000;

const fetchReadUrl = async (invitationId: string): Promise<ReadUrlResponse> => {
    const sb_FunctionsFilesR2SignReadUrl_Invoke = await supabase.functions.invoke(
        "files_r2_sign-read-url",
        {
            body: {
                resource_type: "invitation_pdf",
                invitation_id: invitationId,
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
 * Resolves a signed URL for an invitation's PDF (PDF-kind invitations only). The PDF lives
 * as a raw r2_key on `invitation.template_snapshot.pdf_file_path` — no `files` row.
 *
 * Dual-auth on the edge function: the invitee (email match against `invitation.employee_email`)
 * OR an org admin/owner can resolve. Same hook serves the employee filler (Page_OnboardingFiller),
 * the HR review modal (App_OnboardingReviewModal via `contract.invitation_id`), and any other
 * surface that needs to render an invitation's source PDF.
 *
 * Pass the snapshot's `pdf_file_path` value as `pdfFilePathKey` so the cache invalidates
 * cleanly if the underlying r2_key ever changes (rare — invitations are post-AHR-1487 immutable).
 */
export const useQ_Invitation_PdfReadUrl = ({
    invitationId,
    pdfFilePathKey,
}: {
    invitationId: string | null | undefined;
    /** The snapshot's `pdf_file_path` — used as a cache discriminator. */
    pdfFilePathKey: string | null | undefined;
}) => {
    const query = useQuery({
        enabled: !!invitationId && !!pdfFilePathKey,
        queryKey: [
            ...QueryKeys.onboarding_invitations.record(invitationId ?? ""),
            "pdf-read-url",
            { pdfFilePathKey },
        ],
        queryFn: () => fetchReadUrl(invitationId as string),
        staleTime: SIX_DAYS_MS,
    });

    return {
        query,
        url: query.data?.url,
        expiresAt: query.data?.expiresAt,
    };
};
