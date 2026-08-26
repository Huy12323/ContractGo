import { useMutation } from "@tanstack/react-query";
import { useM_Files_Upload } from "@/hooks/useM_Files_Upload";

export type UseM_Template_UploadPdf_Body = {
    templateId: string;
    file: File;
};

/**
 * Uploads a template's source PDF to R2 and returns its r2_key.
 *
 * A thin scope over `useM_Files_Upload` so the builder never names a
 * `resource_type` — that string is the edge function's contract and is re-keyed
 * in Phase G. It does NOT write `pdf_file_path`: the caller folds the returned key
 * into its single save UPDATE (`useM_Template_SaveLayout`) so uploading a PDF and
 * saving the layout it was placed against stay one version row.
 *
 * The R2 path is scoped to the template id, so the row must exist before the
 * upload runs — the builder creates the row first, then uploads.
 *
 * No `onError` here on purpose: the wrapped mutation already surfaces the failure
 * message, and a second handler would toast the same error twice.
 */
export const useM_Template_UploadPdf = () => {
    const mFilesUpload = useM_Files_Upload();

    const mutation = useMutation({
        mutationKey: ["templates", "uploadPdf"],
        mutationFn: async ({ templateId, file }: UseM_Template_UploadPdf_Body) => {
            const result = await mFilesUpload.mutation.mutateAsync({
                resource_type: "contract_template_pdf",
                contract_template_id: templateId,
                file,
            });
            return { r2_key: result.r2_key };
        },
    });

    return { mutation };
};
