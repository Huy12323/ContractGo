import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { useStore_Auth_User } from "@/stores/Store_Auth";
import type { Database } from "@/types/database.types";

type RealtimeTableEvent = Database["public"]["Tables"]["realtime_table_events"]["Row"];

const ENABLE_LOGGING = import.meta.env.DEV;

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
