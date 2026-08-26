/**
 * Convenience helpers over the generated Supabase types — use these instead of
 * deep-indexing `Database["public"][…]` at call sites.
 *
 * Named and located per `bible-supabase-sdk`. This file replaces the earlier
 * `database.helpers.ts`, which exported the same four aliases under the bare
 * names `Tables` / `Enums`. Those names collided conceptually with the generated
 * `Database["public"]["Tables"]` container they wrapped, read as globals in
 * import lists, and — being off-convention — went unused for the whole of the
 * ContractGo conversion while six call sites deep-indexed anyway.
 *
 * Indirected through `DatabaseWithCustomTypes` rather than `Database` so JSONB
 * overrides declared in `database.override.types.ts` reach every consumer of
 * these aliases automatically. That file is currently a pass-through; the moment
 * a column gets a hand-written type, everything below picks it up for free.
 */

import type { DatabaseWithCustomTypes } from "./database.override.types";

export type Supabase_Tables<T extends keyof DatabaseWithCustomTypes["public"]["Tables"]> =
    DatabaseWithCustomTypes["public"]["Tables"][T]["Row"];

export type Supabase_TablesInsert<T extends keyof DatabaseWithCustomTypes["public"]["Tables"]> =
    DatabaseWithCustomTypes["public"]["Tables"][T]["Insert"];

export type Supabase_TablesUpdate<T extends keyof DatabaseWithCustomTypes["public"]["Tables"]> =
    DatabaseWithCustomTypes["public"]["Tables"][T]["Update"];

export type Supabase_Enums<T extends keyof DatabaseWithCustomTypes["public"]["Enums"]> =
    DatabaseWithCustomTypes["public"]["Enums"][T];
