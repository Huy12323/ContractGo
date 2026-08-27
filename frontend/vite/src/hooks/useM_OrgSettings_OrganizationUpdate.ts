import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { Supabase_Enums } from "@/types/supabase.types";

export type UseM_OrgSettings_OrganizationUpdate_Params = { organizationId: string };

/**
 * ONE mutation for General, Branding and Documents.
 *
 * Same row, same RLS, same invalidation — and the `.select().single()` trick
 * below is load-bearing enough that it should exist exactly once. Three hooks
 * would be three chances to forget it.
 *
 * Every field here has a matching `GRANT UPDATE (col)` in CG-050 Phase 5a. That
 * migration revoked the table-level UPDATE grant and returned the settable
 * columns one at a time, so a field added to this type without a grant fails at
 * runtime with a permission error — and one that is granted but shouldn't be is
 * a hole. The two lists are the same decision written in two places; keep them
 * together.
 */
export type UseM_OrgSettings_OrganizationUpdate_Body = Partial<{
    name: string;
    ai_assistant_enabled: boolean;
    timezone: Supabase_Enums<"iana_timezone">;
    logo_file_id: string | null;
    /** `#RRGGBB`, or null to fall back to the product palette. */
    brand_color: string | null;
    email_sender_name: string | null;
    default_expiry_days: number | null;
    default_reminder_days: number[];
    default_signer_auth: Supabase_Enums<"signature_requests_signer_auth_enum">;
}>;

export const useM_OrgSettings_OrganizationUpdate = ({
    organizationId,
}: UseM_OrgSettings_OrganizationUpdate_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["organizations", "update", organizationId],
        mutationFn: async (body: UseM_OrgSettings_OrganizationUpdate_Body) => {
            // `.select().single()` is load-bearing, not decoration. Only the owner
            // may update, and RLS enforces that by filtering the row out rather
            // than raising — a bare `.update()` would come back successful having
            // changed nothing. Asking for the row back turns that into an error.
            const sb_FromOrganizations_Update = await supabase
                .from("organizations")
                .update(body)
                .eq("id", organizationId)
                .select()
                .single();
            if (sb_FromOrganizations_Update.error) throw sb_FromOrganizations_Update.error;
            return sb_FromOrganizations_Update.data;
        },
        onSuccess: () => {
            message.success("Organization updated");
            // `.all()` rather than `.record()`: the name is also rendered from the
            // `[...list(), "mine"]` cache by the switcher and Page_Home.
            queryClient.invalidateQueries({ queryKey: QueryKeys.organizations.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to update organization");
        },
    });

    return { mutation };
};
