import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchEntityTodaySessions = async (entityId: string, todayStartUtc: string, todayEndUtc: string) => {
    const sb_FromTimeclockSessions_Select = await supabase
        .from("timeclock_sessions")
        .select("employee_id, type, start_at, end_at, duration_ms")
        .eq("entity_id", entityId)
        .gte("start_at", todayStartUtc)
        .lt("start_at", todayEndUtc)
        .order("start_at", { ascending: true });
    if (sb_FromTimeclockSessions_Select.error) throw sb_FromTimeclockSessions_Select.error;
    return sb_FromTimeclockSessions_Select.data;
};

export const useQ_Tables_EntityTimeclockEventsToday = ({
    entityId,
    timezone = "UTC",
}: {
    entityId: string;
    timezone?: string;
}) => {
    const { todayStartUtc, todayEndUtc } = useMemo(() => {
        const now = new Date();
        const todayParts = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(now);
        const y = todayParts.find((p) => p.type === "year")!.value;
        const m = todayParts.find((p) => p.type === "month")!.value;
        const d = todayParts.find((p) => p.type === "day")!.value;
        const todayLocal = `${y}-${m}-${d}`;
        const sampleLocal = new Date().toLocaleString("en-US", { timeZone: timezone });
        const sampleUtc = new Date().toLocaleString("en-US", { timeZone: "UTC" });
        const diff = new Date(sampleUtc).getTime() - new Date(sampleLocal).getTime();
        const dayStart = new Date(new Date(`${todayLocal}T00:00:00Z`).getTime() + diff);
        const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
        return { todayStartUtc: dayStart.toISOString(), todayEndUtc: dayEnd.toISOString() };
    }, [timezone]);

    const query = useQuery({
        enabled: !!entityId,
        queryKey: [...QueryKeys.timeclock_sessions.list(), "entity-today", { entityId, todayStartUtc }],
        queryFn: () => fetchEntityTodaySessions(entityId, todayStartUtc, todayEndUtc),
        refetchInterval: 60_000,
    });

    const todayWorkedByEmployee = useMemo(() => {
        const map = new Map<string, number>();
        if (!query.data) return map;

        const byEmployee = new Map<string, typeof query.data>();
        for (const s of query.data) {
            const arr = byEmployee.get(s.employee_id);
            if (arr) arr.push(s);
            else byEmployee.set(s.employee_id, [s]);
        }

        for (const [empId, sessions] of byEmployee) {
            let workMs = 0;
            let breakMs = 0;

            for (const s of sessions) {
                const dur = s.end_at
                    ? (s.duration_ms ?? 0)
                    : Date.now() - new Date(s.start_at).getTime();

                if (s.type === "work") workMs += dur;
                else breakMs += dur;
            }

            const netWorked = Math.max(workMs - breakMs, 0);
            if (netWorked > 0) map.set(empId, netWorked);
        }

        return map;
    }, [query.data]);

    return { query, todayWorkedByEmployee };
};
