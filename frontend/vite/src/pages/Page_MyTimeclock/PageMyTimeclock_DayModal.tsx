import { useState, useRef } from "react";
import { Modal, Button, Input, Select, Typography, theme } from "antd";
import { EditOutlined, EyeOutlined, CloseCircleOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { App_TimeclockBar24, App_TimeclockLegend } from "@/components/timeclock/App_TimeclockBar24";
import { App_TimeclockEventDot } from "@/components/timeclock/App_TimeclockEventDot";
import { TIMECLOCK_COLORS } from "@/utils/timeclock/const_Timeclock_Colors";
import { formatDuration } from "@/utils/timeclock/utils_Timeclock_AggregateEvents";
import type { TimeclockSession } from "@/utils/timeclock/utils_Timeclock_AggregateEvents";
import type { TimeclockSession as RawSession } from "@/hooks/useQ_Tables_TimeclockEvents";
import { useM_PageMyTimeclock_CorrectionTaskCancel } from "@/hooks/useM_PageMyTimeclock_CorrectionTaskCancel";
import { useM_PageMyTimeclock_CorrectionTaskCreate } from "@/hooks/useM_PageMyTimeclock_CorrectionTaskCreate";
import { useM_PageMyTimeclock_CorrectionTaskUpdate } from "@/hooks/useM_PageMyTimeclock_CorrectionTaskUpdate";
import type { PageMyTimeclock_MyCorrectionTasks_QueryData } from "@/hooks/useQ_PageMyTimeclock_MyCorrectionTasks";
import { PageMyTimeclock_CorrectionEditor } from "./PageMyTimeclock_CorrectionEditor";
import type { CorrectionEditorHandle } from "./PageMyTimeclock_CorrectionEditor";
import { App } from "antd";

const { Text } = Typography;

type CorrectionTask = PageMyTimeclock_MyCorrectionTasks_QueryData[number];

type TimelineEntry = {
    time: string;
    label: string;
    eventType: string;
    elapsed: number | null;
    isActive: boolean;
};

const STATUS_CONFIG: Record<string, { tag: string; label: string; color: string }> = {
    pending: { tag: "processing", label: "Pending Correction", color: "#fa8c16" },
    manager_approved: { tag: "processing", label: "Manager Approved — Awaiting HR", color: "#1677ff" },
    approved: { tag: "success", label: "Approved Correction", color: "#52c41a" },
    rejected: { tag: "error", label: "Rejected Correction", color: "#ff4d4f" },
    cancelled: { tag: "default", label: "Cancelled", color: "#8c8c8c" },
};

const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const isoToMinute = (iso: string, tz: string): number => {
    try {
        const p = new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).split(":");
        return parseInt(p[0]!) * 60 + parseInt(p[1]!);
    } catch { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }
};

type OverlayState =
    | null
    | { type: "edit-new" }
    | { type: "edit-pending" }
    | { type: "view-correction"; correctionId: string };

type DepartmentOption = { id: string; name: string };

type Props = {
    open: boolean;
    onClose: () => void;
    day: Date;
    sessions: TimeclockSession[];
    rawSessions: RawSession[];
    timezone: string;
    workedMs: number;
    breakMs: number;
    timeline: TimelineEntry[];
    correctionTasks: CorrectionTask[];
    employeeId: string;
    entityId: string;
    approvalMode?: string;
    employeeDepartments?: DepartmentOption[];
    readOnly?: boolean;
};

