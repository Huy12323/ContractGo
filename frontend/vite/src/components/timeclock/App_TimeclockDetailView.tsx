import { useState, useMemo } from "react";
import { Segmented, Button, Tag, Typography, DatePicker, theme } from "antd";
import { LeftOutlined, RightOutlined, BarChartOutlined, UnorderedListOutlined, DownOutlined, UpOutlined } from "@ant-design/icons";
import { useQ_Tables_TimeclockSessions } from "@/hooks/useQ_Tables_TimeclockEvents";
import type { TimeclockSession } from "@/hooks/useQ_Tables_TimeclockEvents";
import { formatDuration, formatTimeInTz } from "@/utils/timeclock/utils_Timeclock_AggregateEvents";
import {
    getDateRange, navigateDate, getDaysInRange, isToday, isFuture, isWeekend, formatDayLabel, fmtDate,
} from "@/utils/timeclock/utils_Timeclock_DateRange";
import type { ViewMode } from "@/utils/timeclock/utils_Timeclock_DateRange";
import { App_TimeclockBar24, App_TimeclockLegend } from "@/components/timeclock/App_TimeclockBar24";
import { App_TimeclockEventDot } from "@/components/timeclock/App_TimeclockEventDot";
import { TIMECLOCK_COLORS } from "@/utils/timeclock/const_Timeclock_Colors";
import type { RangePickerProps } from "antd/es/date-picker";
import dayjs from "dayjs";

const { Text } = Typography;
const { RangePicker } = DatePicker;

const VIEW_OPTIONS = ["Day", "Week", "Month", "Cycle", "Custom"] as const;
const VIEW_MAP: Record<string, ViewMode> = { Day: "day", Week: "week", Month: "month", Cycle: "cycle", Custom: "custom" };
const VIEW_REVERSE: Record<ViewMode, string> = { day: "Day", week: "Week", month: "Month", cycle: "Cycle", custom: "Custom" };

type DisplayMode = "bar" | "table";

type BarSession = {
    type: "work" | "lunch";
    startAt: string;
    endAt: string | null;
    durationMs: number;
};

type TimelineEntry = {
    time: string;
    label: string;
    eventType: string;
    elapsed: number | null;
    isActive: boolean;
};

type DaySummary = {
    date: string;
    sessions: BarSession[];
    workedMs: number;
    breakMs: number;
    rawSessions: TimeclockSession[];
    timeline: TimelineEntry[];
};

const sessionsToTimeline = (daySessions: TimeclockSession[], timezone: string): TimelineEntry[] => {
    const events: { at: string; label: string; eventType: string }[] = [];
    for (const s of daySessions) {
        if (s.type === "work") {
            events.push({ at: s.start_at, label: "Clock In", eventType: "clock_in" });
            if (s.end_at) events.push({ at: s.end_at, label: "Clock Out", eventType: "clock_out" });
        } else {
            events.push({ at: s.start_at, label: "Break", eventType: "lunch_start" });
            if (s.end_at) events.push({ at: s.end_at, label: "Back to Work", eventType: "lunch_end" });
        }
    }
    events.sort((a, b) => a.at.localeCompare(b.at));

    const timeline: TimelineEntry[] = [];
    for (let i = 0; i < events.length; i++) {
        const e = events[i]!;
        const elapsed = i > 0 ? new Date(e.at).getTime() - new Date(events[i - 1]!.at).getTime() : null;
        timeline.push({ time: formatTimeInTz(e.at, timezone), label: e.label, eventType: e.eventType, elapsed, isActive: false });
    }

    const hasOpenBreak = daySessions.some((s) => s.type === "break" && !s.end_at);
    const hasOpenWork = daySessions.some((s) => s.type === "work" && !s.end_at);
    if (hasOpenBreak) {
        const breakSession = daySessions.find((s) => s.type === "break" && !s.end_at)!;
        timeline.push({ time: "", label: "On Break...", eventType: "on_lunch", elapsed: Date.now() - new Date(breakSession.start_at).getTime(), isActive: true });
    } else if (hasOpenWork) {
        const lastEvent = events[events.length - 1];
        timeline.push({ time: "", label: "Working...", eventType: "working", elapsed: lastEvent ? Date.now() - new Date(lastEvent.at).getTime() : null, isActive: true });
    }
    return timeline;
};

