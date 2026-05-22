import { useState, useMemo, useCallback } from "react";
import { App_TimeclockDetailView } from "@/components/timeclock/App_TimeclockDetailView";
import type { DaySummary, CorrectionTaskEntry, BarSession } from "@/components/timeclock/App_TimeclockDetailView";
import { useQ_PageMyTimeclock_MyCorrectionTasks } from "@/hooks/useQ_PageMyTimeclock_MyCorrectionTasks";
import { PageMyTimeclock_DayModal } from "@/pages/Page_MyTimeclock/PageMyTimeclock_DayModal";

type ModalMode = { day: Date; summary: DaySummary | undefined };

type Props = {
    employeeId: string;
    entityId: string;
    timezone: string;
    initialRefDate?: Date;
};

export const AppEmployeeDetailModal_TimeclockTab = ({ employeeId, entityId, timezone, initialRefDate }: Props) => {
    const [modalState, setModalState] = useState<ModalMode | null>(null);
    const qCorrections = useQ_PageMyTimeclock_MyCorrectionTasks({ employeeId });

    const correctionTasksByDate = useMemo(() => {
        const map = new Map<string, CorrectionTaskEntry[]>();
        for (const [date, cts] of qCorrections.correctionTasksByDate) {
            map.set(date, cts.map((ct) => {
                const entry: CorrectionTaskEntry = { status: ct.status, message: ct.message };
                if ((ct.status === "pending" || ct.status === "approved") && ct.timeclock_corrections) {
                    const corrections = ct.timeclock_corrections as { type: string; start_at: string; end_at: string; duration_ms: number; session_id: string | null }[];
                    entry.proposedSessions = corrections
                        .filter((c) => c.session_id === null && c.duration_ms > 0)
                        .map((c): BarSession => ({
                            type: (c.type === "break" ? "lunch" : "work") as "work" | "lunch",
                            startAt: c.start_at,
                            endAt: c.end_at,
                            durationMs: c.duration_ms,
                        }));
                }
                return entry;
            }));
        }
        return map;
    }, [qCorrections.correctionTasksByDate]);

    const modalCorrectionTasks = useMemo(() => {
        if (!modalState) return [];
        const dateStr = `${modalState.day.getFullYear()}-${String(modalState.day.getMonth() + 1).padStart(2, "0")}-${String(modalState.day.getDate()).padStart(2, "0")}`;
        return qCorrections.correctionTasksByDate.get(dateStr) ?? [];
    }, [modalState, qCorrections.correctionTasksByDate]);

    const handleDayClick = useCallback((day: Date, summary: DaySummary | undefined) => {
        setModalState({ day, summary });
    }, []);

    return (
        <>
            <div style={{ overflow: "auto", maxHeight: "60vh" }}>
                <App_TimeclockDetailView
                    employeeId={employeeId}
                    timezone={timezone}
                    initialRefDate={initialRefDate}
                    onDayClick={handleDayClick}
                    correctionTasksByDate={correctionTasksByDate}
                />
            </div>
            {modalState && (
                <PageMyTimeclock_DayModal
                    open
                    onClose={() => setModalState(null)}
                    day={modalState.day}
                    sessions={modalState.summary?.sessions ?? []}
                    rawSessions={modalState.summary?.rawSessions ?? []}
                    timezone={timezone}
                    workedMs={modalState.summary?.workedMs ?? 0}
                    breakMs={modalState.summary?.breakMs ?? 0}
                    timeline={modalState.summary?.timeline ?? []}
                    correctionTasks={modalCorrectionTasks}
                    employeeId={employeeId}
                    entityId={entityId}
                    readOnly
                />
            )}
        </>
    );
};
