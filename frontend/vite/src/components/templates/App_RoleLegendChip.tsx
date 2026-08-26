import { Popover, Button, Tag, Typography, theme } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import type { SignerRole, TemplateLayout } from "@/types/template.types";

// Replaces `App_FieldLegendChip`, whose three rows were static prose about the
// HR / mandatory / optional states. A template's roles are now data, so the
// legend is generated from them — and it doubles as a coverage check, because a
// role with no fields will never be asked to do anything when the document is
// sent.

type Props = {
    signerRoles: SignerRole[];
    layout: TemplateLayout;
};

export const App_RoleLegendChip = ({ signerRoles, layout }: Props) => {
    const { token } = theme.useToken();

    const ordered = signerRoles.slice().sort((a, b) => a.order - b.order);

    const content = (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: token.marginXXS,
                maxWidth: 380,
            }}
        >
            {ordered.map((role) => {
                const fields = layout.filter((f) => f.role_id === role.id);
                const requiredCount = fields.filter((f) => f.required).length;
                return (
                    <div
                        key={role.id}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: token.marginSM,
                            paddingBlock: token.paddingXXS,
                        }}
                    >
                        <Tag
                            style={{
                                margin: 0,
                                fontSize: 10,
                                letterSpacing: 0.4,
                                lineHeight: "16px",
                                minWidth: 96,
                                textAlign: "center",
                                color: role.color,
                                borderColor: role.color,
                                background: "transparent",
                            }}
                        >
                            {role.name}
                        </Tag>
                        <Typography.Text
                            type={fields.length === 0 ? "warning" : "secondary"}
                            style={{ fontSize: token.fontSizeSM }}
                        >
                            {fields.length === 0
                                ? "No fields — this party has nothing to fill"
                                : `${fields.length} field${fields.length === 1 ? "" : "s"}, ${requiredCount} required`}
                        </Typography.Text>
                    </div>
                );
            })}
        </div>
    );

    return (
        <Popover content={content} trigger="click" placement="bottomLeft" title="Signer roles">
            <Button
                type="text"
                size="small"
                icon={<QuestionCircleOutlined />}
                aria-label="Signer role legend"
            />
        </Popover>
    );
};
