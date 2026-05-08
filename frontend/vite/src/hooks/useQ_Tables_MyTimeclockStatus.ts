import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { useStore_Auth_User } from "@/stores/Store_Auth";

const fetchMyOpenSessions = async (userId: string, organizationId: string) => {
    const sb_FromEmployees_Select = await supabase
        .from("employees")
        .select("id, entity_id, entities(name, timezone)")
        .eq("user_id", userId)
        .eq("organization_id", organizationId);
    if (sb_FromEmployees_Select.error) throw sb_FromEmployees_Select.error;

    const employeeIds = sb_FromEmployees_Select.data.map((e) => e.id);
    if (employeeIds.length === 0) return { sessions: [], employees: [] };

    const sb_FromTimeclockSessions_Select = await supabase
        .from("timeclock_sessions")
        .select("id, employee_id, entity_id, type, start_at")
        .in("employee_id", employeeIds)
        .is("end_at", null);
    if (sb_FromTimeclockSessions_Select.error) throw sb_FromTimeclockSessions_Select.error;

    return { sessions: sb_FromTimeclockSessions_Select.data, employees: sb_FromEmployees_Select.data };
};

export type TimeclockState = "idle" | "clocked_in" | "on_lunch";

export type TimeclockStatus = {
    state: TimeclockState;
    entityName: string | null;
    entityTimezone: string | null;
    sessionStartedAt: string | null;
    lunchStartedAt: string | null;
    employeeId: string | null;
    entityId: string | null;
};

const IDLE: TimeclockStatus = { state: "idle", entityName: null, entityTimezone: null, sessionStartedAt: null, lunchStartedAt: null, employeeId: null, entityId: null };

export const useQ_Tables_MyTimeclockStatus = ({ organizationId }: { organizationId: string }) => {
    const user = useStore_Auth_User();
    const userId = user?.id ?? "";

    const query = useQuery({
        enabled: !!userId && !!organizationId,
        queryKey: [...QueryKeys.timeclock_sessions.list(), "my-status", { organizationId }],
        queryFn: () => fetchMyOpenSessions(userId, organizationId),
        refetchInterval: 30_000,
    });

    const status = useMemo<TimeclockStatus>(() => {
        if (!query.data) return IDLE;
        const { sessions, employees } = query.data;

        const workSession = sessions.find((s) => s.type === "work");
        if (!workSession) return IDLE;

        const emp = employees.find((e) => e.id === workSession.employee_id);
        const entity = emp?.entities as { name: string; timezone: string } | null;

        const breakSession = sessions.find((s) => s.type === "break");

        if (breakSession) {
            return {
                state: "on_lunch",
                entityName: entity?.name ?? null,
                entityTimezone: entity?.timezone ?? null,
                sessionStartedAt: workSession.start_at,
                lunchStartedAt: breakSession.start_at,
                employeeId: workSession.employee_id,
                entityId: workSession.entity_id,
            };
        }

        return {
            state: "clocked_in",
            entityName: entity?.name ?? null,
            entityTimezone: entity?.timezone ?? null,
            sessionStartedAt: workSession.start_at,
            lunchStartedAt: null,
            employeeId: workSession.employee_id,
            entityId: workSession.entity_id,
        };
    }, [query.data]);

    return { query, status };
};
