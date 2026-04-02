import { createClient } from "@supabase/supabase-js";
import type { Database } from "@worldcraft/shared/types";
import { ENVs } from "@/utils/ENVs/ENVs";

export const supabase = createClient<Database>(
    ENVs.ViteSupabaseUrl,
    ENVs.ViteSupabaseAnonKey,
);
