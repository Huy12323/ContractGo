import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { useStore_Auth_User } from "@/stores/Store_Auth";
import type { Supabase_Tables } from "@/types/supabase.types";
import { ENVs } from "@/utils/ENVs/ENVs";
import { QueryKeys } from "@/utils/query/queryKeys";

type RealtimeTableEvent = Supabase_Tables<"realtime_table_events">;

const ENABLE_LOGGING = ENVs.isDev;

// Tables whose record-pattern query keys are NOT keyed by the row id. For
// these, invalidate any record-pattern query under the table regardless of
// whether the event's record_id matches.
//
// EMPTY since CG-009. Its only entry was `onboarding_invitations`, whose record
// key was the URL's `invitation_token` rather than the row id. The replacement
// signer surface never hits this path at all: an external signer holds no
// session, so `useSupabaseRealtimeSync` does not run for them, and the sender-side
// queries key `signature_requests` by its real id. The set stays because the
// mismatch it handles is a property of URL design, not of the HR domain — the
// v1.3 public `/verify/$documentId` surface is the likely next case.
const TOKEN_KEYED_TABLES = new Set<string>();

export const useSupabaseRealtimeSync = () => {
    const queryClient = useQueryClient();
    const user = useStore_Auth_User();
    // The id, not the object: the notification subscription's server-side filter
    // is built from it, so the channel must be torn down and rebuilt when the
    // signed-in user changes — and must NOT be rebuilt when the store hands back
    // a new object for the same person.
    const userId = user?.id ?? null;
    const channelRef = useRef<RealtimeChannel | null>(null);

    useEffect(() => {
        if (!userId) return;

        const channel = supabase.channel("realtime-sync");
        channelRef.current = channel;

        channel.on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "realtime_table_events" },
            (payload) => {
                const event = payload.new as RealtimeTableEvent;
                if (ENABLE_LOGGING) {
                    console.log(`[Realtime] event received:`, {
                        table: event.table_name,
                        record_id: event.record_id,
                        event_type: event.event_type,
                        org: event.organization_id,
                    });
                }
                handleTableChange(event.table_name, event.record_id);
            }
        );

        // CG-018 — the notification inbox, on the SAME channel but NOT through
        // the org event bus above.
        //
        // `realtime_table_events` is readable by any org member, so routing
        // notifications through it would stream the existence, timing and row
        // ids of everyone's notifications to the whole organization — and it
        // could not carry an admin invitation at all, whose `organization_id` is
        // NULL by design. The direct subscription takes a server-side
        // `user_id=eq.<uid>` filter on top of RLS, making the fan-out exactly
        // one: this user's own rows, and nobody else's.
        channel.on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "notifications",
                filter: `user_id=eq.${userId}`,
            },
            () => {
                if (ENABLE_LOGGING) console.log("[Realtime] notification received");
                // One key for the list variants and the unread count alike —
                // they all sit under `QueryKeys.notifications`.
                queryClient.invalidateQueries({ queryKey: QueryKeys.notifications.all() });
            }
        );

        channel.subscribe((status, err) => {
            if (ENABLE_LOGGING) {
                console.log(`[Realtime] channel ${status}`, err ?? "");
            }
        });

        return () => {
            supabase.removeChannel(channel);
            channelRef.current = null;
        };
    }, [userId, queryClient]);

    function handleTableChange(tableName: string, recordId: string | null) {
        let invalidatedCount = 0;
        let skippedCount = 0;
        const matchedKeys: string[] = [];

        queryClient.invalidateQueries({
            predicate: (query) => {
                const key = query.queryKey;
                const tableIdx = key.findIndex((s) => s === tableName);
                if (tableIdx === -1) return false;

                const marker = key[tableIdx + 1];
                if (marker === "list") {
                    invalidatedCount++;
                    if (ENABLE_LOGGING) matchedKeys.push(JSON.stringify(key));
                    return true;
                }
                if (marker === "record") {
                    if (TOKEN_KEYED_TABLES.has(tableName)) {
                        invalidatedCount++;
                        if (ENABLE_LOGGING) matchedKeys.push(JSON.stringify(key));
                        return true;
                    }
                    const keyRecordId = key[tableIdx + 2];
                    const shouldInvalidate = recordId === null || keyRecordId === recordId;
                    if (shouldInvalidate) {
                        invalidatedCount++;
                        if (ENABLE_LOGGING) matchedKeys.push(JSON.stringify(key));
                    } else skippedCount++;
                    return shouldInvalidate;
                }
                return false;
            },
        });

        if (ENABLE_LOGGING) {
            const scope = recordId ? `record:${recordId}` : "table-wide";
            console.log(
                `[Realtime] ${tableName} (${scope}) → invalidated:${invalidatedCount} skipped:${skippedCount}`,
                matchedKeys.length > 0 ? matchedKeys : "(no active queries matched)"
            );
        }
    }
};
