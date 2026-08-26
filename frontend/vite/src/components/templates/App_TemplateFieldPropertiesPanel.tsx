import { useMemo } from "react";
import { Button, Divider, Empty, Input, Select, Switch, Typography, theme } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type {
    SignerRole,
    TemplateField,
    TemplateField_Option,
    TemplateField_Type,
} from "@/types/template.types";
import { const_TemplateFieldTypeOptions } from "./const_TemplateFieldTypeOptions";

type Props = {
    field: TemplateField | null;
    signerRoles: SignerRole[];
    onPatch: (fieldId: string, patch: Partial<TemplateField>) => void;
    onDelete: (fieldId: string) => void;
    /** Keys already in use, so duplicates can be rejected inline. */
    existingKeys: string[];
};

/**
 * Edits one placed field.
 *
 * This is where the two axes CG-001 separated become visible to the user:
 * "Filled by" (which signer role) and "Required" used to be a single tri-state
 * (hr / mandatory / optional) that could not express "the sender fills this and
 * it is required", nor any role beyond HR.
 *
 * Choice options are edited here too — they used to live in
 * `employee_column_choices` and are now inlined on the field, which is what lets
 * a sent document render after its template is deleted.
 */
export const App_TemplateFieldPropertiesPanel = ({
    field,
    signerRoles,
    onPatch,
    onDelete,
    existingKeys,
}: Props) => {
    const { token } = theme.useToken();

    const keyConflict = useMemo(() => {
        if (!field) return false;
        return existingKeys.filter((k) => k === field.key).length > 1;
    }, [field, existingKeys]);

    if (!field) {
        return (
            <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Select a field to edit it"
                style={{ marginTop: token.marginXL }}
            />
        );
    }

    const options = field.options ?? [];

    const patchOptions = (next: TemplateField_Option[]) => onPatch(field.id, { options: next });

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
            <div>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    Label
                </Typography.Text>
                <Input
                    size="small"
                    value={field.label}
                    onChange={(e) => onPatch(field.id, { label: e.target.value })}
                    placeholder="Shown to the signer"
                />
            </div>

            <div>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    Key
                </Typography.Text>
                <Input
                    size="small"
                    value={field.key}
                    status={keyConflict ? "error" : undefined}
                    onChange={(e) => onPatch(field.id, { key: e.target.value })}
                    placeholder="merge_field_key"
                />
                <Typography.Text
                    type={keyConflict ? "danger" : "secondary"}
                    style={{ fontSize: token.fontSizeSM }}
                >
                    {keyConflict
                        ? "Another field already uses this key"
                        : "How the API and merge data address this field"}
                </Typography.Text>
            </div>

            <div>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    Type
                </Typography.Text>
                <Select
                    size="small"
                    style={{ width: "100%" }}
                    value={field.type}
                    onChange={(next: TemplateField_Type) =>
                        onPatch(field.id, {
                            type: next,
                            // Options are meaningless off a choice field; drop them rather
                            // than leaving orphaned data on the record.
                            ...(next === "choice" ? {} : { options: undefined }),
                        })
                    }
                    options={const_TemplateFieldTypeOptions.map((o) => ({
                        value: o.value,
                        label: o.label,
                    }))}
                />
            </div>

            <div>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    Filled by
                </Typography.Text>
                <Select
                    size="small"
                    style={{ width: "100%" }}
                    value={field.role_id}
                    onChange={(next: string) => onPatch(field.id, { role_id: next })}
                    options={signerRoles
                        .slice()
                        .sort((a, b) => a.order - b.order)
                        .map((r) => ({ value: r.id, label: r.name }))}
                />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: token.marginXS }}>
                <Switch
                    size="small"
                    checked={field.required}
                    onChange={(checked) => onPatch(field.id, { required: checked })}
                />
                <Typography.Text style={{ fontSize: token.fontSizeSM }}>Required</Typography.Text>
            </div>

            {field.type === "choice" && (
                <>
                    <Divider style={{ margin: `${token.marginXS}px 0` }} />
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        Options
                    </Typography.Text>
                    {options.map((option, index) => (
                        <div
                            key={index}
                            style={{ display: "flex", gap: token.marginXXS, alignItems: "center" }}
                        >
                            <Input
                                size="small"
                                value={option.label}
                                placeholder="Label"
                                onChange={(e) =>
                                    patchOptions(
                                        options.map((o, i) =>
                                            i === index
                                                ? { label: e.target.value, value: e.target.value }
                                                : o
                                        )
                                    )
                                }
                            />
                            <Button
                                size="small"
                                type="text"
                                icon={<DeleteOutlined />}
                                onClick={() => patchOptions(options.filter((_, i) => i !== index))}
                            />
                        </div>
                    ))}
                    <Button
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => patchOptions([...options, { label: "", value: "" }])}
                    >
                        Add option
                    </Button>
                </>
            )}

            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Button
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => onDelete(field.id)}
            >
                Remove field
            </Button>
        </div>
    );
};
