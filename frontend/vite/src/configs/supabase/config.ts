import { createClient } from "@supabase/supabase-js";
import type { DatabaseWithCustomTypes } from "@/types/database.override.types";
import { ENVs } from "@/utils/ENVs/ENVs";

export const supabase = createClient<DatabaseWithCustomTypes>(
    ENVs.ViteSupabaseUrl,
    ENVs.ViteSupabaseAnonKey,
    {
        auth: {
            // PKCE, not the supabase-js default `implicit`. The Google sign-in
            // flow (Store_Auth_Actions.signInWithGoogle -> /auth/callback) returns
            // an authorization `?code=`, which only PKCE can exchange; under the
            // implicit flow there is nothing on the callback URL to turn into a
            // session. This is a client-wide setting, so it also moves the
            // password-recovery LINK from `#access_token=` to `?code=` — harmless
            // here because /reset-password is driven by a typed OTP
            // (`verifyRecoveryOtp`), not by the link's fragment.
            flowType: "pkce",
            // Left explicit rather than defaulted: it is what performs the code
            // exchange during client init, so /auth/callback only has to await
            // `getSession()` instead of calling `exchangeCodeForSession` itself.
            detectSessionInUrl: true,
        },
    }
);
