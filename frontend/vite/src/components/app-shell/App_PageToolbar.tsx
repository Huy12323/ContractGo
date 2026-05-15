import { theme } from "antd";
import { App_EntitySelector } from "@/components/app-shell/App_EntitySelector";

const TOOLBAR_HEIGHT = 48;

type Props = {
    organizationId: string;
    entityId: string;
    onEntityChange: (entityId: string) => void;
    actions?: React.ReactNode;
    entityScope?: "organization" | "employee";
};

export const App_PageToolbar = ({ organizationId, entityId, onEntityChange, actions, entityScope }: Props) => {
    const { token } = theme.useToken();

    return (
        <div style={{
            height: TOOLBAR_HEIGHT,
            minHeight: TOOLBAR_HEIGHT,
            display: "flex",
            alignItems: "center",
            padding: `0 ${token.paddingMD}px`,
            borderBottom: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
            gap: token.marginMD,
        }}>
            <App_EntitySelector
                organizationId={organizationId}
                value={entityId}
                onChange={onEntityChange}
                scope={entityScope}
            />
            {actions && (
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                    {actions}
                </div>
            )}
        </div>
    );
};

export { TOOLBAR_HEIGHT };
