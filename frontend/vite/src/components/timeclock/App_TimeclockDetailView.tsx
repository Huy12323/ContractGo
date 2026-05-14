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

type DisplayMode = "bar" | "table";

export type BarSession = {
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

export type DaySummary = {
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
export type CorrectionTaskEntry = { status: string; message: string | null; proposedSessions?: BarSession[] };
type CorrectionTaskMap = Map<string, CorrectionTaskEntry[]>;

type Props = {
    employeeId: string;
    timezone: string;
    initialPeriod?: ViewMode;
    toolbarExtra?: React.ReactNode;
    onDayClick?: (day: Date, summary: DaySummary | undefined) => void;
    correctionTasksByDate?: CorrectionTaskMap;
};

export const App_TimeclockDetailView = ({ employeeId, timezone, initialPeriod = "week", toolbarExtra, onDayClick, correctionTasksByDate }: Props) => {
    const { token } = theme.useToken();
    const [displayMode, setDisplayMode] = useState<DisplayMode>("bar");
    const [period, setPeriod] = useState<ViewMode>(initialPeriod);
    const [refDate, setRefDate] = useState(new Date());
    const [customRange, setCustomRange] = useState<[Date, Date] | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
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

    const currentCycleRange = useMemo(() => getDateRange("cycle", new Date()), []);

    const rangePresets: RangePickerProps["presets"] = [
        { label: "Day", value: [dayjs(), dayjs()] },
        { label: "Week", value: [dayjs().startOf("week"), dayjs().endOf("week")] },
        { label: "Month", value: [dayjs().startOf("month"), dayjs().endOf("month")] },
        { label: "Cycle", value: [dayjs(currentCycleRange.startDate), dayjs(currentCycleRange.endDate)] },
    ];

    const handleRangeChange: RangePickerProps["onChange"] = (dates) => {
        if (!dates?.[0] || !dates?.[1]) return;
        const start = dates[0];
        const end = dates[1];
        const diffDays = end.diff(start, "day");
        if (diffDays === 0) { setPeriod("day"); setCustomRange(null); }
        else if (diffDays === 6) { setPeriod("week"); setCustomRange(null); }
        else if (start.date() === 1 && end.date() === end.daysInMonth()) { setPeriod("month"); setCustomRange(null); }
        else { setPeriod("custom"); setCustomRange([start.toDate(), end.toDate()]); }
        setRefDate(start.toDate());
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Sticky toolbar */}
            <div style={{
                display: "flex", alignItems: "center", padding: `${token.paddingSM}px ${token.paddingLG}px`,
                borderBottom: `1px solid ${token.colorBorderSecondary}`, position: "sticky", top: 0, background: token.colorBgContainer, zIndex: 1,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative", zIndex: 1 }}>
                    {toolbarExtra}
                    <Segmented
                        size="small"
                        options={[{ value: "bar", icon: <BarChartOutlined /> }, { value: "table", icon: <UnorderedListOutlined /> }]}
                        value={displayMode}
                        onChange={(v) => setDisplayMode(v as DisplayMode)}
                    />
                </div>
                <div style={{ position: "absolute", left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, pointerEvents: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, pointerEvents: "auto" }}>
                        <Button size="small" type="text" icon={<LeftOutlined />} onClick={() => setRefDate(navigateDate(period, refDate, "prev"))} />
                        <Button size="small" onClick={() => setPickerOpen(true)}>
                            {period.charAt(0).toUpperCase() + period.slice(1)}
                        </Button>
                        <RangePicker
                            size="small"
                            open={pickerOpen}
                            onOpenChange={setPickerOpen}
                            value={[dayjs(dateRange.startDate), dayjs(dateRange.endDate)]}
                            onChange={(dates, dateStrings) => { handleRangeChange(dates, dateStrings); setPickerOpen(false); }}
                            presets={rangePresets}
                            allowClear={false}
                            separator="–"
                            format="DD/MM/YYYY"
                        />
                        <Button size="small" type="text" icon={<RightOutlined />} onClick={() => setRefDate(navigateDate(period, refDate, "next"))} />
                        <Button size="small" onClick={() => setRefDate(new Date())}>Today</Button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div style={{ padding: token.paddingLG, position: "relative", zIndex: 0, flex: 1 }}>
                {/* Bar views — unified DayRow for all periods */}
                {displayMode === "bar" && (
                    <div>
                        <App_TimeclockLegend />
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 14px" }}>
                                <div style={{ width: 80, fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>Day</div>
                                <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>Timeline</div>
                                <div style={{ width: 70, textAlign: "right", fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>Worked</div>
                                <div style={{ width: 70, textAlign: "right", fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>Breaks</div>
                            </div>
                            {days.map((d) => {
                                const dateStr = fmtDate(d);
                                return (
                                    <DayRow
                                        key={dateStr}
                                        day={d}
                                        summary={summaryMap.get(dateStr)}
                                        timezone={timezone}
                                        onDayClick={onDayClick}
                                        correctionEntries={correctionTasksByDate?.get(dateStr)}
                                        timelineMode={period === "day" ? "expanded" : "collapsible"}
                                    />
                                );
                            })}
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

const CORRECTION_LABELS: Record<string, { color: string; text: string }> = {
    pending: { color: "#fa8c16", text: "Pending Correction" },
    approved: { color: "#52c41a", text: "Approved Correction" },
    rejected: { color: "#ff4d4f", text: "Rejected Correction" },
    cancelled: { color: "#8c8c8c", text: "Cancelled Correction" },
};

const CorrectionBanner = ({ entries }: { entries: CorrectionTaskEntry[] }) => {
    const visible = entries.filter((e) => e.status !== "cancelled");
    const top = visible.find((e) => e.status === "pending") ?? visible[0];
    if (!top) return null;
    const info = CORRECTION_LABELS[top.status] ?? CORRECTION_LABELS.pending!;
    const count = visible.length;
    return (
        <div style={{ fontSize: 10, fontWeight: 600, color: info.color, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: info.color, flexShrink: 0 }} />
            {info.text}{count > 1 ? ` (+${count - 1})` : ""}
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

const DayRow = ({ day, summary, timezone, onDayClick, correctionEntries, timelineMode = "collapsible" }: {
    day: Date; summary?: DaySummary; timezone: string;
    onDayClick?: (day: Date, summary: DaySummary | undefined) => void;
    correctionEntries?: CorrectionTaskEntry[];
    timelineMode?: "expanded" | "collapsible";
}) => {
    const { token } = theme.useToken();
    const [expanded, setExpanded] = useState(false);
    const td = isToday(day);
    const future = isFuture(day);
    const wknd = isWeekend(day);
    const timeline = summary?.timeline ?? [];
    const canExpand = !wknd && !future && timeline.length > 0;
    const pending = correctionEntries?.find((e) => e.status === "pending");
    const nonPending = correctionEntries?.filter((e) => e.status !== "pending");
    const showTimeline = timelineMode === "expanded" ? canExpand : expanded;

    return (
        <div
            onClick={() => !wknd && !future && onDayClick?.(day, summary)}
            style={{
                background: td ? "#eef2ff" : token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusSM, borderLeft: td ? "3px solid #6366f1" : undefined,
                opacity: future ? 0.35 : wknd ? 0.3 : 1, overflow: "hidden",
                cursor: !wknd && !future && onDayClick ? "pointer" : undefined,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px" }}>
                <div style={{ width: 80, flexShrink: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day.getDay()]}
                        {td && <Tag color="processing" style={{ marginLeft: 4, fontSize: 9 }}>Today</Tag>}
                    </div>
                    <div style={{ fontSize: 10, color: token.colorTextQuaternary }}>{formatDayLabel(day).split(", ")[1]}</div>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: pending ? 4 : 0 }}>
                    <div style={{ paddingTop: 14, paddingBottom: pending ? 4 : 14 }}>
                        {wknd ? <div style={{ color: token.colorTextQuaternary, fontSize: 11, textAlign: "center" }}>Off</div>
                            : <App_TimeclockBar24 sessions={summary?.sessions ?? []} timezone={timezone} showNow={td} showHourLabels />}
                    </div>
                    {pending?.proposedSessions && (
                        <div style={{
                            marginTop: 8, marginLeft: -6, marginRight: -6,
                            border: "1px dashed #fa8c16", borderRadius: token.borderRadiusSM,
                            padding: "4px 6px 14px",
                            background: "rgba(250, 140, 22, 0.04)",
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                                <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fa8c16" }} />
                                <span style={{ fontSize: 9, color: "#fa8c16", fontWeight: 600 }}>Pending Correction</span>
                            </div>
                            <App_TimeclockBar24 sessions={pending.proposedSessions} timezone={timezone} />
                        </div>
                    )}
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
                {nonPending && nonPending.length > 0 && <CorrectionBanner entries={nonPending} />}
            </div>
            {timelineMode === "collapsible" && canExpand && (
                <div style={{ display: "flex", justifyContent: "center", padding: "0 0 4px" }}>
                    <Button type="text" size="small" icon={expanded ? <UpOutlined /> : <DownOutlined />}
                        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                        style={{ fontSize: 10, color: token.colorTextQuaternary, height: 18, width: 36 }}
                    />
                </div>
            )}
            {showTimeline && <TimelineDetail timeline={timeline} token={token} />}
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
