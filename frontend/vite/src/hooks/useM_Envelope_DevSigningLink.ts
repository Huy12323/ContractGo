import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Envelope_DevSigningLink_Body = {
    organization_id: string;
    envelope_id: string;
    signer_id: string;
};

export type UseM_Envelope_DevSigningLink_Result = {
    url: string;
    expires_at: string;
    purpose: "sign" | "view";
    signer_name: string;
    signer_email: string;
};

/**
 * Fetches one recipient's link so it can be opened without an inbox.
 *
 * DEVELOPMENT ONLY, and the server is the one that enforces it: the edge
 * function refuses unless `DEV_SIGNING_LINKS=enabled`, so the callers below gate
 * on `ENVs.isDev` to avoid rendering a button that would 403, not as the security
 * boundary. See `envelopes_dev-signing-link/index.ts` for why handing a signing
 * credential to the sender is a property worth breaking only where no real
 * counterparty exists.
 *
 * A MUTATION rather than a query for the same reason as
 * `useM_Envelope_DownloadSigned`: the call MINTS a credential and chains
 * `signer_token_issued`, so a query would re-issue on every refocus — and each
 * issue revokes the last one, meaning the link in the developer's clipboard
 * would keep dying under them.
 */
export const useM_Envelope_DevSigningLink = () => {
    const { message } = App.useApp();
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationKey: ["envelopes", "dev-signing-link"],
        mutationFn: async (body: UseM_Envelope_DevSigningLink_Body) => {
            const sb_FunctionsEnvelopesDevSigningLink_Invoke = await supabase.functions.invoke(
                "envelopes_dev-signing-link",
                { body }
            );
            if (sb_FunctionsEnvelopesDevSigningLink_Invoke.error) {
                throw await utils_Signing_UnwrapError(
                    sb_FunctionsEnvelopesDevSigningLink_Invoke.error
                );
            }
            return sb_FunctionsEnvelopesDevSigningLink_Invoke.data as UseM_Envelope_DevSigningLink_Result;
        },
        onSuccess: (_result, variables) => {
            // Both are written: the issue is chained, and a recipient still on
            // `pending` is moved to `notified` so the link is actually signable.
            // Realtime covers the signer row, but the audit log deliberately has
            // no trigger (see the hybrid policy), so the timeline needs this.
            queryClient.invalidateQueries({
                queryKey: QueryKeys.signature_requests.record(variables.envelope_id),
            });
            queryClient.invalidateQueries({ queryKey: QueryKeys.signature_audit_log.all() });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Could not issue a signing link");
        },
    });

    return { mutation };
};
