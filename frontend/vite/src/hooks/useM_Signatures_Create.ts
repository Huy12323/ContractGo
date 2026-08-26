import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { useStore_Auth_User } from "@/stores/Store_Auth";
import { useM_Files_Upload } from "@/hooks/useM_Files_Upload";
import { Utils_Signature_DataUrlToFile } from "@/utils/Utils_Signature_DataUrl";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { SignatureCapture_Method } from "@/components/signing/App_SignatureCapture";

export type UseM_Signatures_Create_Body = {
    /** PNG data URL, exactly as `App_SignatureCapture` emits it. */
    dataUrl: string;
    /** How the mark was made. Carried forward into the capture it later pre-fills. */
    capture_method: SignatureCapture_Method;
    name?: string | null;
    /**
     * Force this to become the default. When omitted the first signature in an
     * empty library becomes the default on its own — a library of one whose only
     * member is not the default would mean the signing screen preselects nothing.
     */
    makeDefault?: boolean;
};

/** Hex SHA-256 of the stored bytes, so a swapped or corrupted object is detectable. */
const sha256Hex = async (file: File): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
};

/**
 * Saves a signature to the library (CG-029).
 *
 * Order is upload-then-insert, matching `signing_submit`'s store-then-record
 * posture: a failed upload leaves no row, whereas a row inserted first could
 * outlive a failed PUT and render as a permanently broken image in the grid.
 * The reverse failure — object written, insert fails — leaves an orphan in R2,
 * which is cheap and invisible.
 *
 * THE DEFAULT IS NEVER SET IN THE INSERT. `user_signatures_one_default` is a
 * partial unique index, so inserting a second `is_default = true` row is a
 * constraint violation rather than a silent replacement. The row therefore always
 * lands non-default and `set_default_signature()` promotes it, because that RPC
 * is the one place that clears the previous default in the same transaction.
 */
export const useM_Signatures_Create = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const user = useStore_Auth_User();
    const mUpload = useM_Files_Upload();

    const mutation = useMutation({
        mutationFn: async (body: UseM_Signatures_Create_Body) => {
            if (!user) throw new Error("Not authenticated");

            const file = await Utils_Signature_DataUrlToFile(body.dataUrl);

            // `useM_Files_Upload` reports its own failures, so rethrowing a bare
            // error here would put two toasts on screen for one problem. The flag
            // tells this hook's `onError` that the user has already been told.
            const [uploaded, sha256] = await Promise.all([
                mUpload.mutation
                    .mutateAsync({
                        resource_type: "user_signature",
                        file,
                        user_id: user.id,
                    })
                    .catch((err: Error) => {
                        throw Object.assign(err, { alreadyReported: true });
                    }),
                sha256Hex(file),
            ]);

            const sb_FromUserSignatures_Insert = await supabase
                .from("user_signatures")
                .insert({
                    user_id: user.id,
                    r2_key: uploaded.r2_key,
                    sha256,
                    capture_method: body.capture_method,
                    name: body.name?.trim() || null,
                    is_default: false,
                })
                .select("id")
                .single();

            if (sb_FromUserSignatures_Insert.error) throw sb_FromUserSignatures_Insert.error;
            const signatureId = sb_FromUserSignatures_Insert.data.id;

            // Asked of the database rather than of the cached list, so a signature
            // added in another tab still counts and two "first" signatures cannot
            // both claim the default.
            const shouldBeDefault =
                body.makeDefault ??
                (await supabase
                    .from("user_signatures")
                    .select("id", { count: "exact", head: true })
                    .eq("is_default", true)
                    .then((res) => (res.count ?? 0) === 0));

            if (shouldBeDefault) {
                const sb_RpcSetDefaultSignature = await supabase.rpc("set_default_signature", {
                    p_signature_id: signatureId,
                });
                if (sb_RpcSetDefaultSignature.error) throw sb_RpcSetDefaultSignature.error;
            }

            return signatureId;
        },
        onSuccess: () => {
            message.success("Signature saved");
            queryClient.invalidateQueries({ queryKey: QueryKeys.user_signatures.all() });
        },
        onError: (err: Error & { alreadyReported?: boolean }) => {
            console.error(err);
            if (err.alreadyReported) return;
            message.error(err.message || "Could not save your signature");
        },
    });

    return { mutation };
};
