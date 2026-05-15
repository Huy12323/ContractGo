import { useState, useMemo } from "react";
import { Tag, Typography, Spin, Segmented, theme } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { useQ_PageApps_EntityCorrectionTasks } from "@/hooks/useQ_PageApps_EntityCorrectionTasks";
import type { PageApps_EntityCorrectionTasks_QueryData } from "@/hooks/useQ_PageApps_EntityCorrectionTasks";
import { PageApps_Tasks_CorrectionReviewModal } from "./PageApps_Tasks_CorrectionReviewModal";

const { Text } = Typography;

type CorrectionTask = PageApps_EntityCorrectionTasks_QueryData[number];

const STATUS_CONFIG: Record<string, { color: string; label: string; tagColor: string }> = {
    pending: { color: "#fa8c16", label: "Pending", tagColor: "warning" },
    manager_approved: { color: "#1677ff", label: "Manager Approved", tagColor: "processing" },
    approved: { color: "#52c41a", label: "Approved", tagColor: "success" },
    rejected: { color: "#ff4d4f", label: "Rejected", tagColor: "error" },
    cancelled: { color: "#8c8c8c", label: "Cancelled", tagColor: "default" },
};

type FilterMode = "actionable" | "all";

type Props = {
    entityId: string;
    organizationId: string;
    isHR: boolean;
    isManager: boolean;
    approvalMode: string;
    myEmployeeId: string;
    managedDeptIds: Set<string>;
};

