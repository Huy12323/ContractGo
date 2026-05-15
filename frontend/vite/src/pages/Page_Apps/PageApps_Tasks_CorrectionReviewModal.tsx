import { useMemo } from "react";
import { Modal, Button, Tag, Typography, theme } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { App_TimeclockBar24, App_TimeclockLegend } from "@/components/timeclock/App_TimeclockBar24";
import { App_TimeclockEventDot } from "@/components/timeclock/App_TimeclockEventDot";
import { formatDuration } from "@/utils/timeclock/utils_Timeclock_AggregateEvents";
import { useM_PageApps_CorrectionTaskApprove } from "@/hooks/useM_PageApps_CorrectionTaskApprove";
import { useM_PageApps_CorrectionTaskReject } from "@/hooks/useM_PageApps_CorrectionTaskReject";
import type { PageApps_EntityCorrectionTasks_QueryData } from "@/hooks/useQ_PageApps_EntityCorrectionTasks";

const { Text } = Typography;

type CorrectionTask = PageApps_EntityCorrectionTasks_QueryData[number];

type BarSession = {
    type: "work" | "lunch";
    startAt: string;
    endAt: string | null;
    durationMs: number;
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
    pending: { label: "Pending", color: "#fa8c16" },
    manager_approved: { label: "Manager Approved — Awaiting HR", color: "#1677ff" },
    approved: { label: "Approved", color: "#52c41a" },
    rejected: { label: "Rejected", color: "#ff4d4f" },
    cancelled: { label: "Cancelled", color: "#8c8c8c" },
};

const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const isoToMinute = (iso: string, tz: string): number => {
    try {
        const p = new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).split(":");
        return parseInt(p[0]!) * 60 + parseInt(p[1]!);
    } catch { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }
};

type Props = {
    open: boolean;
    onClose: () => void;
    correctionTask: CorrectionTask;
    isHR: boolean;
    isManager: boolean;
    approvalMode: string;
    entityId: string;
};

