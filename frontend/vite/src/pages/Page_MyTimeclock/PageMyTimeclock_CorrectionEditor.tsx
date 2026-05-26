import { useState, useMemo, useRef, useCallback, useImperativeHandle, forwardRef, useEffect } from "react";
import { Button, Radio, TimePicker, Typography, theme } from "antd";
import { DeleteOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { App_TimeclockBar24 } from "@/components/timeclock/App_TimeclockBar24";
import { App_TimeclockEventDot } from "@/components/timeclock/App_TimeclockEventDot";
import { TIMECLOCK_COLORS } from "@/utils/timeclock/const_Timeclock_Colors";
import { formatDuration } from "@/utils/timeclock/utils_Timeclock_AggregateEvents";
import type { TimeclockSession } from "@/utils/timeclock/utils_Timeclock_AggregateEvents";
import type { TimeclockSession as RawSession } from "@/hooks/useQ_Tables_TimeclockEvents";
import type { CorrectionEntry } from "@/hooks/useM_PageMyTimeclock_CorrectionTaskCreate";
import type { PageMyTimeclock_MyCorrectionTasks_QueryData } from "@/hooks/useQ_PageMyTimeclock_MyCorrectionTasks";

export type CorrectionEditorHandle = {
    buildEntries: () => CorrectionEntry[];
    hasChanges: boolean;
};

const { Text } = Typography;

type Segment = { id: string; type: "work" | "break"; startMinute: number; endMinute: number };
type InteractionMode = "idle" | "creating" | "resizing-start" | "resizing-end" | "moving";

const SNAP = 1;
const MIN_SEGMENT = 1;
const CLICK_THRESHOLD = 10;
const BAR_HEIGHT = 44;
const HOUR_TICKS = Array.from({ length: 24 }, (_, i) => i);

const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
let segCounter = 0;

const isoToMinute = (iso: string, tz: string): number => {
    try {
        const p = new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).split(":");
        return parseInt(p[0]!) * 60 + parseInt(p[1]!);
    } catch { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }
};

const minuteToUtcIso = (dayDate: string, minutes: number, tz: string): string => {
    const h = String(Math.floor(minutes / 60)).padStart(2, "0");
    const m = String(minutes % 60).padStart(2, "0");
    const asUtc = new Date(`${dayDate}T${h}:${m}:00Z`);
    const utcStr = asUtc.toLocaleString("en-US", { timeZone: "UTC" });
    const localStr = asUtc.toLocaleString("en-US", { timeZone: tz });
    const offset = new Date(utcStr).getTime() - new Date(localStr).getTime();
    return new Date(asUtc.getTime() + offset).toISOString();
};

const findWorkAt = (minute: number, segs: Segment[]): Segment | undefined =>
    segs.find((s) => s.type === "work" && minute >= s.startMinute && minute < s.endMinute);

const sameTypeOverlaps = (seg: Segment, segs: Segment[]): boolean =>
    segs.some((s) => s.id !== seg.id && s.type === seg.type && seg.startMinute < s.endMinute && seg.endMinute > s.startMinute);

const breakInsideWork = (brk: Segment, segs: Segment[]): boolean =>
    segs.some((s) => s.type === "work" && s.id !== brk.id && brk.startMinute >= s.startMinute && brk.endMinute <= s.endMinute);

type TimelineEntry = { time: string; label: string; eventType: string };

const EVENT_ORDER: Record<string, number> = { clock_in: 0, lunch_end: 1, lunch_start: 2, clock_out: 3 };

const segmentsToTimeline = (segs: Segment[]): TimelineEntry[] => {
    const sorted = [...segs].sort((a, b) => a.startMinute - b.startMinute);
    const entries: TimelineEntry[] = [];
    for (const s of sorted) {
        if (s.type === "work") {
            entries.push({ time: fmtMin(s.startMinute), label: "Clock In", eventType: "clock_in" });
            entries.push({ time: fmtMin(s.endMinute), label: "Clock Out", eventType: "clock_out" });
        } else {
            entries.push({ time: fmtMin(s.startMinute), label: "Break", eventType: "lunch_start" });
            entries.push({ time: fmtMin(s.endMinute), label: "Back to Work", eventType: "lunch_end" });
        }
    }
    entries.sort((a, b) => a.time.localeCompare(b.time) || (EVENT_ORDER[a.eventType] ?? 0) - (EVENT_ORDER[b.eventType] ?? 0));
    return entries;
};

type PendingTask = PageMyTimeclock_MyCorrectionTasks_QueryData[number];

type Props = {
    sessions: TimeclockSession[];
    rawSessions: RawSession[];
    dayDate: string;
    timezone: string;
    pendingTask?: PendingTask | null;
    onHasChanges?: (status: { hasSegments: boolean; isDirty: boolean }) => void;
};