export const PageApps_Tasks_CorrectionsTab = ({ entityId, isHR, isManager, approvalMode, myEmployeeId, managedDeptIds }: Props) => {
    const showAdminCol = approvalMode === "hr_only" || approvalMode === "both";
    const { token } = theme.useToken();
    const qCorrections = useQ_PageApps_EntityCorrectionTasks({ entityId });
    const [filter, setFilter] = useState<FilterMode>("actionable");
    const [reviewTask, setReviewTask] = useState<CorrectionTask | null>(null);

    const isRelevant = useMemo(() => (ct: CorrectionTask) => {
        if (isHR) return true;
        if (ct.employee_id !== myEmployeeId) return true;
        const depts = (ct.rel__correction_task__department ?? []) as { department_id: string }[];
        return depts.some((d) => managedDeptIds.has(d.department_id));
    }, [isHR, myEmployeeId, managedDeptIds]);

    const actionableCount = useMemo(() => qCorrections.correctionTasks.filter((ct) => {
        if (!isRelevant(ct)) return false;
        if (ct.status === "pending") return true;
        if (ct.status === "manager_approved" && isHR) return true;
        return false;
    }).length, [qCorrections.correctionTasks, isRelevant, isHR]);

    const filteredTasks = useMemo(() => {
        if (filter === "actionable") {
            return qCorrections.correctionTasks.filter((ct) => {
                if (!isRelevant(ct)) return false;
                if (ct.status === "pending") return true;
                if (ct.status === "manager_approved" && isHR) return true;
                return false;
            });
        }
        return qCorrections.correctionTasks.filter((ct) => ct.status !== "cancelled" && isRelevant(ct));
    }, [qCorrections.correctionTasks, filter, isRelevant, isHR]);

    if (qCorrections.query.isLoading) {
        return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spin /></div>;
    }

    const gridCols = showAdminCol ? "2fr 1fr 1.5fr 2fr 0.8fr 1.2fr 1.2fr" : "2fr 1fr 1.5fr 2fr 1.2fr 1.2fr";

    return (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: token.marginMD }}>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Segmented
                    size="small"
                    value={filter}
                    onChange={(v) => setFilter(v as FilterMode)}
                    options={[
                        { label: `Actionable (${actionableCount})`, value: "actionable" },
                        { label: "All", value: "all" },
                    ]}
                />
            </div>

            {filteredTasks.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center" }}>
                    <Text type="secondary">{filter === "actionable" ? "No corrections need your action" : "No correction requests"}</Text>
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, overflow: "hidden" }}>
                    {/* Header */}
                    <div style={{
                        flexShrink: 0, display: "grid", gridTemplateColumns: gridCols,
                        padding: "8px 16px", background: token.colorFillAlter, borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Employee</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>Day</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>Status</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>Dept. Approvals</Text>
                        {showAdminCol && <Text type="secondary" style={{ fontSize: 11 }}>Admin</Text>}
                        <Text type="secondary" style={{ fontSize: 11 }}>Created</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>Updated</Text>
                    </div>
                    {/* Rows */}
                    <div style={{ flex: 1, overflowY: "auto" }}>
                    {filteredTasks.map((ct) => {
                        const emp = ct.employees as { first_name: string | null; last_name: string | null; email: string; __full_name: string | null } | null;
                        const empName = emp?.__full_name ?? (`${emp?.first_name ?? ""} ${emp?.last_name ?? ""}`.trim() || emp?.email || "—");
                        const dayDate = (ct.days as { date: string } | null)?.date ?? "—";
                        const cfg = STATUS_CONFIG[ct.status] ?? STATUS_CONFIG.pending!;
                        const deptApprovals = (ct.rel__correction_task__department ?? []) as { department_id: string; decision: string | null; decided_by: string | null; decided_at: string | null; departments: { id: string; name: string } | null }[];

                        const adminDecision = ct.admin_decision as string | null;

                        return (
                            <div
                                key={ct.id}
                                onClick={() => setReviewTask(ct)}
                                style={{
                                    display: "grid", gridTemplateColumns: showAdminCol ? "2fr 1fr 1.5fr 2fr 0.8fr 1.2fr 1.2fr" : "2fr 1fr 1.5fr 2fr 1.2fr 1.2fr",
                                    padding: "10px 16px", alignItems: "center", cursor: "pointer",
                                    borderBottom: `1px solid ${token.colorFillAlter}`,
                                    borderLeft: `3px solid ${cfg.color}`,
                                }}
                            >
                                <Text style={{ fontSize: 13, fontWeight: 500 }}>{empName}</Text>
                                <Text type="secondary" style={{ fontSize: 12 }}>{dayDate}</Text>
                                <div><Tag color={cfg.tagColor} style={{ fontSize: 11 }}>{cfg.label}</Tag></div>
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                    {deptApprovals.length === 0 && <Text type="secondary" style={{ fontSize: 11 }}>—</Text>}
                                    {deptApprovals.map((da) => {
                                        const deptColor = da.decision === "rejected" ? "error" : da.decision === "approved" ? "success" : "default";
                                        const deptIcon = da.decision === "rejected" ? <CloseCircleOutlined /> : da.decision === "approved" ? <CheckCircleOutlined /> : undefined;
                                        return (
                                            <Tag
                                                key={da.department_id}
                                                color={deptColor}
                                                style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}
                                                icon={deptIcon}
                                            >
                                                {da.departments?.name ?? "Dept"}
                                            </Tag>
                                        );
                                    })}
                                </div>
                                {showAdminCol && (
                                    <div>
                                        {adminDecision ? (
                                            <Tag
                                                color={adminDecision === "rejected" ? "error" : "success"}
                                                style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}
                                                icon={adminDecision === "rejected" ? <CloseCircleOutlined /> : <CheckCircleOutlined />}
                                            >
                                                {adminDecision === "rejected" ? "Rejected" : "Approved"}
                                            </Tag>
                                        ) : (
                                            <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
                                        )}
                                    </div>
                                )}
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                    {ct.created_at ? new Date(ct.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                                </Text>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                    {ct.updated_at && ct.created_at && ct.updated_at !== ct.created_at
                                        ? new Date(ct.updated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                                        : "—"}
                                </Text>
                            </div>
                        );
                    })}
                    </div>
                </div>
            )}

            {reviewTask && (
                <PageApps_Tasks_CorrectionReviewModal
                    open
                    onClose={() => setReviewTask(null)}
                    correctionTask={reviewTask}
                    isHR={isHR}
                    isManager={isManager}
                    approvalMode={approvalMode}
                    entityId={entityId}
                />
            )}
        </div>
    );
};