export const PageMyTimeclock_DayModal = ({
    open, onClose, day, sessions, rawSessions, timezone,
    workedMs, breakMs, timeline, correctionTasks, employeeId, entityId,
    approvalMode, employeeDepartments, readOnly,
}: Props) => {
    const { token } = theme.useToken();
    const { modal: confirmModal } = App.useApp();
    const [overlay, setOverlay] = useState<OverlayState>(null);
    const [reason, setReason] = useState("");
    const [editorStatus, setEditorStatus] = useState({ hasSegments: false, isDirty: false });
    const [helpOpen, setHelpOpen] = useState(false);
    const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>([]);
    const [deptTouched, setDeptTouched] = useState(false);
    const needsDeptSelection = (approvalMode === "manager_only" || approvalMode === "both") && employeeDepartments && employeeDepartments.length > 0;
    const deptError = needsDeptSelection && deptTouched && selectedDeptIds.length === 0;
    const editorRef = useRef<CorrectionEditorHandle>(null);
    const mCancel = useM_PageMyTimeclock_CorrectionTaskCancel();
    const mCreate = useM_PageMyTimeclock_CorrectionTaskCreate();
    const mUpdate = useM_PageMyTimeclock_CorrectionTaskUpdate();

    const dayLabel = day.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const dayDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const pendingTask = correctionTasks.find((ct) => ct.status === "pending");
    const approvedTask = correctionTasks.find((ct) => ct.status === "approved");
    const hasPending = !!pendingTask;

    const handleCancelCorrection = (ct: CorrectionTask) => {
        confirmModal.confirm({
            title: "Cancel correction request?",
            content: "This will cancel your pending correction request for this day.",
            okText: "Yes, cancel it",
            okType: "danger",
            onOk: () => mCancel.mutation.mutateAsync({ correctionTaskId: ct.id }),
        });
    };

    // --- Correction detail helper ---
    const correctionToBarSessions = (ct: CorrectionTask): TimeclockSession[] => {
        const corrections = (ct.timeclock_corrections ?? []) as { type: string; start_at: string; end_at: string; duration_ms: number; session_id: string | null }[];
        return corrections
            .filter((c) => c.session_id === null && c.duration_ms > 0)
            .map((c) => ({
                type: (c.type === "break" ? "lunch" : "work") as "work" | "lunch",
                startAt: c.start_at,
                endAt: c.end_at,
                durationMs: c.duration_ms,
            }));
    };

    const correctionToTimeline = (ct: CorrectionTask) => {
        const barSessions = correctionToBarSessions(ct);
        const entries: { time: string; label: string; eventType: string }[] = [];
        for (const s of barSessions) {
            if (s.type === "work") {
                entries.push({ time: fmtMin(isoToMinute(s.startAt, timezone)), label: "Clock In", eventType: "clock_in" });
                entries.push({ time: fmtMin(isoToMinute(s.endAt!, timezone)), label: "Clock Out", eventType: "clock_out" });
            } else {
                entries.push({ time: fmtMin(isoToMinute(s.startAt, timezone)), label: "Break", eventType: "lunch_start" });
                entries.push({ time: fmtMin(isoToMinute(s.endAt!, timezone)), label: "Back to Work", eventType: "lunch_end" });
            }
        }
        entries.sort((a, b) => a.time.localeCompare(b.time));
        return entries;
    };

    // --- Approved correction data ---
    const approvedSessions = approvedTask ? correctionToBarSessions(approvedTask) : null;
    const approvedTimeline = approvedTask ? correctionToTimeline(approvedTask) : null;
    const approvedBreakMs = approvedSessions?.filter((s) => s.type === "lunch").reduce((a, s) => a + s.durationMs, 0) ?? 0;
    const approvedWorkedMs = Math.max((approvedSessions?.filter((s) => s.type === "work").reduce((a, s) => a + s.durationMs, 0) ?? 0) - approvedBreakMs, 0);

    // --- Overlay: view correction detail ---
    const viewingCorrection = overlay?.type === "view-correction"
        ? correctionTasks.find((ct) => ct.id === overlay.correctionId) ?? null
        : null;

    return (
        <>
            {/* Base: Day detail modal */}
            <Modal open={open} onCancel={onClose} title={dayLabel} width={approvedSessions ? 920 : 640} destroyOnHidden
                styles={{ body: { display: "flex", flexDirection: "column", maxHeight: "70vh", overflow: "hidden", padding: 0 } }}
                footer={readOnly ? null :
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <Button
                            type="primary"
                            icon={<EditOutlined />}
                            onClick={() => setOverlay({ type: "edit-new" })}
                            disabled={hasPending}
                            title={hasPending ? "Cancel the pending correction first" : undefined}
                        >
                            Request Correction
                        </Button>
                    </div>
                }
            >
                {/* Fixed: Day detail */}
                <div style={{ flexShrink: 0, padding: `${token.paddingMD}px ${token.paddingLG}px 0` }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: token.marginMD }}>
                        <App_TimeclockLegend />

                        {approvedSessions ? (
                            <>
                                {/* Before / After bars */}
                                <div>
                                    <Text type="secondary" style={{ fontSize: 11, marginBottom: 4, display: "block" }}>Original</Text>
                                    <div style={{ paddingTop: 16, paddingBottom: 16 }}>
                                        <App_TimeclockBar24 sessions={sessions} timezone={timezone} showHourLabels />
                                    </div>
                                    <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                                        <span>Worked: <strong>{formatDuration(workedMs)}</strong></span>
                                        <span>Break: <strong>{formatDuration(breakMs)}</strong></span>
                                    </div>
                                </div>
                                <div style={{ border: `1px solid #52c41a`, borderRadius: token.borderRadiusSM, padding: `${token.paddingSM}px ${token.paddingSM}px ${token.paddingMD}px`, background: "rgba(82, 196, 26, 0.04)", overflow: "visible" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#52c41a" }} />
                                        <Text style={{ fontSize: 11, color: "#52c41a", fontWeight: 600 }}>Corrected</Text>
                                    </div>
                                    <div style={{ paddingTop: 16, paddingBottom: 16 }}>
                                        <App_TimeclockBar24 sessions={approvedSessions} timezone={timezone} showHourLabels />
                                    </div>
                                    <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                                        <span>Worked: <strong>{formatDuration(approvedWorkedMs)}</strong></span>
                                        <span>Break: <strong>{formatDuration(approvedBreakMs)}</strong></span>
                                    </div>
                                </div>

                                {/* Side-by-side timelines */}
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: token.marginMD }}>
                                    <div>
                                        <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>Original timeline</Text>
                                        <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusSM, overflow: "hidden" }}>
                                            {timeline.length === 0 && <div style={{ padding: "12px 16px", color: token.colorTextQuaternary, fontSize: 12 }}>No sessions</div>}
                                            {timeline.map((entry, i, arr) => (
                                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: i < arr.length - 1 ? `1px solid ${token.colorFillAlter}` : undefined }}>
                                                    <App_TimeclockEventDot eventType={entry.eventType} pulse={entry.isActive} />
                                                    <span style={{ fontWeight: 600, fontSize: 12, width: 40, fontVariantNumeric: "tabular-nums" }}>{entry.time}</span>
                                                    <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{entry.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>Corrected timeline</Text>
                                        <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusSM, overflow: "hidden" }}>
                                            {approvedTimeline!.length === 0 && <div style={{ padding: "12px 16px", color: token.colorTextQuaternary, fontSize: 12 }}>No entries</div>}
                                            {approvedTimeline!.map((entry, i, arr) => (
                                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: i < arr.length - 1 ? `1px solid ${token.colorFillAlter}` : undefined }}>
                                                    <App_TimeclockEventDot eventType={entry.eventType} />
                                                    <span style={{ fontWeight: 600, fontSize: 12, width: 40, fontVariantNumeric: "tabular-nums" }}>{entry.time}</span>
                                                    <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{entry.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ paddingTop: 16, paddingBottom: 16 }}>
                                    <App_TimeclockBar24 sessions={sessions} timezone={timezone} showHourLabels />
                                </div>
                                <div style={{ display: "flex", gap: 24 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                                        <div style={{ width: 10, height: 10, borderRadius: 3, background: TIMECLOCK_COLORS.work.solid }} />
                                        Worked <strong style={{ fontSize: 15, marginLeft: 2 }}>{formatDuration(workedMs)}</strong>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                                        <div style={{ width: 10, height: 10, borderRadius: 3, background: TIMECLOCK_COLORS.lunch.text }} />
                                        Break <strong style={{ fontSize: 15, marginLeft: 2 }}>{formatDuration(breakMs)}</strong>
                                    </div>
                                </div>
                                {timeline.length > 0 && (
                                    <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, overflow: "hidden" }}>
                                        {timeline.map((entry, i, arr) => (
                                            <div key={i} style={{
                                                display: "flex", alignItems: "center", gap: 14, padding: "8px 16px",
                                                borderBottom: i < arr.length - 1 ? `1px solid ${token.colorFillAlter}` : undefined,
                                            }}>
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
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Correction history — sticky header, scrollable rows */}
                {correctionTasks.length > 0 && (
                    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: `${token.paddingMD}px ${token.paddingLG}px` }}>
                        <div style={{ display: "grid", gridTemplateColumns: "3fr 3fr 3fr 2fr", padding: "0 12px 4px 15px", flexShrink: 0 }}>
                            <Text type="secondary" style={{ fontSize: 10 }}>Status</Text>
                            <Text type="secondary" style={{ fontSize: 10, textAlign: "center" }}>Created</Text>
                            <Text type="secondary" style={{ fontSize: 10, textAlign: "center" }}>Updated</Text>
                            <Text type="secondary" style={{ fontSize: 10, textAlign: "right" }}>Actions</Text>
                        </div>
                        <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusSM, flex: 1, minHeight: 0, overflowY: "auto" }}>
                            {correctionTasks.map((ct, i, arr) => {
                                const cfg = STATUS_CONFIG[ct.status] ?? STATUS_CONFIG.pending!;
                                const isPending = ct.status === "pending";
                                return (
                                    <div key={ct.id}
                                        onClick={() => setOverlay({ type: "view-correction", correctionId: ct.id })}
                                        style={{
                                            display: "grid", gridTemplateColumns: "3fr 3fr 3fr 2fr", alignItems: "center",
                                            padding: "6px 12px", cursor: "pointer",
                                            borderBottom: i < arr.length - 1 ? `1px solid ${token.colorFillAlter}` : undefined,
                                            borderLeft: `3px solid ${cfg.color}`,
                                        }}
                                    >
                                        <Text style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{cfg.label}</Text>
                                        <Text type="secondary" style={{ fontSize: 11, textAlign: "center" }}>
                                            {ct.created_at ? new Date(ct.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                                        </Text>
                                        <Text type="secondary" style={{ fontSize: 11, textAlign: "center", fontStyle: ct.updated_at && ct.created_at && ct.updated_at !== ct.created_at ? "italic" : undefined }}>
                                            {ct.updated_at && ct.created_at && ct.updated_at !== ct.created_at
                                                ? new Date(ct.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                                                : "—"}
                                        </Text>
                                        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                                            {!readOnly && isPending && (
                                                <>
                                                    <Button size="small" type="text" icon={<EditOutlined />}
                                                        onClick={(e) => { e.stopPropagation(); setReason(pendingTask?.message ?? ""); setOverlay({ type: "edit-pending" }); }} />
                                                    <Button size="small" type="text" danger icon={<CloseCircleOutlined />}
                                                        onClick={(e) => { e.stopPropagation(); handleCancelCorrection(ct); }}
                                                        loading={mCancel.mutation.isPending} />
                                                </>
                                            )}
                                            <Button size="small" type="text" icon={<EyeOutlined />}
                                                onClick={() => setOverlay({ type: "view-correction", correctionId: ct.id })} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </Modal>

            {/* Overlay: Correction editor (new or edit pending) */}
            <Modal
                open={overlay?.type === "edit-new" || overlay?.type === "edit-pending"}
                onCancel={() => { setOverlay(null); setReason(""); setEditorStatus({ hasSegments: false, isDirty: false }); }}
                title={
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{overlay?.type === "edit-pending" ? `Edit Correction — ${dayLabel}` : `Request Correction — ${dayLabel}`}</span>
                        <Button type="text" size="small" icon={<QuestionCircleOutlined />} onClick={() => setHelpOpen(!helpOpen)} style={{ color: token.colorPrimary }} />
                    </div>
                }
                width={helpOpen ? 1200 : 920}
                destroyOnHidden
                styles={{ body: { maxHeight: "calc(70vh - 120px)", overflowY: "auto" } }}
                footer={
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, textAlign: "left" }}>
                        {needsDeptSelection && overlay?.type === "edit-new" && (
                            <div>
                                <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Departments for approval</Text>
                                <Select
                                    mode="multiple"
                                    status={deptError ? "error" : undefined}
                                    placeholder="Select departments..."
                                    value={selectedDeptIds}
                                    onChange={(v) => { setSelectedDeptIds(v); setDeptTouched(true); }}
                                    onBlur={() => setDeptTouched(true)}
                                    options={employeeDepartments!.map((d) => ({ label: d.name, value: d.id }))}
                                    style={{ width: "100%" }}
                                    size="small"
                                />
                                {deptError && <Text type="danger" style={{ fontSize: 11 }}>Select at least one department</Text>}
                            </div>
                        )}
                        <div>
                            <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Reason</Text>
                            <Input.TextArea
                                rows={1}
                                autoSize={{ minRows: 1, maxRows: 3 }}
                                placeholder="Explain why this correction is needed..."
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                style={{ flex: 1 }}
                            />
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: token.marginSM }}>
                            <Button onClick={() => { setOverlay(null); setReason(""); setEditorStatus({ hasSegments: false, isDirty: false }); setSelectedDeptIds([]); setDeptTouched(false); }}>Cancel</Button>
                            <Button
                                type="primary"
                                onClick={() => {
                                    if (needsDeptSelection && overlay?.type === "edit-new" && selectedDeptIds.length === 0) {
                                        setDeptTouched(true);
                                        return;
                                    }
                                    if (!editorRef.current) return;
                                    const entries = editorRef.current.buildEntries();
                                    if (overlay?.type === "edit-pending" && pendingTask) {
                                        mUpdate.mutation.mutate(
                                            { correctionTaskId: pendingTask.id, message: reason, entries, dayId: pendingTask.day_id },
                                            { onSuccess: () => { setOverlay(null); setReason(""); setEditorStatus({ hasSegments: false, isDirty: false }); } },
                                        );
                                    } else {
                                        mCreate.mutation.mutate(
                                            { employee_id: employeeId, entity_id: entityId, day_date: dayDate, timezone, message: reason, entries, department_ids: needsDeptSelection ? selectedDeptIds : undefined },
                                            { onSuccess: () => { setOverlay(null); setReason(""); setEditorStatus({ hasSegments: false, isDirty: false }); setSelectedDeptIds([]); setDeptTouched(false); } },
                                        );
                                    }
                                }}
                                loading={mCreate.mutation.isPending || mUpdate.mutation.isPending}
                                disabled={!editorStatus.hasSegments || (overlay?.type === "edit-pending" && !editorStatus.isDirty && reason === (pendingTask?.message ?? ""))}
                            >
                                {overlay?.type === "edit-pending" ? "Update Correction" : "Submit Correction"}
                            </Button>
                        </div>
                    </div>
                }
            >
                {(overlay?.type === "edit-new" || overlay?.type === "edit-pending") && (
                    <div style={{ display: "flex", gap: token.marginLG }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <PageMyTimeclock_CorrectionEditor
                                ref={editorRef}
                                sessions={sessions}
                                rawSessions={rawSessions}
                                dayDate={dayDate}
                                timezone={timezone}
                                pendingTask={overlay.type === "edit-pending" ? pendingTask ?? null : null}
                                onHasChanges={setEditorStatus}
                            />
                        </div>
                        {helpOpen && (
                            <div style={{ width: 240, flexShrink: 0, borderLeft: `1px solid ${token.colorBorderSecondary}`, paddingLeft: token.paddingLG }}>
                                <Text strong style={{ fontSize: 13, display: "block", marginBottom: token.marginSM }}>How to use</Text>
                                <div style={{ fontSize: 12, lineHeight: 2, color: token.colorTextSecondary }}>
                                    <div><strong>1.</strong> <strong>Before</strong> bar = recorded day. <strong>After</strong> bar = your correction.</div>
                                    <div><strong>2.</strong> Pick a <strong>Work</strong> or <strong>Break</strong> tool, then click or drag on the After bar.</div>
                                    <div><strong>3.</strong> Click a segment to select, then drag to move or use edge knobs to resize.</div>
                                    <div><strong>4.</strong> Time pickers on each card for exact adjustments.</div>
                                    <div><strong>5.</strong> Breaks must be inside a work session.</div>
                                </div>
                                <Button type="text" size="small" onClick={() => setHelpOpen(false)} style={{ marginTop: token.marginMD, color: token.colorTextTertiary }}>Close</Button>
                            </div>
                        )}
                    </div>
                )}
            </Modal>


            {/* Overlay: Correction detail (read-only) */}
            {viewingCorrection && (() => {
                const proposedSessions = correctionToBarSessions(viewingCorrection);
                const proposedTimeline = correctionToTimeline(viewingCorrection);
                const cfg = STATUS_CONFIG[viewingCorrection.status] ?? STATUS_CONFIG.pending!;
                const proposedWorkedMs = proposedSessions.filter((s) => s.type === "work").reduce((a, s) => a + s.durationMs, 0);
                const proposedBreakMs = proposedSessions.filter((s) => s.type === "lunch").reduce((a, s) => a + s.durationMs, 0);

                return (
                    <Modal
                        open
                        onCancel={() => setOverlay(null)}
                        closable={false}
                        title={`Correction Detail — ${dayLabel}`}
                        width={920}
                        destroyOnHidden
                        styles={{ body: { maxHeight: "calc(70vh - 120px)", overflowY: "auto" } }}
                        footer={
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, textAlign: "left" }}>
                                <div>
                                    <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Reason</Text>
                                    <Input.TextArea
                                        rows={1}
                                        autoSize={{ minRows: 1, maxRows: 3 }}
                                        value={viewingCorrection.message || "No reason provided"}
                                        disabled
                                    />
                                </div>
                                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                    <Button onClick={() => setOverlay(null)}>Close</Button>
                                </div>
                            </div>
                        }
                    >
                        <div style={{ display: "flex", flexDirection: "column", gap: token.marginMD }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <Text style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{cfg.label}</Text>
                                <Text type="secondary" style={{ fontSize: 11, marginLeft: "auto" }}>
                                    {viewingCorrection.created_at ? new Date(viewingCorrection.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                                </Text>
                            </div>

                            <div>
                                <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>Before</Text>
                                <div style={{ paddingTop: 16, paddingBottom: 16 }}>
                                    <App_TimeclockBar24 sessions={sessions} timezone={timezone} showHourLabels />
                                </div>
                            </div>

                            <div>
                                <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>Proposed</Text>
                                <div style={{ paddingTop: 16, paddingBottom: 16 }}>
                                    <App_TimeclockBar24 sessions={proposedSessions} timezone={timezone} showHourLabels />
                                </div>
                                <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                                    <span>Worked: <strong>{formatDuration(proposedWorkedMs)}</strong></span>
                                    <span>Break: <strong>{formatDuration(proposedBreakMs)}</strong></span>
                                </div>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: token.marginMD }}>
                                <div>
                                    <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>Original timeline</Text>
                                    <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusSM, overflow: "hidden" }}>
                                        {timeline.length === 0 && <div style={{ padding: "12px 16px", color: token.colorTextQuaternary, fontSize: 12 }}>No sessions</div>}
                                        {timeline.map((e, i, arr) => (
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
                                        {proposedTimeline.length === 0 && <div style={{ padding: "12px 16px", color: token.colorTextQuaternary, fontSize: 12 }}>No entries</div>}
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
                    </Modal>
                );
            })()}
        </>
    );
};