const fmtLocalDate = (isoStr: string, timezone: string): string => {
    try {
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(isoStr));
        return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-${parts.find((p) => p.type === "day")!.value}`;
    } catch {
        const dt = new Date(isoStr);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    }
};

const sessionsToSummaries = (sessions: TimeclockSession[], timezone: string): DaySummary[] => {
    const byDate = new Map<string, TimeclockSession[]>();
    for (const s of sessions) {
        const dateKey = fmtLocalDate(s.start_at, timezone);
        const arr = byDate.get(dateKey);
        if (arr) arr.push(s); else byDate.set(dateKey, [s]);
    }
    const summaries: DaySummary[] = [];
    for (const [date, daySessions] of byDate) {
        const barSessions: BarSession[] = [];
        let workMs = 0, breakMs = 0;
        for (const s of daySessions) {
            const dur = s.end_at ? (s.duration_ms ?? new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) : Date.now() - new Date(s.start_at).getTime();
            barSessions.push({ type: s.type === "break" ? "lunch" : "work", startAt: s.start_at, endAt: s.end_at, durationMs: dur });
            if (s.type === "work") workMs += dur; else breakMs += dur;
        }
        summaries.push({ date, sessions: barSessions, workedMs: Math.max(workMs - breakMs, 0), breakMs, rawSessions: daySessions, timeline: sessionsToTimeline(daySessions, timezone) });
    }
    summaries.sort((a, b) => a.date.localeCompare(b.date));
    return summaries;
};

// --- Active indicator ---
const ActiveIndicator = ({ summary }: { summary: DaySummary | undefined }) => {
    if (!summary?.rawSessions.some((s) => !s.end_at)) return null;
    const isBreak = summary.rawSessions.some((s) => s.type === "break" && !s.end_at);
    const color = isBreak ? TIMECLOCK_COLORS.lunch.text : TIMECLOCK_COLORS.work.solid;
    return (
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color }}>
            <App_TimeclockEventDot eventType={isBreak ? "on_lunch" : "working"} size={6} pulse />
            {isBreak ? "On Break..." : "Working..."}
        </span>
    );
};

// --- Props ---
type Props = {
    employeeId: string;
    timezone: string;
    initialPeriod?: ViewMode;
    toolbarExtra?: React.ReactNode;
};

export const App_TimeclockDetailView = ({ employeeId, timezone, initialPeriod = "week", toolbarExtra }: Props) => {
    const { token } = theme.useToken();
    const [displayMode, setDisplayMode] = useState<DisplayMode>("bar");
    const [period, setPeriod] = useState<ViewMode>(initialPeriod);
    const [refDate, setRefDate] = useState(new Date());
    const [customRange, setCustomRange] = useState<[Date, Date] | null>(null);

    const dateRange = useMemo(() => getDateRange(period, refDate, customRange?.[0], customRange?.[1]), [period, refDate, customRange]);
    const days = useMemo(() => getDaysInRange(dateRange.startDate, dateRange.endDate), [dateRange]);

    const { startUtc, endUtc } = useMemo(() => {
        const sampleLocal = new Date().toLocaleString("en-US", { timeZone: timezone });
        const sampleUtc = new Date().toLocaleString("en-US", { timeZone: "UTC" });
        const diff = new Date(sampleUtc).getTime() - new Date(sampleLocal).getTime();
        const s = new Date(`${dateRange.startDate}T00:00:00Z`);
        const e = new Date(`${dateRange.endDate}T00:00:00Z`);
        e.setDate(e.getDate() + 1);
        return { startUtc: new Date(s.getTime() + diff).toISOString(), endUtc: new Date(e.getTime() + diff).toISOString() };
    }, [dateRange.startDate, dateRange.endDate, timezone]);

    const qSessions = useQ_Tables_TimeclockSessions({ employeeIds: employeeId ? [employeeId] : [], startUtc, endUtc });
    const summaries = useMemo(() => sessionsToSummaries(qSessions.sessions, timezone), [qSessions.sessions, timezone]);
    const summaryMap = useMemo(() => { const m = new Map<string, DaySummary>(); for (const s of summaries) m.set(s.date, s); return m; }, [summaries]);

    const today = fmtDate(new Date());
    const periodClosed = dateRange.endDate < today;

    const handleRangeChange: RangePickerProps["onChange"] = (dates) => {
        if (dates?.[0] && dates?.[1]) setCustomRange([dates[0].toDate(), dates[1].toDate()]);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Sticky toolbar */}
            <div style={{
                display: "flex", alignItems: "center", gap: 8, padding: `${token.paddingSM}px ${token.paddingLG}px`,
                borderBottom: `1px solid ${token.colorBorderSecondary}`, position: "sticky", top: 0, background: token.colorBgContainer, zIndex: 1,
                flexWrap: "wrap",
            }}>
                {toolbarExtra}
                <Segmented
                    size="small"
                    options={[{ value: "bar", icon: <BarChartOutlined /> }, { value: "table", icon: <UnorderedListOutlined /> }]}
                    value={displayMode}
                    onChange={(v) => setDisplayMode(v as DisplayMode)}
                />
                <div style={{ width: 1, height: 20, background: token.colorBorderSecondary }} />
                <Segmented
                    size="small"
                    options={VIEW_OPTIONS as unknown as string[]}
                    value={VIEW_REVERSE[period]}
                    onChange={(v) => setPeriod(VIEW_MAP[v as string]!)}
                />
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                    {period === "custom" ? (
                        <RangePicker size="small" value={customRange ? [dayjs(customRange[0]), dayjs(customRange[1])] : undefined} onChange={handleRangeChange} />
                    ) : (
                        <>
                            <Button size="small" type="text" icon={<LeftOutlined />} onClick={() => setRefDate(navigateDate(period, refDate, "prev"))} />
                            <Text strong style={{ minWidth: 160, textAlign: "center", fontSize: 12 }}>{dateRange.label}</Text>
                            <Button size="small" type="text" icon={<RightOutlined />} onClick={() => setRefDate(navigateDate(period, refDate, "next"))} />
                            <Button size="small" onClick={() => setRefDate(new Date())}>Today</Button>
                        </>
                    )}
                    <Tag color={periodClosed ? "default" : "processing"}>{periodClosed ? "Closed" : "In Progress"}</Tag>
                </div>
            </div>

            {/* Content */}
            <div style={{ padding: token.paddingLG, position: "relative", zIndex: 0, flex: 1 }}>
                {/* Day bar view */}
                {displayMode === "bar" && period === "day" && (
                    <DayBarView day={days[0]!} summary={summaryMap.get(dateRange.startDate)} timezone={timezone} />
                )}

                {/* Week bar view */}
                {displayMode === "bar" && period === "week" && (
                    <div>
                        <App_TimeclockLegend />
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {days.map((d) => <DayBarRow key={fmtDate(d)} day={d} summary={summaryMap.get(fmtDate(d))} timezone={timezone} />)}
                        </div>
                    </div>
                )}

                {/* Month/Cycle/Custom bar view */}
                {displayMode === "bar" && (period === "month" || period === "cycle" || period === "custom") && (
                    <div>
                        <App_TimeclockLegend />
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 16px" }}>
                                <div style={{ width: 100, fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>Day</div>
                                <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>Timeline</div>
                                <div style={{ width: 70, textAlign: "right", fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>Worked</div>
                                <div style={{ width: 70, textAlign: "right", fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>Breaks</div>
                            </div>
                            {days.map((d) => <DayCompactRow key={fmtDate(d)} day={d} summary={summaryMap.get(fmtDate(d))} timezone={timezone} />)}
                        </div>
                    </div>
                )}

                {/* Table view */}
                {displayMode === "table" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {days.map((d) => <DayTableCard key={fmtDate(d)} day={d} summary={summaryMap.get(fmtDate(d))} />)}
                    </div>
                )}
            </div>
        </div>
    );
};

// --- Sub-components ---

const DayBarView = ({ day, summary, timezone }: { day: Date; summary?: DaySummary; timezone: string }) => {
    const { token } = theme.useToken();
    const td = isToday(day);
    const sessions = summary?.sessions ?? [];
    return (
        <div>
            <App_TimeclockLegend />
            <div style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, padding: token.paddingLG, marginBottom: token.marginMD }}>
                <div style={{ paddingTop: 14, paddingBottom: 14 }}>
                    <App_TimeclockBar24 sessions={sessions} timezone={timezone} showNow={td} showHourLabels />
                </div>
                <div style={{ display: "flex", gap: 24, marginTop: token.marginMD }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 3, background: TIMECLOCK_COLORS.work.solid }} />
                        Worked <strong style={{ fontSize: 15, marginLeft: 2 }}>{summary ? formatDuration(summary.workedMs) : "0.00h"}</strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 3, background: TIMECLOCK_COLORS.lunch.text }} />
                        Break <strong style={{ fontSize: 15, marginLeft: 2 }}>{summary ? formatDuration(summary.breakMs) : "0.00h"}</strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 3, background: token.colorFillAlter, border: `1px solid ${token.colorBorder}` }} />
                        To 8h <strong style={{ fontSize: 15, marginLeft: 2 }}>{summary ? formatDuration(Math.max(0, 8 * 3600000 - summary.workedMs)) : "8.00h"}</strong>
                    </div>
                    <ActiveIndicator summary={summary} />
                </div>
            </div>
            {(summary?.timeline ?? []).length > 0 && (
                <div style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, overflow: "hidden" }}>
                    {(summary?.timeline ?? []).map((entry, i, arr) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 20px", borderBottom: i < arr.length - 1 ? `1px solid ${token.colorFillAlter}` : undefined }}>
                            <App_TimeclockEventDot eventType={entry.eventType} pulse={entry.isActive} />
                            <div style={{ fontWeight: 600, width: 46, fontSize: 14, color: entry.isActive ? TIMECLOCK_COLORS.work.solid : token.colorText }}>{entry.time}</div>
                            <div style={{ flex: 1, color: entry.isActive ? TIMECLOCK_COLORS.work.solid : token.colorTextSecondary, fontSize: 13, fontWeight: entry.isActive ? 600 : 400 }}>
                                {entry.label}
                            </div>
                            {entry.elapsed !== null && entry.elapsed > 0 && (
                                <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{formatDuration(entry.elapsed)}</div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const TimelineDetail = ({ timeline, token }: { timeline: TimelineEntry[]; token: any }) => (
    <div style={{ borderTop: `1px solid ${token.colorFillAlter}`, padding: "4px 0" }}>
        {timeline.map((entry, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "6px 20px", fontSize: 13 }}>
                <App_TimeclockEventDot eventType={entry.eventType} pulse={entry.isActive} />
                <div style={{ fontWeight: 600, width: 46, fontSize: 13, color: entry.isActive ? TIMECLOCK_COLORS.work.solid : token.colorText }}>{entry.time}</div>
                <div style={{ flex: 1, color: entry.isActive ? TIMECLOCK_COLORS.work.solid : token.colorTextSecondary, fontSize: 13, fontWeight: entry.isActive ? 600 : 400 }}>
                    {entry.label}
                </div>
                {entry.elapsed !== null && entry.elapsed > 0 && (
                    <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{formatDuration(entry.elapsed)}</div>
                )}
            </div>
        ))}
    </div>
);

const DayBarRow = ({ day, summary, timezone }: { day: Date; summary?: DaySummary; timezone: string }) => {
    const { token } = theme.useToken();
    const [expanded, setExpanded] = useState(false);
    const td = isToday(day);
    const future = isFuture(day);
    const wknd = isWeekend(day);
    const timeline = summary?.timeline ?? [];
    const canExpand = !wknd && !future && timeline.length > 0;
    return (
        <div style={{
            background: td ? "#eef2ff" : token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusSM, borderLeft: td ? "3px solid #6366f1" : undefined,
            opacity: future ? 0.35 : wknd ? 0.3 : 1, overflow: "hidden",
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px" }}>
                <div style={{ width: 80, flexShrink: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day.getDay()]}
                        {td && <Tag color="processing" style={{ marginLeft: 4, fontSize: 9 }}>Today</Tag>}
                    </div>
                    <div style={{ fontSize: 10, color: token.colorTextQuaternary }}>{formatDayLabel(day).split(", ")[1]}</div>
                </div>
                <div style={{ flex: 1, paddingTop: 14, paddingBottom: 14 }}>
                    {wknd ? <div style={{ color: token.colorTextQuaternary, fontSize: 11, textAlign: "center" }}>Off</div>
                        : <App_TimeclockBar24 sessions={summary?.sessions ?? []} timezone={timezone} showNow={td} showHourLabels />}
                </div>
                <div style={{ width: 90, textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: summary && summary.workedMs > 0 ? TIMECLOCK_COLORS.work.solid : token.colorTextQuaternary }}>
                        {wknd || !summary || summary.workedMs === 0 ? "—" : formatDuration(summary.workedMs)}
                    </span>
                    <ActiveIndicator summary={summary} />
                </div>
            </div>
            {canExpand && (
                <div style={{ display: "flex", justifyContent: "center", padding: "0 0 4px" }}>
                    <Button type="text" size="small" icon={expanded ? <UpOutlined /> : <DownOutlined />}
                        onClick={() => setExpanded(!expanded)}
                        style={{ fontSize: 10, color: token.colorTextQuaternary, height: 18, width: 36 }}
                    />
                </div>
            )}
            {expanded && <TimelineDetail timeline={timeline} token={token} />}
        </div>
    );
};

const DayCompactRow = ({ day, summary, timezone }: { day: Date; summary?: DaySummary; timezone: string }) => {
    const { token } = theme.useToken();
    const [expanded, setExpanded] = useState(false);
    const td = isToday(day);
    const future = isFuture(day);
    const wknd = isWeekend(day);
    const timeline = summary?.timeline ?? [];
    const canExpand = !wknd && !future && timeline.length > 0;
    return (
        <div style={{
            background: td ? "#eef2ff" : token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusSM, borderLeft: td ? "3px solid #6366f1" : undefined,
            opacity: future ? 0.35 : wknd ? 0.3 : 1, overflow: "hidden",
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px" }}>
                <div style={{ width: 100, flexShrink: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day.getDay()]}
                        {td && <Tag color="processing" style={{ marginLeft: 4, fontSize: 9 }}>Today</Tag>}
                    </div>
                    <div style={{ fontSize: 11, color: token.colorTextQuaternary }}>{formatDayLabel(day).split(", ")[1]}</div>
                </div>
                <div style={{ flex: 1, paddingTop: 14, paddingBottom: 14 }}>
                    {wknd ? <div style={{ color: token.colorTextQuaternary, fontSize: 11, textAlign: "center" }}>Off</div>
                        : <App_TimeclockBar24 sessions={summary?.sessions ?? []} timezone={timezone} showNow={td} showHourLabels />}
                </div>
                <div style={{ width: 70, textAlign: "right", fontWeight: 600, fontSize: 13, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    <span style={{ color: summary && summary.workedMs > 0 ? TIMECLOCK_COLORS.work.solid : token.colorTextQuaternary }}>
                        {wknd || !summary || summary.workedMs === 0 ? "—" : formatDuration(summary.workedMs)}
                    </span>
                    <ActiveIndicator summary={summary} />
                </div>
                <div style={{ width: 70, textAlign: "right", fontSize: 13, flexShrink: 0, color: token.colorTextSecondary }}>
                    {wknd || !summary || summary.breakMs === 0 ? "—" : formatDuration(summary.breakMs)}
                </div>
            </div>
            {canExpand && (
                <div style={{ display: "flex", justifyContent: "center", padding: "0 0 4px" }}>
                    <Button type="text" size="small" icon={expanded ? <UpOutlined /> : <DownOutlined />}
                        onClick={() => setExpanded(!expanded)}
                        style={{ fontSize: 10, color: token.colorTextQuaternary, height: 18, width: 36 }}
                    />
                </div>
            )}
            {expanded && <TimelineDetail timeline={timeline} token={token} />}
        </div>
    );
};

const DayTableCard = ({ day, summary }: { day: Date; summary?: DaySummary }) => {
    const { token } = theme.useToken();
    const td = isToday(day);
    const future = isFuture(day);
    const wknd = isWeekend(day);
    const timeline = summary?.timeline ?? [];

    if (wknd) {
        return (
            <div style={{ display: "flex", alignItems: "center", padding: "6px 14px", opacity: 0.3, fontSize: 12, color: token.colorTextQuaternary }}>
                <span style={{ width: 120, fontWeight: 600 }}>{formatDayLabel(day)}</span><span>Off</span>
            </div>
        );
    }
    if (future || timeline.length === 0) {
        return (
            <div style={{ display: "flex", alignItems: "center", padding: "6px 14px", opacity: future ? 0.3 : 0.6, fontSize: 12, color: token.colorTextQuaternary }}>
                <span style={{ width: 120, fontWeight: 600 }}>{formatDayLabel(day)}</span><span>—</span>
            </div>
        );
    }
    return (
        <div style={{
            border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusSM,
            background: td ? "#eef2ff" : token.colorBgContainer,
            borderLeft: td ? "3px solid #6366f1" : undefined, marginBottom: 4,
        }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: `1px solid ${token.colorFillAlter}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Text strong style={{ fontSize: 13 }}>{formatDayLabel(day)}</Text>
                    {td && <Tag color="processing" style={{ fontSize: 9 }}>Today</Tag>}
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                    {summary && summary.workedMs > 0 && <span style={{ color: TIMECLOCK_COLORS.work.solid, fontWeight: 600 }}>Worked: {formatDuration(summary.workedMs)}</span>}
                    {summary && summary.breakMs > 0 && <span style={{ color: TIMECLOCK_COLORS.lunch.text, fontWeight: 600 }}>Break: {formatDuration(summary.breakMs)}</span>}
                </div>
            </div>
            <div style={{ padding: "4px 0" }}>
                {timeline.map((entry, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 14px", fontSize: 13 }}>
                        <App_TimeclockEventDot eventType={entry.eventType} pulse={entry.isActive} />
                        <span style={{ fontWeight: 600, width: 45, fontVariantNumeric: "tabular-nums", color: entry.isActive ? TIMECLOCK_COLORS.work.solid : token.colorText }}>{entry.time}</span>
                        <span style={{ color: entry.isActive ? TIMECLOCK_COLORS.work.solid : token.colorTextSecondary, fontWeight: entry.isActive ? 600 : 400, flex: 1 }}>{entry.label}</span>
                        {entry.elapsed !== null && entry.elapsed > 0 && <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>{formatDuration(entry.elapsed)}</span>}
                    </div>
                ))}
            </div>
        </div>
    );
};
