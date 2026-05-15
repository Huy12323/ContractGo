import { useState, useMemo } from "react";
import { useMatch } from "@tanstack/react-router";
import { Tabs, Typography, theme } from "antd";
import { App_PageToolbar } from "@/components/app-shell/App_PageToolbar";
import { useQ_Tables_OrgEntities } from "@/hooks/useQ_Tables_OrgEntities";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";
import { useQ_Tables_MyEmployeeEntities } from "@/hooks/useQ_Tables_MyEmployeeEntities";
import { useQ_PageApps_MyManagerDepartments } from "@/hooks/useQ_PageApps_MyManagerDepartments";
import { PageApps_Tasks_CorrectionsTab } from "./PageApps_Tasks_CorrectionsTab";

const { Text } = Typography;

export const PageApps_Tasks = () => {
    const { token } = theme.useToken();
    const organizationId = useMatch({ from: "/_protected/$organizationId", shouldThrow: false, select: (m) => m.params.organizationId }) ?? "";
    const qEntities = useQ_Tables_OrgEntities({ organizationId });
    const qRole = useQ_Tables_MyRole({ organizationId });
    const role = qRole.role;
    const isHR = role === "owner" || role === "admin";

    const [entityId, setEntityId] = useState("");
    const activeEntityId = entityId || qEntities.entities[0]?.id || "";
    const activeEntity = qEntities.entities.find((e) => e.id === activeEntityId);
    const approvalMode = activeEntity?.correction_approval_mode ?? "hr_only";

    const qMyEntities = useQ_Tables_MyEmployeeEntities({ organizationId });
    const myEmployeeId = qMyEntities.employeeEntities.find((e) => e.entity_id === activeEntityId)?.id ?? "";
    const qManagerDepts = useQ_PageApps_MyManagerDepartments({ entityId: activeEntityId });
    const managedDeptIds = useMemo(() => new Set(qManagerDepts.managedDepartments.map((d) => d.department_id)), [qManagerDepts.managedDepartments]);

    const canSeeCorrections = isHR || (qManagerDepts.isManager && approvalMode !== "hr_only");

    if (!entityId && qEntities.entities[0]) {
        setEntityId(qEntities.entities[0].id);
    }

    const [activeTab, setActiveTab] = useState("corrections");

    const tabNav = [
        ...(canSeeCorrections ? [{ key: "corrections", label: "Corrections" }] : []),
    ];

    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", background: token.colorBgContainer }}>
            <App_PageToolbar organizationId={organizationId} entityId={activeEntityId} onEntityChange={setEntityId} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: `0 ${token.paddingLG}px ${token.paddingLG}px` }}>
                {!canSeeCorrections ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}>
                        <Text type="secondary">No tasks available for your role</Text>
                    </div>
                ) : (
                    <>
                        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabNav} style={{ flexShrink: 0 }} />
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                            {activeTab === "corrections" && (
                                <PageApps_Tasks_CorrectionsTab
                                    entityId={activeEntityId}
                                    organizationId={organizationId}
                                    isHR={isHR}
                                    isManager={qManagerDepts.isManager}
                                    approvalMode={approvalMode}
                                    myEmployeeId={myEmployeeId}
                                    managedDeptIds={managedDeptIds}
                                />
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
