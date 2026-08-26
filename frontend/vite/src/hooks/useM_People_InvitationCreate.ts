import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type InvitationRole = "admin" | "member";

export type People_InvitationCreate_Variables = {
    email: string;
    role: InvitationRole;
};

// Also the RESEND path. `unique(organization_id, email)` plus the edge
// function's upsert means re-inviting an address re-issues its token and pushes
// the expiry out, so a second endpoint would be the same call with a different
// name — and two paths that must behave identically eventually don't.
export const useM_People_InvitationCreate = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({ email, role }: People_InvitationCreate_Variables) => {
            const sb_FunctionsOrganizationsSendInvitation_Invoke = await supabase.functions.invoke(
                "organizations_send-invitation",
                { body: { organization_id: organizationId, email, role } }
            );
            // A non-2xx from an edge function surfaces as `error` with a generic
            // message, so the body is read too — that is where the 403/409 text
            // worth showing the user actually lives.
            if (sb_FunctionsOrganizationsSendInvitation_Invoke.data?.error)
                throw new Error(sb_FunctionsOrganizationsSendInvitation_Invoke.data.error);
            if (sb_FunctionsOrganizationsSendInvitation_Invoke.error)
                throw sb_FunctionsOrganizationsSendInvitation_Invoke.error;
            return sb_FunctionsOrganizationsSendInvitation_Invoke.data;
        },
        onSuccess: (_data, variables) => {
            message.success(`Invitation sent to ${variables.email}`);
            // Kept alongside realtime, not replaced by it: this fires in ~0 ms
            // for the person who clicked, and realtime covers everyone else.
            queryClient.invalidateQueries({
                queryKey: [...QueryKeys.invitations.list(), organizationId],
            });
        },
        onError: (err) => {
            message.error(err instanceof Error ? err.message : "Failed to send invitation");
        },
    });

    return { mutation };
};