export const PageMyTimeclock_CorrectionEditor = forwardRef<CorrectionEditorHandle, Props>(({
    sessions, rawSessions, dayDate, timezone, pendingTask, onHasChanges,
}, ref) => {
    const { token } = theme.useToken();
    const barRef = useRef<HTMLDivElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const isEditMode = !!pendingTask;

    // Drag state kept in refs — no re-renders during drag
    const dragMode = useRef<InteractionMode>("idle");
    const dragSegId = useRef<string | null>(null);
    const dragStartMin = useRef(0);
    const dragCurrentMin = useRef(0);
    const dragGrabOffset = useRef(0);
    const dragSegSnapshot = useRef<Segment | null>(null);

    const initialSegments = useMemo((): Segment[] =>
        sessions.map((s) => ({
            id: `s${++segCounter}`,
            type: (s.type === "lunch" ? "break" : "work") as "work" | "break",
            startMinute: isoToMinute(s.startAt, timezone),
            endMinute: s.endAt ? isoToMinute(s.endAt, timezone) : isoToMinute(new Date().toISOString(), timezone),
        })),
    [sessions, timezone]);

    const pendingSegments = useMemo((): Segment[] => {
        if (!pendingTask) return [];
        const corrections = (pendingTask.timeclock_corrections ?? []) as { type: string; start_at: string; end_at: string; duration_ms: number; session_id: string | null }[];
        return corrections
            .filter((c) => c.session_id === null && c.duration_ms > 0)
            .map((c) => ({
                id: `p${++segCounter}`,
                type: (c.type === "break" ? "break" : "work") as "work" | "break",
                startMinute: isoToMinute(c.start_at, timezone),
                endMinute: isoToMinute(c.end_at, timezone),
            }));
    }, [pendingTask, timezone]);

    const [segments, setSegments] = useState<Segment[]>(() => isEditMode ? pendingSegments : []);
    const [tool, setTool] = useState<"work" | "break" | null>(isEditMode ? null : "work");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [, forceRender] = useState(0);
    const [validationError, setValidationError] = useState<string | null>(null);
    const segmentsRef = useRef(segments);
    segmentsRef.current = segments;

    const posToMinute = useCallback((clientX: number): number => {
        if (!barRef.current) return 0;
        const rect = barRef.current.getBoundingClientRect();
        return snap(clamp(Math.round(((clientX - rect.left) / rect.width) * 1440), 0, 1440));
    }, []);

    const workSegs = useMemo(() => [...segments.filter((s) => s.type === "work")].sort((a, b) => a.startMinute - b.startMinute), [segments]);
    const breakSegs = useMemo(() => segments.filter((s) => s.type === "break"), [segments]);
    const workedMs = useMemo(() => workSegs.reduce((a, s) => a + (s.endMinute - s.startMinute) * 60000, 0), [workSegs]);
    const breakMs = useMemo(() => breakSegs.reduce((a, s) => a + (s.endMinute - s.startMinute) * 60000, 0), [breakSegs]);
    const proposedTimeline = useMemo(() => segmentsToTimeline(segments), [segments]);
    const originalTimeline = useMemo(() => segmentsToTimeline(initialSegments), [initialSegments]);
    const selected = selectedId ? segments.find((s) => s.id === selectedId) ?? null : null;

    const segmentStatus = useMemo(() => {
        const hasSegments = segments.length > 0;
        let isDirty: boolean;
        if (segments.length !== pendingSegments.length) {
            isDirty = segments.length > 0 || pendingSegments.length > 0;
        } else {
            const sorted = [...segments].sort((a, b) => a.startMinute - b.startMinute || a.type.localeCompare(b.type));
            const initial = [...pendingSegments].sort((a, b) => a.startMinute - b.startMinute || a.type.localeCompare(b.type));
            isDirty = sorted.some((s, i) => {
                const p = initial[i]!;
                return s.type !== p.type || s.startMinute !== p.startMinute || s.endMinute !== p.endMinute;
            });
        }
        return { hasSegments, isDirty };
    }, [segments, pendingSegments]);

    const hasChanges = segmentStatus.hasSegments && (isEditMode ? segmentStatus.isDirty : true);

    useEffect(() => { onHasChanges?.({ hasSegments: segmentStatus.hasSegments, isDirty: segmentStatus.isDirty }); }, [segmentStatus, onHasChanges]);

    useEffect(() => {
        if (!validationError) return;
        const timer = setTimeout(() => setValidationError(null), 4000);
        return () => clearTimeout(timer);
    }, [validationError]);

    const tryUpdate = useCallback((id: string, updates: Partial<Segment>) => {
        const prev = segmentsRef.current;
        const idx = prev.findIndex((s) => s.id === id);
        if (idx === -1) return;
        const candidate = { ...prev[idx]!, ...updates };
        candidate.startMinute = clamp(candidate.startMinute, 0, 1440);
        candidate.endMinute = clamp(candidate.endMinute, 0, 1440);
        if (candidate.endMinute - candidate.startMinute < MIN_SEGMENT) {
            setValidationError("Segment must be at least 1 minute long");
            return;
        }
        const others = prev.filter((_, i) => i !== idx);
        if (sameTypeOverlaps(candidate, others)) {
            setValidationError(candidate.type === "work" ? "Work sessions cannot overlap each other" : "Breaks cannot overlap each other");
            return;
        }
        if (candidate.type === "break" && !breakInsideWork(candidate, [...others, candidate])) {
            setValidationError("Break must be fully within a work session");
            return;
        }
        if (candidate.type === "work") {
            const innerBreaks = others.filter((s) => s.type === "break" && s.startMinute >= prev[idx]!.startMinute && s.endMinute <= prev[idx]!.endMinute);
            for (const b of innerBreaks) {
                if (candidate.startMinute > b.startMinute || candidate.endMinute < b.endMinute) {
                    setValidationError("Work session must cover all its breaks");
                    return;
                }
            }
        }
        setValidationError(null);
        setSegments([...others.slice(0, idx), candidate, ...others.slice(idx)]);
    }, []);

    // --- Direct DOM manipulation during drag ---
    const updatePreviewDOM = useCallback(() => {
        if (!previewRef.current) return;
        const mode = dragMode.current;
        if (mode === "creating") {
            const s = Math.min(dragStartMin.current, dragCurrentMin.current);
            const e = Math.max(dragStartMin.current, dragCurrentMin.current);
            if (e - s >= MIN_SEGMENT) {
                previewRef.current.style.display = "block";
                previewRef.current.style.left = `${(s / 1440) * 100}%`;
                previewRef.current.style.width = `${((e - s) / 1440) * 100}%`;
            } else {
                previewRef.current.style.display = "none";
            }
        }
    }, []);

    const updateTooltipDOM = useCallback((clientX: number, clientY: number) => {
        if (!tooltipRef.current) return;
        const mode = dragMode.current;
        if (mode === "creating") {
            const s = Math.min(dragStartMin.current, dragCurrentMin.current);
            const e = Math.max(dragStartMin.current, dragCurrentMin.current);
            if (e - s >= MIN_SEGMENT) {
                tooltipRef.current.style.display = "block";
                tooltipRef.current.style.left = `${clientX}px`;
                tooltipRef.current.style.top = `${clientY - 32}px`;
                tooltipRef.current.textContent = `${fmtMin(s)} — ${fmtMin(e)}`;
            } else {
                tooltipRef.current.style.display = "none";
            }
        } else {
            tooltipRef.current.style.display = "none";
        }
    }, []);

    // --- Native event listeners for drag (bypass React) ---
    useEffect(() => {
        const bar = barRef.current;
        if (!bar) return;

        const onMove = (e: MouseEvent) => {
            const mode = dragMode.current;
            if (mode === "idle") return;
            const minute = posToMinute(e.clientX);
            dragCurrentMin.current = minute;

            if (mode === "creating") {
                updatePreviewDOM();
                updateTooltipDOM(e.clientX, e.clientY);
            } else if (mode === "resizing-start" || mode === "resizing-end") {
                const segId = dragSegId.current;
                if (!segId) return;
                setSegments((prev) => {
                    const idx = prev.findIndex((s) => s.id === segId);
                    if (idx === -1) return prev;
                    const seg = prev[idx]!;
                    const others = prev.filter((_, i) => i !== idx);

                    if (mode === "resizing-start") {
                        let lo = 0, hi = seg.endMinute - MIN_SEGMENT;
                        for (const s of others) { if (s.type === seg.type && s.endMinute <= seg.startMinute) lo = Math.max(lo, s.endMinute); }
                        if (seg.type === "work") {
                            const ib = others.filter((s) => s.type === "break" && s.startMinute >= seg.startMinute && s.endMinute <= seg.endMinute);
                            if (ib.length > 0) hi = Math.min(hi, Math.min(...ib.map((s) => s.startMinute)));
                        }
                        if (seg.type === "break") {
                            const pw = others.find((s) => s.type === "work" && seg.startMinute >= s.startMinute && seg.endMinute <= s.endMinute);
                            if (pw) lo = Math.max(lo, pw.startMinute);
                        }
                        const v = clamp(minute, lo, hi);
                        if (v === seg.startMinute) return prev;
                        return [...others.slice(0, idx), { ...seg, startMinute: v }, ...others.slice(idx)];
                    } else {
                        let lo = seg.startMinute + MIN_SEGMENT, hi = 1440;
                        for (const s of others) { if (s.type === seg.type && s.startMinute >= seg.endMinute) hi = Math.min(hi, s.startMinute); }
                        if (seg.type === "work") {
                            const ib = others.filter((s) => s.type === "break" && s.startMinute >= seg.startMinute && s.endMinute <= seg.endMinute);
                            if (ib.length > 0) lo = Math.max(lo, Math.max(...ib.map((s) => s.endMinute)));
                        }
                        if (seg.type === "break") {
                            const pw = others.find((s) => s.type === "work" && seg.startMinute >= s.startMinute && seg.endMinute <= s.endMinute);
                            if (pw) hi = Math.min(hi, pw.endMinute);
                        }
                        const v = clamp(minute, lo, hi);
                        if (v === seg.endMinute) return prev;
                        return [...others.slice(0, idx), { ...seg, endMinute: v }, ...others.slice(idx)];
                    }
                });
            } else if (mode === "moving") {
                const snap_ = dragSegSnapshot.current;
                if (!snap_ || !dragSegId.current) return;
                const duration = snap_.endMinute - snap_.startMinute;
                const rawStart = snap(minute - dragGrabOffset.current);

                setSegments((prev) => {
                    const idx = prev.findIndex((s) => s.id === dragSegId.current);
                    if (idx === -1) return prev;
                    const seg = prev[idx]!;

                    const innerBreaks = seg.type === "work"
                        ? prev.filter((s) => s.type === "break" && s.startMinute >= seg.startMinute && s.endMinute <= seg.endMinute)
                        : [];
                    const innerBreakIds = new Set(innerBreaks.map((s) => s.id));

                    let lo = 0, hi = 1440 - duration;

                    const sameTypeOthers = prev.filter((s) => s.id !== seg.id && !innerBreakIds.has(s.id) && s.type === seg.type);
                    for (const s of sameTypeOthers) {
                        const sCenter = (s.startMinute + s.endMinute) / 2;
                        const segCenter = (seg.startMinute + seg.endMinute) / 2;
                        if (sCenter < segCenter) lo = Math.max(lo, s.endMinute);
                        else hi = Math.min(hi, s.startMinute - duration);
                    }

                    // Breaks stay in place and act as anchors — work can't move past them
                    if (seg.type === "work" && innerBreaks.length > 0) {
                        const leftmostBreakStart = Math.min(...innerBreaks.map((s) => s.startMinute));
                        const rightmostBreakEnd = Math.max(...innerBreaks.map((s) => s.endMinute));
                        hi = Math.min(hi, leftmostBreakStart);
                        lo = Math.max(lo, rightmostBreakEnd - duration);
                    }

                    // Break must stay inside parent work
                    if (seg.type === "break") {
                        const parentWork = prev.find((s) => s.type === "work" && seg.startMinute >= s.startMinute && seg.endMinute <= s.endMinute);
                        if (parentWork) {
                            lo = Math.max(lo, parentWork.startMinute);
                            hi = Math.min(hi, parentWork.endMinute - duration);
                        }
                    }

                    if (lo > hi) return prev;
                    const newStart = clamp(rawStart, lo, hi);
                    const delta = newStart - seg.startMinute;
                    if (delta === 0) return prev;

                    return prev.map((s) => {
                        if (s.id === dragSegId.current) {
                            return { ...s, startMinute: s.startMinute + delta, endMinute: s.endMinute + delta };
                        }
                        return s;
                    });
                });
            }
        };

        const onUp = () => {
            const mode = dragMode.current;
            if (mode === "idle") return;
            if (mode === "creating") {
                const s = Math.min(dragStartMin.current, dragCurrentMin.current);
                const e = Math.max(dragStartMin.current, dragCurrentMin.current);
                const isClick = e - s < CLICK_THRESHOLD;
                const toolVal = tool;
                if (toolVal) {
                    const newSeg: Segment = {
                        id: `n${++segCounter}`,
                        type: toolVal,
                        startMinute: clamp(isClick ? snap(dragStartMin.current) : s, 0, 1440),
                        endMinute: clamp(isClick ? snap(dragStartMin.current) + 60 : e, 0, 1440),
                    };
                    setSegments((prev) => {
                        if (newSeg.endMinute - newSeg.startMinute < MIN_SEGMENT) return prev;
                        if (sameTypeOverlaps(newSeg, prev)) return prev;
                        if (newSeg.type === "break" && !breakInsideWork(newSeg, [...prev, newSeg])) return prev;
                        return [...prev, newSeg];
                    });
                    setSelectedId(newSeg.id);
                    setTool(null);
                }
            }
            dragMode.current = "idle";
            dragSegId.current = null;
            dragSegSnapshot.current = null;
            if (previewRef.current) previewRef.current.style.display = "none";
            if (tooltipRef.current) tooltipRef.current.style.display = "none";
            forceRender((n) => n + 1);
        };

        const onLeave = () => {
            if (dragMode.current !== "idle") onUp();
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        bar.addEventListener("mouseleave", onLeave);
        return () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            bar.removeEventListener("mouseleave", onLeave);
        };
    }, [posToMinute, tool, tryUpdate, updatePreviewDOM, updateTooltipDOM]);

    // --- React mousedown handlers (start interactions) ---
    const handleBarMouseDown = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).dataset.knob || (e.target as HTMLElement).dataset.segbody) return;
        const minute = posToMinute(e.clientX);
        if (!tool) { setSelectedId(null); return; }
        if (tool === "break" && !findWorkAt(minute, segments)) return;
        e.preventDefault();
        setSelectedId(null);
        dragMode.current = "creating";
        dragStartMin.current = minute;
        dragCurrentMin.current = minute;
        if (previewRef.current) {
            previewRef.current.style.background = tool === "work" ? "rgba(99, 102, 241, 0.4)" : "rgba(199, 210, 254, 0.5)";
            previewRef.current.style.borderColor = tool === "work" ? TIMECLOCK_COLORS.work.solid : TIMECLOCK_COLORS.lunch.text;
        }
    }, [tool, segments, posToMinute]);

    const handleSegMouseDown = useCallback((e: React.MouseEvent, segId: string) => {
        e.preventDefault();
        e.stopPropagation();
        const seg = segments.find((s) => s.id === segId);
        if (!seg) return;
        if (tool === "break" && seg.type === "work") {
            const minute = posToMinute(e.clientX);
            setSelectedId(null);
            dragMode.current = "creating";
            dragStartMin.current = minute;
            dragCurrentMin.current = minute;
            if (previewRef.current) {
                previewRef.current.style.background = "rgba(199, 210, 254, 0.5)";
                previewRef.current.style.borderColor = TIMECLOCK_COLORS.lunch.text;
            }
            return;
        }
        const minute = posToMinute(e.clientX);
        if (selectedId === segId) {
            dragMode.current = "moving";
            dragSegId.current = segId;
            dragGrabOffset.current = minute - seg.startMinute;
            dragSegSnapshot.current = { ...seg };
        } else {
            setSelectedId(segId);
            setTool(null);
        }
    }, [segments, selectedId, posToMinute, tool]);

    const handleKnobMouseDown = useCallback((e: React.MouseEvent, segId: string, edge: "start" | "end") => {
        e.preventDefault();
        e.stopPropagation();
        dragMode.current = edge === "start" ? "resizing-start" : "resizing-end";
        dragSegId.current = segId;
    }, []);

    const removeWork = useCallback((workId: string) => {
        const ws = segments.find((s) => s.id === workId);
        if (!ws) return;
        setSegments((prev) => prev.filter((s) => {
            if (s.id === workId) return false;
            if (s.type === "break" && s.startMinute >= ws.startMinute && s.endMinute <= ws.endMinute) return false;
            return true;
        }));
        if (selectedId === workId) setSelectedId(null);
    }, [segments, selectedId]);

    const removeBreak = useCallback((id: string) => {
        setSegments((prev) => prev.filter((s) => s.id !== id));
        if (selectedId === id) setSelectedId(null);
    }, [selectedId]);

    const buildEntries = useCallback((): CorrectionEntry[] => {
        const entries: CorrectionEntry[] = [];
        for (const s of rawSessions) {
            entries.push({ type: s.type as "work" | "break", start_at: s.start_at, end_at: s.end_at || s.start_at, duration_ms: 0, session_id: s.id });
        }
        for (const seg of segments) {
            if (seg.endMinute <= seg.startMinute) continue;
            entries.push({
                type: seg.type,
                start_at: minuteToUtcIso(dayDate, seg.startMinute, timezone),
                end_at: minuteToUtcIso(dayDate, seg.endMinute, timezone),
                duration_ms: (seg.endMinute - seg.startMinute) * 60000,
                session_id: null,
            });
        }
        return entries;
    }, [rawSessions, segments, dayDate, timezone]);

    useImperativeHandle(ref, () => ({
        buildEntries,
        hasChanges,
    }), [buildEntries, hasChanges]);

    const handleEditorClick = useCallback(() => {
        if (tool) setTool(null);
        if (selectedId) setSelectedId(null);
    }, [tool, selectedId]);

    const barCursor = tool === "work" ? "crosshair" : tool === "break" ? "not-allowed" : "default";

    const TimeField = ({ segId, field, value }: { segId: string; field: "startMinute" | "endMinute"; value: number }) => (
        <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <TimePicker size="small" format="HH:mm" minuteStep={1} allowClear={false} needConfirm={false} showNow={false} style={{ width: 80 }}
                value={dayjs().startOf("day").add(value, "minute")}
                onChange={(v) => v && tryUpdate(segId, { [field]: v.hour() * 60 + v.minute() })}
            />
        </span>
    );

    return (
        <div onClick={handleEditorClick} style={{ display: "flex", flexDirection: "column", gap: token.marginLG }}>
            {/* Before bar */}
            <div>
                <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>Before</Text>
                <div style={{ paddingTop: 16, paddingBottom: 16 }}>
                    <App_TimeclockBar24 sessions={sessions} timezone={timezone} showHourLabels />
                </div>
            </div>

            {/* After bar (interactive) */}
            <div onClick={(e) => e.stopPropagation()}>
                <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>After</Text>
                <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: token.marginSM, marginBottom: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Tool:</Text>
                    <Radio.Group
                        value={tool}
                        onChange={(e) => { setTool(e.target.value === tool ? null : e.target.value); setSelectedId(null); }}
                        size="small" optionType="button"
                    >
                        <Radio.Button value="work" style={{ fontWeight: 600 }}>
                            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: TIMECLOCK_COLORS.work.solid, marginRight: 6, verticalAlign: "middle" }} />
                            Work
                        </Radio.Button>
                        <Radio.Button value="break" style={{ fontWeight: 600 }}>
                            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: TIMECLOCK_COLORS.lunch.solid, border: `1px solid ${token.colorBorder}`, marginRight: 6, verticalAlign: "middle" }} />
                            Break
                        </Radio.Button>
                    </Radio.Group>
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                        {tool ? `Click to place 1h ${tool}, or drag to draw` : "Click a segment to edit · Click a tool to create"}
                    </Text>
                </div>
                <div
                    ref={barRef}
                    onMouseDown={handleBarMouseDown}
                    style={{
                        position: "relative", height: BAR_HEIGHT, background: token.colorFillAlter,
                        borderRadius: token.borderRadiusSM, userSelect: "none", cursor: barCursor,
                        marginTop: 16, marginBottom: 20, marginLeft: 6, marginRight: 10,
                    }}
                >
                    {HOUR_TICKS.map((h) => (
                        <div key={h} style={{ position: "absolute", left: `${(h / 24) * 100}%`, top: 0, height: "100%", width: 1, background: token.colorBorder, opacity: 0.4, pointerEvents: "none" }} />
                    ))}

                    {workSegs.map((ws) => {
                        const left = (ws.startMinute / 1440) * 100;
                        const width = ((ws.endMinute - ws.startMinute) / 1440) * 100;
                        const isSel = ws.id === selectedId;
                        return (
                            <div key={ws.id} data-segbody="1"
                                onMouseDown={(e) => handleSegMouseDown(e, ws.id)}
                                style={{
                                    position: "absolute", left: `${left}%`, width: `${width}%`, top: 0, height: "100%",
                                    background: TIMECLOCK_COLORS.work.solid, borderRadius: token.borderRadiusSM,
                                    cursor: tool === "break" ? "crosshair" : isSel ? "grab" : "pointer", overflow: "hidden",
                                    outline: isSel ? `2px solid ${TIMECLOCK_COLORS.work.dark}` : undefined,
                                    outlineOffset: 1, zIndex: 1,
                                }}
                            >
                                {breakSegs.filter((bs) => bs.startMinute >= ws.startMinute && bs.endMinute <= ws.endMinute).map((bs) => {
                                    const bLeft = ((bs.startMinute - ws.startMinute) / (ws.endMinute - ws.startMinute)) * 100;
                                    const bWidth = ((bs.endMinute - bs.startMinute) / (ws.endMinute - ws.startMinute)) * 100;
                                    const bSel = bs.id === selectedId;
                                    return (
                                        <div key={bs.id} data-segbody="1"
                                            onMouseDown={(e) => handleSegMouseDown(e, bs.id)}
                                            style={{
                                                position: "absolute", left: `${bLeft}%`, width: `${bWidth}%`, top: 0, height: "100%",
                                                background: TIMECLOCK_COLORS.lunch.solid, cursor: bSel ? "grab" : "pointer",
                                                outline: bSel ? `2px solid ${TIMECLOCK_COLORS.lunch.text}` : undefined,
                                                outlineOffset: -1, zIndex: 2,
                                            }}
                                        />
                                    );
                                })}
                                {isSel && (
                                    <>
                                        <div data-knob="1" onMouseDown={(e) => handleKnobMouseDown(e, ws.id, "start")} style={{ position: "absolute", left: -5, top: "50%", transform: "translateY(-50%)", width: 10, height: 10, borderRadius: "50%", background: "#fff", border: `2px solid ${TIMECLOCK_COLORS.work.dark}`, cursor: "ew-resize", zIndex: 10 }} />
                                        <div data-knob="1" onMouseDown={(e) => handleKnobMouseDown(e, ws.id, "end")} style={{ position: "absolute", right: -5, top: "50%", transform: "translateY(-50%)", width: 10, height: 10, borderRadius: "50%", background: "#fff", border: `2px solid ${TIMECLOCK_COLORS.work.dark}`, cursor: "ew-resize", zIndex: 10 }} />
                                    </>
                                )}
                            </div>
                        );
                    })}

                    {selected?.type === "break" && (() => {
                        const left = (selected.startMinute / 1440) * 100;
                        const width = ((selected.endMinute - selected.startMinute) / 1440) * 100;
                        return (
                            <>
                                <div data-knob="1" onMouseDown={(e) => handleKnobMouseDown(e, selected.id, "start")} style={{ position: "absolute", left: `calc(${left}% - 5px)`, top: "50%", transform: "translateY(-50%)", width: 10, height: 10, borderRadius: "50%", background: "#fff", border: `2px solid ${TIMECLOCK_COLORS.lunch.text}`, cursor: "ew-resize", zIndex: 10 }} />
                                <div data-knob="1" onMouseDown={(e) => handleKnobMouseDown(e, selected.id, "end")} style={{ position: "absolute", left: `calc(${left + width}% - 5px)`, top: "50%", transform: "translateY(-50%)", width: 10, height: 10, borderRadius: "50%", background: "#fff", border: `2px solid ${TIMECLOCK_COLORS.lunch.text}`, cursor: "ew-resize", zIndex: 10 }} />
                            </>
                        );
                    })()}

                    {/* Creation preview — manipulated directly via ref */}
                    <div ref={previewRef} style={{
                        display: "none", position: "absolute", top: 2, height: "calc(100% - 4px)",
                        borderRadius: token.borderRadiusXS, border: "1px dashed",
                        pointerEvents: "none", zIndex: 5,
                    }} />

                    {HOUR_TICKS.map((h) => (
                        <span key={`lbl-${h}`} style={{ position: "absolute", left: `${(h / 24) * 100}%`, bottom: -14, transform: "translateX(-50%)", fontSize: 8, color: token.colorTextQuaternary, fontWeight: 500, pointerEvents: "none" }}>
                            {h}
                        </span>
                    ))}

                    {workSegs.map((ws) => (
                        <div key={`lbl-${ws.id}`} style={{ pointerEvents: "none" }}>
                            <span style={{ position: "absolute", left: `${(ws.startMinute / 1440) * 100}%`, top: -14, fontSize: 9, color: token.colorTextSecondary, fontWeight: 600, transform: "translateX(-50%)", whiteSpace: "nowrap", zIndex: 3 }}>{fmtMin(ws.startMinute)}</span>
                            <span style={{ position: "absolute", left: `${(ws.endMinute / 1440) * 100}%`, top: -14, fontSize: 9, color: token.colorTextSecondary, fontWeight: 600, transform: "translateX(-50%)", whiteSpace: "nowrap", zIndex: 3 }}>{fmtMin(ws.endMinute)}</span>
                        </div>
                    ))}
                </div>

                {/* Segment entries */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {workSegs.map((ws) => {
                        const innerBreaks = breakSegs.filter((bs) => bs.startMinute >= ws.startMinute && bs.endMinute <= ws.endMinute).sort((a, b) => a.startMinute - b.startMinute);
                        const hasBreaks = innerBreaks.length > 0;
                        const wsSel = ws.id === selectedId;
                        const workBg = wsSel ? token.colorPrimaryBg : token.colorFillAlter;

                        if (!hasBreaks) {
                            return (
                                <div key={ws.id} onClick={(e) => { e.stopPropagation(); setSelectedId(ws.id); setTool(null); }}
                                    style={{ display: "flex", alignItems: "center", gap: 8, padding: `${token.paddingXS}px ${token.paddingSM}px`, background: workBg, borderRadius: token.borderRadiusSM, border: wsSel ? `1px solid ${token.colorPrimary}` : `1px solid transparent`, cursor: "pointer" }}>
                                    <App_TimeclockEventDot eventType="clock_in" />
                                    <Text strong style={{ fontSize: 12 }}>Work</Text>
                                    <TimeField segId={ws.id} field="startMinute" value={ws.startMinute} />
                                    <Text type="secondary" style={{ fontSize: 12 }}>to</Text>
                                    <TimeField segId={ws.id} field="endMinute" value={ws.endMinute} />
                                    <Text type="secondary" style={{ fontSize: 11, flex: 1 }}>{formatDuration((ws.endMinute - ws.startMinute) * 60000)}</Text>
                                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); removeWork(ws.id); }} />
                                </div>
                            );
                        }

                        return (
                            <div key={ws.id} onClick={(e) => { e.stopPropagation(); setSelectedId(ws.id); setTool(null); }}
                                style={{ padding: `${token.paddingXS}px ${token.paddingSM}px`, background: workBg, borderRadius: token.borderRadiusSM, border: wsSel ? `1px solid ${token.colorPrimary}` : `1px solid transparent`, cursor: "pointer" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                    <App_TimeclockEventDot eventType="clock_in" />
                                    <Text strong style={{ fontSize: 12 }}>Work</Text>
                                    <Text type="secondary" style={{ fontSize: 11, flex: 1 }}>
                                        {formatDuration(((ws.endMinute - ws.startMinute) - innerBreaks.reduce((a, b) => a + (b.endMinute - b.startMinute), 0)) * 60000)}
                                    </Text>
                                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); removeWork(ws.id); }} />
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", marginLeft: 20 }}>
                                    <App_TimeclockEventDot eventType="clock_in" />
                                    <Text type="secondary" style={{ fontSize: 12, width: 64 }}>Clock In</Text>
                                    <TimeField segId={ws.id} field="startMinute" value={ws.startMinute} />
                                </div>
                                {innerBreaks.map((bs) => {
                                    const bsSel = bs.id === selectedId;
                                    return (
                                        <div key={bs.id} onClick={(e) => { e.stopPropagation(); setSelectedId(bs.id); setTool(null); }}
                                            style={{ display: "flex", alignItems: "center", gap: 6, margin: `4px 0 4px 20px`, padding: `${token.paddingXXS}px ${token.paddingSM}px`, background: bsSel ? token.colorPrimaryBg : token.colorBgContainer, borderRadius: token.borderRadiusXS, border: bsSel ? `1px solid ${token.colorPrimary}` : `1px solid ${token.colorBorderSecondary}`, cursor: "pointer" }}>
                                            <App_TimeclockEventDot eventType="lunch_start" />
                                            <Text style={{ fontSize: 12, width: 36 }}>Break</Text>
                                            <TimeField segId={bs.id} field="startMinute" value={bs.startMinute} />
                                            <Text type="secondary" style={{ fontSize: 12 }}>to</Text>
                                            <TimeField segId={bs.id} field="endMinute" value={bs.endMinute} />
                                            <Text type="secondary" style={{ fontSize: 11, flex: 1 }}>{formatDuration((bs.endMinute - bs.startMinute) * 60000)}</Text>
                                            <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); removeBreak(bs.id); }} />
                                        </div>
                                    );
                                })}
                                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", marginLeft: 20 }}>
                                    <App_TimeclockEventDot eventType="clock_out" />
                                    <Text type="secondary" style={{ fontSize: 12, width: 64 }}>Clock Out</Text>
                                    <TimeField segId={ws.id} field="endMinute" value={ws.endMinute} />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {validationError && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: token.colorError, fontSize: 12, marginTop: 4 }}>
                        <ExclamationCircleOutlined style={{ fontSize: 13 }} />
                        {validationError}
                    </div>
                )}

                <div style={{ display: "flex", gap: 16, marginTop: token.marginSM, fontSize: 12 }}>
                    <span>Worked: <strong>{formatDuration(workedMs)}</strong></span>
                    <span>Break: <strong>{formatDuration(breakMs)}</strong></span>
                </div>
            </div>

            {/* Drag tooltip — manipulated directly via ref */}
            <div ref={tooltipRef} style={{
                display: "none", position: "fixed",
                background: "rgba(0,0,0,0.75)", color: "#fff", padding: "2px 8px",
                borderRadius: 4, fontSize: 11, fontWeight: 600, pointerEvents: "none",
                transform: "translateX(-50%)", zIndex: 9999, whiteSpace: "nowrap",
            }} />

            {/* Side-by-side timeline comparison */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: token.marginMD }}>
                <div>
                    <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>Original timeline</Text>
                    <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusSM, overflow: "hidden" }}>
                        {originalTimeline.length === 0 && <div style={{ padding: "12px 16px", color: token.colorTextQuaternary, fontSize: 12 }}>No sessions</div>}
                        {originalTimeline.map((e, i, arr) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: i < arr.length - 1 ? `1px solid ${token.colorFillAlter}` : undefined }}>
                                <App_TimeclockEventDot eventType={e.eventType} />
                                <span style={{ fontWeight: 600, fontSize: 12, width: 40, fontVariantNumeric: "tabular-nums" }}>{e.time}</span>
                                <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{e.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div>
                    <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>Proposed timeline</Text>
                    <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusSM, overflow: "hidden" }}>
                        {proposedTimeline.length === 0 && <div style={{ padding: "12px 16px", color: token.colorTextQuaternary, fontSize: 12 }}>No entries — add segments above</div>}
                        {proposedTimeline.map((e, i, arr) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: i < arr.length - 1 ? `1px solid ${token.colorFillAlter}` : undefined }}>
                                <App_TimeclockEventDot eventType={e.eventType} />
                                <span style={{ fontWeight: 600, fontSize: 12, width: 40, fontVariantNumeric: "tabular-nums" }}>{e.time}</span>
                                <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{e.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

        </div>
    );
});
