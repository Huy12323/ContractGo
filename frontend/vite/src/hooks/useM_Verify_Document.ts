import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";

export type Verify_Signer = {
    name: string;
    email_masked: string | null;
    signed_at: string | null;
    status: string;
    auth_methods: string[];
};

export type Verify_Result =
    | { verified: false }
    | {
          verified: true;
          /** Which artifact the digest matched — the contract or its certificate. */
          matched: "signed_document" | "certificate";
          document_title: string;
          organization_name: string;
          completed_at: string | null;
          signer_count: number;
          signers: Verify_Signer[];
      };

/**
 * Checks a document fingerprint against the public verification endpoint.
 *
 * A MUTATION despite reading nothing of the caller's: it is user-initiated, must
 * never fire on mount or on a window focus, and has a per-IP rate limit behind it
 * that a background revalidation would spend on the user's behalf.
 *
 * NO `utils_Signing_AuthHeaders` and no session — the caller is a stranger
 * holding a PDF, which is the entire point of the surface. It also does not use
 * `utils_Signing_UnwrapError`: that helper carries the signer surface's
 * structured refusal codes (`otp_required`, `retry_after_seconds`, …) and this
 * endpoint deliberately has exactly two outcomes.
 *
 * `verified: false` is a RESULT, not an error. An unknown fingerprint is the
 * expected answer for anyone checking a document that did not come from here, and
 * routing it through `onError` would render a system failure over a successful
 * check that happened to say no.
 */
export const useM_Verify_Document = () => {
    const mutation = useMutation({
        mutationKey: ["verify", "document"],
        mutationFn: async (sha256: string): Promise<Verify_Result> => {
            const sb_FunctionsVerifyDocument_Invoke = await supabase.functions.invoke(
                "verify_document",
                { body: { sha256 } }
            );
            if (sb_FunctionsVerifyDocument_Invoke.error) {
                throw new Error("The verification service could not be reached. Please try again.");
            }
            return sb_FunctionsVerifyDocument_Invoke.data as Verify_Result;
        },
    });

    return { mutation };
};
