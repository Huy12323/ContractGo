import type { Tables_TimeclockEvents_QueryData } from "@/hooks/useQ_Tables_TimeclockEvents";

export type TimeclockSession = {
    type: "work" | "lunch";
    startAt: string;
    endAt: string | null;
    durationMs: number;
};

export type TimeclockDaySummary = {
    date: string;
    sessions: TimeclockSession[];
    workedMs: number;
    breakMs: number;
    extraMs: number;
};

type RawEvent = Tables_TimeclockEvents_QueryData[number];

const MS_8H = 8 * 60 * 60 * 1000;

const toDateKey = (isoStr: string, timezone: string) => {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(new Date(isoStr));
        return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-${parts.find((p) => p.type === "day")!.value}`;
    } catch {
        const dt = new Date(isoStr);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    }
};

const getNextMidnight = (timestamp: number, timezone: string): number => {
    const dateKey = toDateKey(new Date(timestamp).toISOString(), timezone);
    const [y, m, d] = dateKey.split("-").map(Number);
    const nextDay = new Date(y!, m! - 1, d! + 1);
    const nextDayKey = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, "0")}-${String(nextDay.getDate()).padStart(2, "0")}`;

    let lo = timestamp;
    let hi = timestamp + 26 * 3600 * 1000;
    for (let i = 0; i < 40; i++) {
        const mid = Math.floor((lo + hi) / 2);
        const midKey = toDateKey(new Date(mid).toISOString(), timezone);
        if (midKey < nextDayKey) lo = mid;
        else hi = mid;
    }
    return hi;
};

type Segment = { type: "work" | "lunch"; startMs: number; endMs: number };

const splitAtMidnight = (seg: Segment, timezone: string): { date: string; session: TimeclockSession }[] => {
    const results: { date: string; session: TimeclockSession }[] = [];
    let cursor = seg.startMs;

    while (cursor < seg.endMs) {
        const dateKey = toDateKey(new Date(cursor).toISOString(), timezone);
        const midnight = getNextMidnight(cursor, timezone);
        const segEnd = Math.min(midnight, seg.endMs);
        const durationMs = segEnd - cursor;
        // Use midnight - 1ms as endAt so timeToPercent renders at 100% not 0%
        const displayEnd = segEnd === midnight ? segEnd - 1 : segEnd;

        if (durationMs > 0) {
            results.push({
                date: dateKey,
                session: {
                    type: seg.type,
                    startAt: new Date(cursor).toISOString(),
                    endAt: segEnd >= seg.endMs && Math.abs(seg.endMs - Date.now()) < 2000 ? null : new Date(displayEnd).toISOString(),
                    durationMs,
                },
            });
        }
        cursor = segEnd;
    }
    return results;
};

export const utils_Timeclock_AggregateEvents = (
    events: RawEvent[],
    timezone: string,
): TimeclockDaySummary[] => {
    if (events.length === 0) return [];

    const dayMap = new Map<string, TimeclockSession[]>();

    const addSession = (date: string, session: TimeclockSession) => {
        const arr = dayMap.get(date);
        if (arr) arr.push(session);
        else dayMap.set(date, [session]);
    };

    let lastType: string | null = null;
    let lastAt: number | null = null;

    for (const e of events) {
        const t = new Date(e.created_at).getTime();

        if (e.event_type === "clock_in") {
            lastType = "clock_in";
            lastAt = t;
        } else if (e.event_type === "lunch_start" && lastType && lastType !== "lunch_start" && lastAt) {
            for (const s of splitAtMidnight({ type: "work", startMs: lastAt, endMs: t }, timezone)) addSession(s.date, s.session);
            lastType = "lunch_start";
            lastAt = t;
        } else if (e.event_type === "lunch_end" && lastType === "lunch_start" && lastAt) {
            for (const s of splitAtMidnight({ type: "lunch", startMs: lastAt, endMs: t }, timezone)) addSession(s.date, s.session);
            lastType = "lunch_end";
            lastAt = t;
        } else if (e.event_type === "clock_out" && lastAt) {
            const segType = lastType === "lunch_start" ? "lunch" : "work";
            for (const s of splitAtMidnight({ type: segType as "work" | "lunch", startMs: lastAt, endMs: t }, timezone)) addSession(s.date, s.session);
            lastType = "clock_out";
            lastAt = null;
        }
    }

    // Open session: split at midnight up to now
    if (lastAt && lastType && lastType !== "clock_out") {
        const now = Date.now();
        const segType = lastType === "lunch_start" ? "lunch" : "work";
        for (const s of splitAtMidnight({ type: segType as "work" | "lunch", startMs: lastAt, endMs: now }, timezone)) {
            if (s.session.endAt && new Date(s.session.endAt).getTime() >= now - 1000) {
                s.session.endAt = null;
            }
            addSession(s.date, s.session);
        }
    }

    const summaries: TimeclockDaySummary[] = [];

    for (const [date, sessions] of dayMap) {
        const workedMs = sessions.filter((s) => s.type === "work").reduce((sum, s) => sum + s.durationMs, 0);
        const breakMs = sessions.filter((s) => s.type === "lunch").reduce((sum, s) => sum + s.durationMs, 0);
        const extraMs = Math.max(0, workedMs - MS_8H);
        summaries.push({ date, sessions, workedMs, breakMs, extraMs });
    }

    summaries.sort((a, b) => a.date.localeCompare(b.date));
    return summaries;
};

export const formatDuration = (ms: number): string => {
    const hours = ms / 3600000;
    return hours.toFixed(2) + "h";
};

export const formatTimeInTz = (isoStr: string, timezone: string): string => {
    try {
        return new Date(isoStr).toLocaleTimeString("en-GB", {
            timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
        });
    } catch {
        return new Date(isoStr).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
};