export const PageApps_Tasks_CorrectionReviewModal = ({ open, onClose, correctionTask: ct, isHR, isManager, approvalMode }: Props) => {
    const { token } = theme.useToken();
    const mApprove = useM_PageApps_CorrectionTaskApprove();
    const mReject = useM_PageApps_CorrectionTaskReject();

    const dayData = ct.days as { id: string; date: string; timezone: string } | null;
    const timezone = dayData?.timezone ?? "UTC";
    const dayDate = dayData?.date ?? "";
    const emp = ct.employees as { first_name: string | null; last_name: string | null; email: string; __full_name: string | null } | null;
    const empName = emp?.__full_name ?? (`${emp?.first_name ?? ""} ${emp?.last_name ?? ""}`.trim() || emp?.email || "Unknown");
    const cfg = STATUS_CONFIG[ct.status] ?? STATUS_CONFIG.pending!;

    const qOriginalSessions = useQuery({
        enabled: open && !!dayData?.id && !!ct.employee_id,
        queryKey: [...QueryKeys.timeclock_sessions.list(), { dayId: dayData?.id, employeeId: ct.employee_id }],
        queryFn: async () => {
            const sb_FromTimeclockSessions_Select = await supabase
                .from("timeclock_sessions")
                .select("*")
                .eq("day_id", dayData!.id)
                .eq("employee_id", ct.employee_id)
                .order("start_at");
            if (sb_FromTimeclockSessions_Select.error) throw sb_FromTimeclockSessions_Select.error;
            return sb_FromTimeclockSessions_Select.data;
        },
    });

    const originalSessions: BarSession[] = useMemo(() => {
        if (!qOriginalSessions.data) return [];
        return qOriginalSessions.data.map((s) => ({
            type: (s.type === "break" ? "lunch" : "work") as "work" | "lunch",
            startAt: s.start_at,
            endAt: s.end_at,
            durationMs: s.duration_ms ?? 0,
        }));
    }, [qOriginalSessions.data]);

    const corrections = (ct.timeclock_corrections ?? []) as { type: string; start_at: string; end_at: string; duration_ms: number; session_id: string | null }[];
    const proposedSessions: BarSession[] = useMemo(() =>
        corrections
            .filter((c) => c.session_id === null && c.duration_ms > 0)
            .map((c) => ({
                type: (c.type === "break" ? "lunch" : "work") as "work" | "lunch",
                startAt: c.start_at,
                endAt: c.end_at,
                durationMs: c.duration_ms,
            })),
        [corrections]);

    const buildTimeline = (sessions: BarSession[]) => {
        const entries: { time: string; label: string; eventType: string }[] = [];
        for (const s of sessions) {
            if (s.type === "work") {
                entries.push({ time: fmtMin(isoToMinute(s.startAt, timezone)), label: "Clock In", eventType: "clock_in" });
                if (s.endAt) entries.push({ time: fmtMin(isoToMinute(s.endAt, timezone)), label: "Clock Out", eventType: "clock_out" });
            } else {
                entries.push({ time: fmtMin(isoToMinute(s.startAt, timezone)), label: "Break", eventType: "lunch_start" });
                if (s.endAt) entries.push({ time: fmtMin(isoToMinute(s.endAt, timezone)), label: "Back to Work", eventType: "lunch_end" });
            }
        }
        const EVENT_ORDER: Record<string, number> = { clock_in: 0, lunch_end: 1, lunch_start: 2, clock_out: 3 };
        entries.sort((a, b) => a.time.localeCompare(b.time) || (EVENT_ORDER[a.eventType] ?? 0) - (EVENT_ORDER[b.eventType] ?? 0));
        return entries;
    };

    const originalTimeline = useMemo(() => buildTimeline(originalSessions), [originalSessions, timezone]);
    const proposedTimeline = useMemo(() => buildTimeline(proposedSessions), [proposedSessions, timezone]);

    const proposedWorkedMs = proposedSessions.filter((s) => s.type === "work").reduce((a, s) => a + s.durationMs, 0);
    const proposedBreakMs = proposedSessions.filter((s) => s.type === "lunch").reduce((a, s) => a + s.durationMs, 0);
    const originalWorkedMs = originalSessions.filter((s) => s.type === "work").reduce((a, s) => a + s.durationMs, 0);
    const originalBreakMs = originalSessions.filter((s) => s.type === "lunch").reduce((a, s) => a + s.durationMs, 0);

    const deptApprovals = (ct.rel__correction_task__department ?? []) as { department_id: string; decision: string | null; decided_by: string | null; decided_at: string | null; departments: { id: string; name: string } | null }[];

    const noDeptsFallback = ct.status === "pending" && deptApprovals.length === 0 && (approvalMode === "both" || approvalMode === "manager_only");
    const myDeptUndecided = deptApprovals.some((da) => da.decision === null);

    const canApprove = (() => {
        if (ct.status === "pending" && approvalMode === "hr_only" && isHR) return true;
        if (noDeptsFallback && isHR) return true;
        if (ct.status === "pending" && (approvalMode === "manager_only" || approvalMode === "both") && isManager && myDeptUndecided) return true;
        if (ct.status === "manager_approved" && isHR) return true;
        return false;
    })();

    const canReject = ct.status === "pending" || ct.status === "manager_approved";

    const handleApprove = () => mApprove.mutation.mutateAsync({ correctionTaskId: ct.id }).then(() => onClose());

    const handleReject = () => mReject.mutation.mutateAsync({ correctionTaskId: ct.id }).then(() => onClose());

    const TimelineColumn = ({ entries, label }: { entries: { time: string; label: string; eventType: string }[]; label: string }) => (
        <div>
            <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>{label}</Text>
            <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusSM, overflow: "hidden" }}>
                {entries.length === 0 && <div style={{ padding: "12px 16px", color: token.colorTextQuaternary, fontSize: 12 }}>No sessions</div>}
                {entries.map((e, i, arr) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: i < arr.length - 1 ? `1px solid ${token.colorFillAlter}` : undefined }}>
                        <App_TimeclockEventDot eventType={e.eventType} />
                        <span style={{ fontWeight: 600, fontSize: 12, width: 40, fontVariantNumeric: "tabular-nums" }}>{e.time}</span>
                        <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{e.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={`Correction Review — ${empName}`}
            width={920}
            destroyOnHidden
            styles={{ body: { maxHeight: "calc(70vh - 120px)", overflowY: "auto" } }}
            footer={
                <div style={{ display: "flex", flexDirection: "column", gap: 8, textAlign: "left" }}>
                    {ct.message && (
                        <div>
                            <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Employee's reason</Text>
                            <div style={{ padding: "8px 12px", background: token.colorFillAlter, borderRadius: token.borderRadiusSM, fontSize: 13 }}>{ct.message}</div>
                        </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: token.marginSM }}>
                        <Button onClick={onClose}>Close</Button>
                        {canReject && (
                            <Button danger onClick={handleReject} loading={mReject.mutation.isPending}>Reject</Button>
                        )}
                        {canApprove && (
                            <Button type="primary" onClick={handleApprove} loading={mApprove.mutation.isPending}>Approve</Button>
                        )}
                    </div>
                </div>
            }
        >
            <div style={{ display: "flex", flexDirection: "column", gap: token.marginMD }}>
                {/* Status + date header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{cfg.label}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{dayDate}</Text>
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: "auto" }}>
                        Created: {ct.created_at ? new Date(ct.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                        {ct.updated_at && ct.created_at && ct.updated_at !== ct.created_at
                            ? ` · Updated: ${new Date(ct.updated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                            : ""}
                    </Text>
                </div>

                {/* Department approval progress */}
                {noDeptsFallback && (
                    <Text type="secondary" style={{ fontSize: 11, fontStyle: "italic" }}>No departments linked — submitted before approval mode change. HR can approve directly.</Text>
                )}
                {deptApprovals.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {deptApprovals.map((da) => {
                            const deptColor = da.decision === "rejected" ? "error" : da.decision === "approved" ? "success" : "default";
                            const deptIcon = da.decision === "rejected" ? <CloseCircleOutlined /> : da.decision === "approved" ? <CheckCircleOutlined /> : undefined;
                            return (
                                <Tag
                                    key={da.department_id}
                                    color={deptColor}
                                    icon={deptIcon}
                                >
                                    {da.departments?.name ?? "Dept"}
                                    {da.decided_at ? ` — ${new Date(da.decided_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                                </Tag>
                            );
                        })}
                    </div>
                )}

                {/* Admin decision */}
                {(approvalMode === "hr_only" || approvalMode === "both") && ct.admin_decision && (
                    <div style={{ display: "flex", gap: 6 }}>
                        <Tag
                            color={ct.admin_decision === "rejected" ? "error" : ct.admin_decision === "approved" ? "success" : "default"}
                            icon={ct.admin_decision === "rejected" ? <CloseCircleOutlined /> : ct.admin_decision === "approved" ? <CheckCircleOutlined /> : undefined}
                        >
                            Admin
                            {ct.admin_decided_at ? ` — ${new Date(ct.admin_decided_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                        </Tag>
                    </div>
                )}

                <App_TimeclockLegend />

                {/* Before bar */}
                <div>
                    <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>Before (recorded)</Text>
                    <div style={{ paddingTop: 16, paddingBottom: 16 }}>
                        <App_TimeclockBar24 sessions={originalSessions} timezone={timezone} showHourLabels />
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                        <span>Worked: <strong>{formatDuration(originalWorkedMs)}</strong></span>
                        <span>Break: <strong>{formatDuration(originalBreakMs)}</strong></span>
                    </div>
                </div>

                {/* After bar */}
                <div>
                    <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>Proposed correction</Text>
                    <div style={{ paddingTop: 16, paddingBottom: 16 }}>
                        <App_TimeclockBar24 sessions={proposedSessions} timezone={timezone} showHourLabels />
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                        <span>Worked: <strong>{formatDuration(proposedWorkedMs)}</strong></span>
                        <span>Break: <strong>{formatDuration(proposedBreakMs)}</strong></span>
                    </div>
                </div>

                {/* Side-by-side timelines */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: token.marginMD }}>
                    <TimelineColumn entries={originalTimeline} label="Original timeline" />
                    <TimelineColumn entries={proposedTimeline} label="Proposed timeline" />
                </div>
            </div>
        </Modal>
    );
};
