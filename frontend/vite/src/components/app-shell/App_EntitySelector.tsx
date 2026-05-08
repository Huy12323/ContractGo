import { useMemo } from "react";
import { Select, theme } from "antd";
import { BankOutlined } from "@ant-design/icons";
import { useQ_Tables_OrgEntities } from "@/hooks/useQ_Tables_OrgEntities";

type Props = {
    organizationId: string;
    value: string;
    onChange: (entityId: string) => void;
};

export const App_EntitySelector = ({ organizationId, value, onChange }: Props) => {
    const { token } = theme.useToken();
    const qEntities = useQ_Tables_OrgEntities({ organizationId });

    const options = useMemo(
        () =>
            qEntities.entities.map((e) => ({
                value: e.id,
                label: `${e.name}${e.timezone ? ` · ${e.timezone}` : ""}`,
            })),
        [qEntities.entities],
    );

    const activeEntity = qEntities.entities.find((e) => e.id === value);

    if (qEntities.entities.length <= 1 && activeEntity) {
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
            loading={qEntities.query.isLoading}
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
