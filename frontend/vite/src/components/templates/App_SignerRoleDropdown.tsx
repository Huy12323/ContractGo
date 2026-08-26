import { Dropdown, Tag, theme } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import type { SignerRole } from "@/types/template.types";
import { const_TemplateRole_OrphanColor } from "./const_TemplateSignerRoleColors";

// Replaces `App_FieldStateDropdown`, which offered three fixed states because
// "who fills this" and "is it required" were one tri-state. Required is now a
// switch in the properties panel; this control answers only "who fills this",
// and its options are the template's own roles rather than a hard-coded list.

type Props = {
    roleId: string;
    signerRoles: SignerRole[];
    onChange: (nextRoleId: string) => void;
    disabled?: boolean;
};

/** Role tag styling — matched to the box border so the two read as one object. */
const roleTagStyle = (color: string): React.CSSProperties => ({
    margin: 0,
    fontSize: 10,
    letterSpacing: 0.4,
    lineHeight: "16px",
    color,
    borderColor: color,
    background: "transparent",
});

export const App_SignerRoleDropdown = ({ roleId, signerRoles, onChange, disabled }: Props) => {
    const { token } = theme.useToken();

    const ordered = signerRoles.slice().sort((a, b) => a.order - b.order);
    const active = ordered.find((r) => r.id === roleId);
    const activeColor = active?.color ?? const_TemplateRole_OrphanColor;
    const activeName = active?.name ?? "Unassigned";

    const items = ordered.map((role) => ({
        key: role.id,
        label: (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginSM,
                    minWidth: 140,
                }}
            >
                <Tag style={roleTagStyle(role.color)}>{role.name}</Tag>
                {role.id === roleId && (
                    <CheckOutlined
                        style={{ fontSize: 12, color: token.colorPrimary, marginLeft: "auto" }}
                    />
                )}
            </div>
        ),
        onClick: () => onChange(role.id),
    }));

    return (
        <Dropdown menu={{ items }} trigger={["click"]} disabled={disabled}>
            <Tag
                style={{
                    ...roleTagStyle(activeColor),
                    cursor: disabled ? "not-allowed" : "pointer",
                    userSelect: "none",
                    opacity: disabled ? 0.6 : 1,
                }}
                onClick={(e) => e.stopPropagation()}
                title={disabled ? undefined : `Filled by ${activeName} — click to change`}
            >
                {activeName}
            </Tag>
        </Dropdown>
    );
};
