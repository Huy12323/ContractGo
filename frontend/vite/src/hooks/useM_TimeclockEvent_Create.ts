import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type TimeclockAction = "clock_in" | "clock_out" | "lunch_start" | "lunch_end";

export type UseM_TimeclockEvent_Create_Params = {
    employee_id: string;
    entity_id: string;
    event_type: TimeclockAction;
};

export const useM_TimeclockEvent_Create = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_TimeclockEvent_Create_Params) => {
            const { employee_id, entity_id, event_type } = body;
            const now = new Date().toISOString();

            if (event_type === "clock_in") {
                const sb_FromTimeclockSessions_Insert = await supabase
                    .from("timeclock_sessions")
                    .insert({ employee_id, entity_id, type: "work" as const, start_at: now, start_by: "employee" as const })
                    .select()
                    .single();
                if (sb_FromTimeclockSessions_Insert.error) throw sb_FromTimeclockSessions_Insert.error;
                return sb_FromTimeclockSessions_Insert.data;
            }

            if (event_type === "lunch_start") {
                const sb_FromTimeclockSessions_Insert = await supabase
                    .from("timeclock_sessions")
                    .insert({ employee_id, entity_id, type: "break" as const, start_at: now, start_by: "employee" as const })
                    .select()
                    .single();
                if (sb_FromTimeclockSessions_Insert.error) throw sb_FromTimeclockSessions_Insert.error;
                return sb_FromTimeclockSessions_Insert.data;
            }

            if (event_type === "lunch_end") {
                const sb_FromTimeclockSessions_Select = await supabase
                    .from("timeclock_sessions")
                    .select("id, start_at")
                    .eq("employee_id", employee_id)
                    .eq("type", "break")
                    .is("end_at", null)
                    .order("start_at", { ascending: false })
                    .limit(1)
                    .single();
                if (sb_FromTimeclockSessions_Select.error) throw sb_FromTimeclockSessions_Select.error;

                const durationMs = new Date(now).getTime() - new Date(sb_FromTimeclockSessions_Select.data.start_at).getTime();
                const sb_FromTimeclockSessions_Update = await supabase
                    .from("timeclock_sessions")
                    .update({ end_at: now, duration_ms: durationMs, end_by: "employee" as const })
                    .eq("id", sb_FromTimeclockSessions_Select.data.id)
                    .select()
                    .single();
                if (sb_FromTimeclockSessions_Update.error) throw sb_FromTimeclockSessions_Update.error;
                return sb_FromTimeclockSessions_Update.data;
            }

            if (event_type === "clock_out") {
                const sb_FromTimeclockSessions_Select = await supabase
                    .from("timeclock_sessions")
                    .select("id, start_at")
                    .eq("employee_id", employee_id)
                    .eq("type", "work")
                    .is("end_at", null)
                    .order("start_at", { ascending: false })
                    .limit(1)
                    .single();
                if (sb_FromTimeclockSessions_Select.error) throw sb_FromTimeclockSessions_Select.error;

                const durationMs = new Date(now).getTime() - new Date(sb_FromTimeclockSessions_Select.data.start_at).getTime();
                const sb_FromTimeclockSessions_Update = await supabase
                    .from("timeclock_sessions")
                    .update({ end_at: now, duration_ms: durationMs, end_by: "employee" as const })
                    .eq("id", sb_FromTimeclockSessions_Select.data.id)
                    .select()
                    .single();
                if (sb_FromTimeclockSessions_Update.error) throw sb_FromTimeclockSessions_Update.error;
                return sb_FromTimeclockSessions_Update.data;
            }

            throw new Error(`Unknown event type: ${event_type}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.timeclock_sessions.list() });
        },
        onError: (error) => {
            console.error("Timeclock event error:", error);
            message.error((error as any).message?.includes("Must clock out")
                ? "You must clock out of your current entity first"
                : "Failed to record clock event");
        },
    });

    return { mutation };
};
