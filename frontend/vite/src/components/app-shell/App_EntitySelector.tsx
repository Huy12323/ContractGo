import { useMemo } from "react";
import { Select, theme } from "antd";
import { BankOutlined } from "@ant-design/icons";
import { useQ_Tables_OrgEntities } from "@/hooks/useQ_Tables_OrgEntities";
import { useQ_Tables_MyEmployeeEntities } from "@/hooks/useQ_Tables_MyEmployeeEntities";

type Props = {
    organizationId: string;
    value: string;
    onChange: (entityId: string) => void;
    scope?: "organization" | "employee";
};

export const App_EntitySelector = ({ organizationId, value, onChange, scope = "organization" }: Props) => {
    const { token } = theme.useToken();
    const qOrgEntities = useQ_Tables_OrgEntities({ organizationId });
    const qMyEntities = useQ_Tables_MyEmployeeEntities({ organizationId });

    const entities = useMemo(() => {
        if (scope === "employee") {
            return qMyEntities.employeeEntities.map((ee) => {
                const ent = ee.entities as { id: string; name: string; timezone: string } | null;
                return { id: ent?.id ?? ee.entity_id, name: ent?.name ?? "Entity", timezone: ent?.timezone ?? "" };
            });
        }
        return qOrgEntities.entities.map((e) => ({ id: e.id, name: e.name, timezone: e.timezone }));
    }, [scope, qOrgEntities.entities, qMyEntities.employeeEntities]);

    const isLoading = scope === "employee" ? qMyEntities.query.isLoading : qOrgEntities.query.isLoading;

    const options = useMemo(
        () => entities.map((e) => ({ value: e.id, label: `${e.name}${e.timezone ? ` · ${e.timezone}` : ""}` })),
        [entities],
    );

    const activeEntity = entities.find((e) => e.id === value);

    if (entities.length <= 1 && activeEntity) {
        return (
            <div
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 14px",
                    border: `1.5px solid ${token.colorPrimary}`,
                    borderRadius: token.borderRadiusLG,
                    background: token.colorPrimaryBg,
                    fontSize: 14,
                    fontWeight: 600,
                    color: token.colorPrimary,
                }}
            >
                <BankOutlined style={{ fontSize: 16 }} />
                {activeEntity.name}
                {activeEntity.timezone && (
                    <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.7 }}>{activeEntity.timezone}</span>
                )}
            </div>
        );
    }

    return (
        <Select
            value={value || undefined}
            onChange={onChange}
            loading={isLoading}
            options={options}
            placeholder="Select entity..."
            popupMatchSelectWidth={false}
            suffixIcon={<BankOutlined style={{ color: token.colorPrimary }} />}
            style={{
                width: 300,
                fontWeight: 600,
                fontSize: 14,
            }}
            className="entity-selector-bold"
        />
    );
};
