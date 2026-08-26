import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { useStore_Auth_User } from "@/stores/Store_Auth";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Profile_Update_Body = {
    full_name?: string;
    avatar_url?: string | null;
    /**
     * CG-037. The `files` row for an avatar we host, written alongside
     * `avatar_url` rather than instead of it — see the note at the callsite in
     * `PageSettings_ProfileTab`. NULL for a profile whose picture is an external
     * OAuth URL, which is what `handle_new_user` seeds.
     */
    avatar_file_id?: string | null;
};

/**
 * The signed-in user's own profile row.
 *
 * A PLAIN SDK WRITE, not an edge function, because `profiles` already carries a
 * self-update RLS policy (`auth.uid() = id`) from the original schema — the
 * database is the authority on who may write this row, so routing it through
 * service_role would replace a checked write with an unchecked one.
 *
 * `email` is deliberately NOT writable here. It lives on `auth.users` as well as
 * on this row, and changing it has to re-run verification
 * (`profiles.email_verified` gates the whole `_protected` tree) — a different
 * flow, not a field on this form.
 */
export const useM_Profile_Update = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const user = useStore_Auth_User();

    const mutation = useMutation({
        mutationFn: async (body: UseM_Profile_Update_Body) => {
            if (!user) throw new Error("Not authenticated");

            const sb_FromProfiles_Update = await supabase
                .from("profiles")
                .update(body)
                .eq("id", user.id)
                // `whitelist` is returned but never sent: CG-035 revokes UPDATE on
                // that column from `authenticated`, so including it in `body`
                // would make every profile save fail with a permission error.
                .select(
                    "id, email, full_name, avatar_url, email_verified, whitelist, created_at, updated_at"
                )
                .single();

            if (sb_FromProfiles_Update.error) throw sb_FromProfiles_Update.error;
            return sb_FromProfiles_Update.data;
        },
        onSuccess: () => {
            message.success("Profile updated");
            // Both keys, not just the record: the name and avatar are read for
            // OTHER people too — version authors in `App_TemplateVersionsModal`
            // and members in `App_OrgSettingsModal` — and those live under the
            // list key. Invalidating only `record` would leave the user's own
            // name stale everywhere except the account menu.
            queryClient.invalidateQueries({ queryKey: QueryKeys.profiles.all() });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Could not update your profile");
        },
    });

    return { mutation };
};
