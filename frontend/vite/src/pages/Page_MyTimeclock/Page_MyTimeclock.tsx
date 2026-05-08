import { useState } from "react";
import { useMatch } from "@tanstack/react-router";
import { Typography, theme } from "antd";
import { useQ_Tables_MyEmployeeEntities } from "@/hooks/useQ_Tables_MyEmployeeEntities";
import { App_TimeclockDetailView } from "@/components/timeclock/App_TimeclockDetailView";

const { Text } = Typography;

export const Page_MyTimeclock = () => {
    const { token } = theme.useToken();
    const organizationId = useMatch({ from: "/_protected/$organizationId", shouldThrow: false, select: (m) => m.params.organizationId }) ?? "";
    const qEntities = useQ_Tables_MyEmployeeEntities({ organizationId });

    const [selectedEntityIdx, setSelectedEntityIdx] = useState(0);

    const selectedEntity = qEntities.employeeEntities[selectedEntityIdx];
    const entity = selectedEntity?.entities as { id: string; name: string; timezone: string } | null;
    const employeeId = selectedEntity?.id ?? "";
    const timezone = entity?.timezone ?? "UTC";

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
            />
        </div>
    );
};
