import { useState, useMemo, useCallback } from "react";
import { useMatch } from "@tanstack/react-router";
import { Typography, theme } from "antd";
import { useQ_Tables_MyEmployeeEntities } from "@/hooks/useQ_Tables_MyEmployeeEntities";
import { useQ_PageMyTimeclock_MyCorrectionTasks } from "@/hooks/useQ_PageMyTimeclock_MyCorrectionTasks";
import { App_TimeclockDetailView } from "@/components/timeclock/App_TimeclockDetailView";
import type { DaySummary, CorrectionTaskEntry, BarSession } from "@/components/timeclock/App_TimeclockDetailView";
import { PageMyTimeclock_DayModal } from "./PageMyTimeclock_DayModal";

const { Text } = Typography;

type ModalMode = { day: Date; summary: DaySummary | undefined };

export const Page_MyTimeclock = () => {
    const { token } = theme.useToken();
    const organizationId = useMatch({ from: "/_protected/$organizationId", shouldThrow: false, select: (m) => m.params.organizationId }) ?? "";
    const qEntities = useQ_Tables_MyEmployeeEntities({ organizationId });

    const [selectedEntityIdx, setSelectedEntityIdx] = useState(0);
    const [modalState, setModalState] = useState<ModalMode | null>(null);

    const selectedEntity = qEntities.employeeEntities[selectedEntityIdx];
    const entity = selectedEntity?.entities as { id: string; name: string; timezone: string } | null;
    const employeeId = selectedEntity?.id ?? "";
    const entityId = entity?.id ?? "";
    const timezone = entity?.timezone ?? "UTC";

    const qCorrections = useQ_PageMyTimeclock_MyCorrectionTasks({ employeeId });

    const correctionTasksByDate = useMemo(() => {
        const map = new Map<string, CorrectionTaskEntry[]>();
        for (const [date, cts] of qCorrections.correctionTasksByDate) {
            map.set(date, cts.map((ct) => {
                const entry: CorrectionTaskEntry = { status: ct.status, message: ct.message };
                if (ct.status === "pending" && ct.timeclock_corrections) {
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

    if (qEntities.employeeEntities.length === 0) {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: token.colorTextQuaternary }}>
                <Text type="secondary">No employee records found in this organization</Text>
            </div>
        );
    }

    const entitySelector = qEntities.employeeEntities.length > 1 ? (
        <select
            value={selectedEntityIdx}
            onChange={(e) => setSelectedEntityIdx(Number(e.target.value))}
            style={{ padding: "4px 8px", border: `1px solid ${token.colorBorder}`, borderRadius: token.borderRadiusSM, fontSize: token.fontSizeSM, background: token.colorBgContainer }}
        >
            {qEntities.employeeEntities.map((ee, i) => {
                const ent = ee.entities as { name: string; timezone: string } | null;
                return <option key={i} value={i}>{ent?.name ?? "Entity"} · {ent?.timezone ?? ""}</option>;
            })}
        </select>
    ) : null;

    return (
        <div style={{ height: "100%", overflow: "auto", background: token.colorBgContainer }}>
            <App_TimeclockDetailView
                employeeId={employeeId}
                timezone={timezone}
                initialPeriod="week"
                toolbarExtra={entitySelector}
                onDayClick={handleDayClick}
                correctionTasksByDate={correctionTasksByDate}
            />
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
                />
            )}
        </div>
    );
};
