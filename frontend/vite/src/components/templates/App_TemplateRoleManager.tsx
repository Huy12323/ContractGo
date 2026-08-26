import { App, Button, ColorPicker, Input, InputNumber, Tooltip, Typography, theme } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { SignerRole, TemplateLayout } from "@/types/template.types";
import { utils_TemplateRoles_Create } from "./const_TemplateSignerRoleColors";

// The roles rail of the template builder.
//
// This is the control that has no v1 counterpart: a template used to have
// exactly two implicit parties (HR and "the employee"), encoded as a boolean per
// field. Roles make the party list data, which is what lets one template be sent
// to a counterparty, a witness and an internal approver.
//
// `order` is the signing sequence the envelope will route by (roles sharing an
// order sign in parallel), so it is edited here rather than derived from array
// position — dragging a row must not silently change who signs first.

type Props = {
    signerRoles: SignerRole[];
    onChange: (next: SignerRole[]) => void;
    /** Used to block deleting a role that fields still point at, and to show coverage. */
    layout: TemplateLayout;
    /** Filters the canvas to one role's fields; null shows every role. */
    highlightedRoleId: string | null;
    onHighlightRole: (roleId: string | null) => void;
};

export const App_TemplateRoleManager = ({
    signerRoles,
    onChange,
    layout,
    highlightedRoleId,
    onHighlightRole,
}: Props) => {
    const { token } = theme.useToken();
    const { message } = App.useApp();

    const ordered = signerRoles.slice().sort((a, b) => a.order - b.order);

    const patchRole = (roleId: string, patch: Partial<SignerRole>) =>
        onChange(signerRoles.map((r) => (r.id === roleId ? { ...r, ...patch } : r)));

    const removeRole = (role: SignerRole) => {
        const usedBy = layout.filter((f) => f.role_id === role.id).length;
        if (usedBy > 0) {
            // Deleting the role would leave orphaned `role_id`s in the layout — fields
            // nobody is asked to fill, which fails silently at send time rather than here.
            message.warning(
                `${role.name} still has ${usedBy} field${usedBy === 1 ? "" : "s"}. Reassign or remove them first.`
            );
            return;
        }
        if (signerRoles.length === 1) {
            message.warning("A template needs at least one signer role.");
            return;
        }
        onChange(signerRoles.filter((r) => r.id !== role.id));
        if (highlightedRoleId === role.id) onHighlightRole(null);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginXS }}>
            <div style={{ display: "flex", alignItems: "center" }}>
                <Typography.Text strong style={{ fontSize: token.fontSizeSM }}>
                    Signer roles
                </Typography.Text>
                {highlightedRoleId && (
                    <Button
                        type="link"
                        size="small"
                        style={{ marginLeft: "auto", padding: 0 }}
                        onClick={() => onHighlightRole(null)}
                    >
                        Show all
                    </Button>
                )}
            </div>

            {ordered.map((role) => {
                const fieldCount = layout.filter((f) => f.role_id === role.id).length;
                const isHighlighted = highlightedRoleId === role.id;
                return (
                    <div
                        key={role.id}
                        onClick={() => onHighlightRole(isHighlighted ? null : role.id)}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: token.marginXXS,
                            padding: token.paddingXXS,
                            borderRadius: token.borderRadius,
                            border: `1px solid ${isHighlighted ? role.color : token.colorBorderSecondary}`,
                            background: isHighlighted ? token.colorFillQuaternary : "transparent",
                            cursor: "pointer",
                        }}
                    >
                        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex" }}>
                            <ColorPicker
                                size="small"
                                value={role.color}
                                disabledAlpha
                                onChangeComplete={(color) =>
                                    patchRole(role.id, { color: color.toHexString() })
                                }
                            />
                        </div>
                        <Input
                            size="small"
                            value={role.name}
                            variant="borderless"
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => patchRole(role.id, { name: e.target.value })}
                            style={{ flex: 1, minWidth: 0, paddingInline: token.paddingXXS }}
                        />
                        <Tooltip title="Signing order — roles sharing a number sign in parallel">
                            <InputNumber
                                size="small"
                                min={1}
                                value={role.order}
                                controls={false}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(value) =>
                                    patchRole(role.id, { order: value ?? role.order })
                                }
                                style={{ width: 44 }}
                            />
                        </Tooltip>
                        <Typography.Text
                            type="secondary"
                            style={{ fontSize: token.fontSizeSM, minWidth: 20, textAlign: "right" }}
                            title={`${fieldCount} field${fieldCount === 1 ? "" : "s"}`}
                        >
                            {fieldCount}
                        </Typography.Text>
                        <Button
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={(e) => {
                                e.stopPropagation();
                                removeRole(role);
                            }}
                        />
                    </div>
                );
            })}

            <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => onChange([...signerRoles, utils_TemplateRoles_Create(signerRoles)])}
            >
                Add role
            </Button>
        </div>
    );
};
