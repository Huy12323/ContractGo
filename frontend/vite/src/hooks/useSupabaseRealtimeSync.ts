import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { useStore_Auth_User } from "@/stores/Store_Auth";
import type { Database } from "@/types/database.types";

type RealtimeTableEvent = Database["public"]["Tables"]["realtime_table_events"]["Row"];

const ENABLE_LOGGING = import.meta.env.DEV;

// Tables whose record-pattern query keys are NOT keyed by the row UUID.
// For these, invalidate any record-pattern query under the table regardless
// of the event's record_id match. Example: onboarding_invitations is looked
// up by invitation_token in the URL, so its record key is the token, not UUID.
const TOKEN_KEYED_TABLES = new Set<string>(["onboarding_invitations"]);

export const useSupabaseRealtimeSync = () => {
    const queryClient = useQueryClient();
    const user = useStore_Auth_User();
    const isAuthenticated = !!user;
    const channelRef = useRef<RealtimeChannel | null>(null);

    useEffect(() => {
        if (!isAuthenticated) return;

        const channel = supabase.channel("realtime-sync");
        channelRef.current = channel;

        channel.on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "realtime_table_events" },
            (payload) => {
                const event = payload.new as RealtimeTableEvent;
                handleTableChange(event.table_name, event.record_id);
            },
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
    }, [isAuthenticated, queryClient]);

    function handleTableChange(tableName: string, recordId: string | null) {
        let invalidatedCount = 0;
        let skippedCount = 0;

        queryClient.invalidateQueries({
            predicate: (query) => {
                const key = query.queryKey;
                const tableIdx = key.findIndex((s) => s === tableName);
                if (tableIdx === -1) return false;

                const marker = key[tableIdx + 1];
                if (marker === "list") {
                    invalidatedCount++;
                    return true;
                }
                if (marker === "record") {
                    // For token-keyed tables, the record key is not the row UUID,
                    // so id comparison is meaningless — invalidate broadly.
                    if (TOKEN_KEYED_TABLES.has(tableName)) {
                        invalidatedCount++;
                        return true;
                    }
                    const keyRecordId = key[tableIdx + 2];
                    const shouldInvalidate = recordId === null || keyRecordId === recordId;
                    if (shouldInvalidate) invalidatedCount++;
                    else skippedCount++;
                    return shouldInvalidate;
                }
                return false;
            },
        });

        if (ENABLE_LOGGING) {
            const scope = recordId ? `record:${recordId}` : "table-wide";
            console.log(
                `[Realtime] ${tableName} (${scope}) → invalidated:${invalidatedCount} skipped:${skippedCount}`,
            );
        }
    }
};
