import { createClient } from "@supabase/supabase-js";
import type { DatabaseWithCustomTypes } from "@/types/database.override.types";
import { ENVs } from "@/utils/ENVs/ENVs";

export const supabase = createClient<DatabaseWithCustomTypes>(
    ENVs.ViteSupabaseUrl,
    ENVs.ViteSupabaseAnonKey,
);
