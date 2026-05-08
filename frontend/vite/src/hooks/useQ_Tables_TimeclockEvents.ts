import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const PAGE_SIZE = 1000;

const fetchEmployeeSessions = async (employeeIds: string[], startUtc: string, endUtc: string) => {
    const all: any[] = [];
    let from = 0;
    while (true) {
        const sb_FromTimeclockSessions_Select = await supabase
            .from("timeclock_sessions")
            .select("id, employee_id, entity_id, type, start_at, end_at, duration_ms, start_by, end_by")
            .in("employee_id", employeeIds)
            .gte("start_at", startUtc)
            .lt("start_at", endUtc)
            .order("start_at", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);
        if (sb_FromTimeclockSessions_Select.error) throw sb_FromTimeclockSessions_Select.error;
        const page = sb_FromTimeclockSessions_Select.data;
        all.push(...page);
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }
    return all;
};

export type TimeclockSession = {
    id: string;
    employee_id: string;
    entity_id: string;
    type: "work" | "break";
    start_at: string;
    end_at: string | null;
    duration_ms: number | null;
    start_by: "employee" | "system";
    end_by: "employee" | "system" | null;
};

export const useQ_Tables_TimeclockSessions = ({
    employeeIds,
    startUtc,
    endUtc,
}: {
    employeeIds: string[];
    startUtc: string;
    endUtc: string;
}) => {
    const query = useQuery({
        enabled: employeeIds.length > 0 && !!startUtc && !!endUtc,
        queryKey: [...QueryKeys.timeclock_sessions.list(), { employeeIds, startUtc, endUtc }],
        queryFn: () => fetchEmployeeSessions(employeeIds, startUtc, endUtc),
        refetchInterval: 60_000,
    });

    const sessions = useMemo(() => (query.data || []) as TimeclockSession[], [query.data]);

    return { query, sessions };
};

// Compat shim — old consumers (App_ClockStrip, Page_MyTimeclock) still use the events-style API.
// Maps sessions back to event-like rows so the old aggregation utils work unchanged.
export type Tables_TimeclockEvents_QueryData = {
    id: string;
    employee_id: string;
    entity_id: string;
    event_type: string;
    created_at: string;
    entities: { id: string; name: string; timezone: string } | null;
}[];

const sessionToEvents = (s: TimeclockSession): Tables_TimeclockEvents_QueryData => {
    const events: Tables_TimeclockEvents_QueryData = [];
    const base = { employee_id: s.employee_id, entity_id: s.entity_id, entities: null };
    if (s.type === "work") {
        events.push({ ...base, id: s.id + "_in", event_type: "clock_in", created_at: s.start_at });
        if (s.end_at) events.push({ ...base, id: s.id + "_out", event_type: "clock_out", created_at: s.end_at });
    } else {
        events.push({ ...base, id: s.id + "_ls", event_type: "lunch_start", created_at: s.start_at });
        if (s.end_at) events.push({ ...base, id: s.id + "_le", event_type: "lunch_end", created_at: s.end_at });
    }
    return events;
};

export const useQ_Tables_TimeclockEvents = ({
    employeeIds,
    startDate,
    endDate,
}: {
    employeeIds: string[];
    startDate: string;
    endDate: string;
}) => {
    const qSessions = useQ_Tables_TimeclockSessions({ employeeIds, startUtc: startDate, endUtc: endDate });

    const events = useMemo(() => {
        const all: Tables_TimeclockEvents_QueryData = [];
        for (const s of qSessions.sessions) all.push(...sessionToEvents(s));
        all.sort((a, b) => a.created_at.localeCompare(b.created_at));
        return all;
    }, [qSessions.sessions]);

    return { query: qSessions.query, events };
};
