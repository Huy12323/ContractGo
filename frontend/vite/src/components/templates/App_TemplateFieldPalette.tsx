import { useMemo } from "react";
import { Badge, Empty, Input, Tooltip, Typography, theme } from "antd";
import {
    AlignLeftOutlined,
    CalendarOutlined,
    CheckSquareOutlined,
    DownSquareOutlined,
    EditOutlined,
    FieldNumberOutlined,
    HighlightOutlined,
    PaperClipOutlined,
    SearchOutlined,
} from "@ant-design/icons";
import type { SignerRole, TemplateField, TemplateField_Type } from "@/types/template.types";
import {
    const_TemplateFieldTypeOptions,
    utils_Templates_NextFieldKey,
} from "./const_TemplateFieldTypeOptions";

type Props = {
    /** Fields already placed on the document — drives the "on this document" list. */
    placedFields: TemplateField[];
    signerRoles: SignerRole[];
    /** Arms a click-to-drop. The builder consumes this on the next page click. */
    onArmField: (field: { key: string; label: string; type: TemplateField_Type }) => void;
    selectedFieldId: string | null;
    onSelectField: (fieldId: string) => void;
    /**
     * Restricts which field types the palette offers, in the catalogue's own
     * order. Omitted means all of them, which is what both template-authoring
     * hosts want.
     *
     * Added for the no-account trial (CG-052), which offers signature, text and
     * date only — a demo has to be finishable in a minute, and the excluded
     * types each cost a concept with nothing to show for it there (an options
     * editor for `choice`, a second capture UI for `initials`, and `attachment`
     * draws nothing at all when the document is burned).
     */
    allowedTypes?: TemplateField_Type[];
};

/** Exported so a placed box on the canvas carries the SAME glyph the palette entry
 *  it was dropped from does — that pairing is how a user reads the page at a
 *  glance. Lives here rather than in `const_TemplateFieldTypeOptions` only
 *  because that file is `.ts` and these are JSX. */
export const const_TemplateFieldTypeIcons: Record<TemplateField_Type, React.ReactNode> = {
    text: <AlignLeftOutlined />,
    number: <FieldNumberOutlined />,
    date: <CalendarOutlined />,
    choice: <DownSquareOutlined />,
    checkbox: <CheckSquareOutlined />,
    signature: <EditOutlined />,
    initials: <HighlightOutlined />,
    attachment: <PaperClipOutlined />,
};

/**
 * The template builder's field source.
 *
 * Replaces the employee-column palette. Previously each palette entry WAS an
 * `employee_columns` row and could be placed exactly once; now entries are field
 * TYPES and each click mints a new field, so a document can carry three separate
 * date fields without three columns existing somewhere.
 */
export const App_TemplateFieldPalette = ({
    placedFields,
    signerRoles,
    onArmField,
    selectedFieldId,
    onSelectField,
    allowedTypes,
}: Props) => {
    const { token } = theme.useToken();

    // Filtered from the catalogue rather than built from `allowedTypes`, so the
    // palette's order stays the catalogue's order regardless of the order a
    // caller happens to list its types in.
    const typeOptions = useMemo(
        () =>
            allowedTypes
                ? const_TemplateFieldTypeOptions.filter((o) => allowedTypes.includes(o.value))
                : const_TemplateFieldTypeOptions,
        [allowedTypes]
    );

    const rolesById = useMemo(
        () => Object.fromEntries(signerRoles.map((r) => [r.id, r])),
        [signerRoles]
    );

    const existingKeys = useMemo(() => placedFields.map((f) => f.key), [placedFields]);

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: token.marginSM,
                height: "100%",
            }}
        >
            <div>
                <Typography.Text strong style={{ fontSize: token.fontSizeSM }}>
                    Add a field
                </Typography.Text>
                <Typography.Paragraph
                    type="secondary"
                    style={{ fontSize: token.fontSizeSM, marginBottom: token.marginXS }}
                >
                    Pick a type, then click the page to place it.
                </Typography.Paragraph>

                <div
                    style={{
                        display: "grid",
                        // Was a hard `1fr 1fr`, which forced two columns into
                        // whatever width the rail had. Auto-fill drops to one
                        // column rather than squeezing both below a readable label.
                        gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                        gap: token.marginXXS,
                    }}
                >
                    {typeOptions.map((option) => (
                        <Tooltip key={option.value} title={option.hint} placement="right">
                            <div
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                    onArmField({
                                        key: utils_Templates_NextFieldKey(
                                            option.value,
                                            existingKeys
                                        ),
                                        label: option.label,
                                        type: option.value,
                                    })
                                }
                                onKeyDown={(e) =>
                                    (e.key === "Enter" || e.key === " ") &&
                                    onArmField({
                                        key: utils_Templates_NextFieldKey(
                                            option.value,
                                            existingKeys
                                        ),
                                        label: option.label,
                                        type: option.value,
                                    })
                                }
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: token.marginXXS,
                                    padding: `${token.paddingXXS}px ${token.paddingXS}px`,
                                    border: `1px solid ${token.colorBorder}`,
                                    borderRadius: token.borderRadius,
                                    cursor: "pointer",
                                    background: token.colorBgContainer,
                                    userSelect: "none",
                                }}
                            >
                                <span style={{ color: token.colorPrimary }}>
                                    {const_TemplateFieldTypeIcons[option.value]}
                                </span>
                                <Typography.Text style={{ fontSize: token.fontSizeSM }}>
                                    {option.label}
                                </Typography.Text>
                            </div>
                        </Tooltip>
                    ))}
                </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <Typography.Text strong style={{ fontSize: token.fontSizeSM }}>
                    On this document{" "}
                    <Typography.Text type="secondary">({placedFields.length})</Typography.Text>
                </Typography.Text>

                {placedFields.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="No fields placed yet"
                        style={{ marginTop: token.marginMD }}
                    />
                ) : (
                    <div style={{ overflowY: "auto", marginTop: token.marginXS }}>
                        {placedFields.map((field) => {
                            const role = rolesById[field.role_id];
                            const isSelected = field.id === selectedFieldId;
                            return (
                                <div
                                    key={field.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => onSelectField(field.id)}
                                    onKeyDown={(e) =>
                                        (e.key === "Enter" || e.key === " ") &&
                                        onSelectField(field.id)
                                    }
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: token.marginXXS,
                                        padding: `${token.paddingXXS}px ${token.paddingXS}px`,
                                        borderRadius: token.borderRadius,
                                        cursor: "pointer",
                                        background: isSelected
                                            ? token.colorPrimaryBg
                                            : "transparent",
                                    }}
                                >
                                    <Badge color={role?.color ?? token.colorTextQuaternary} />
                                    <span style={{ color: token.colorTextSecondary }}>
                                        {const_TemplateFieldTypeIcons[field.type]}
                                    </span>
                                    <Typography.Text
                                        ellipsis
                                        style={{ flex: 1, fontSize: token.fontSizeSM }}
                                    >
                                        {field.label}
                                    </Typography.Text>
                                    {field.required && (
                                        <Typography.Text type="danger" title="Required">
                                            *
                                        </Typography.Text>
                                    )}
                                    <Typography.Text
                                        type="secondary"
                                        style={{ fontSize: token.fontSizeSM }}
                                    >
                                        p{field.page}
                                    </Typography.Text>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

/** Kept alongside the palette so search stays a pure function of the field list. */
export const utils_TemplateFieldPalette_Filter = (
    fields: TemplateField[],
    search: string
): TemplateField[] => {
    const q = search.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
        (f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q)
    );
};

export const App_TemplateFieldPalette_Search = ({
    value,
    onChange,
}: {
    value: string;
    onChange: (next: string) => void;
}) => (
    <Input
        allowClear
        size="small"
        prefix={<SearchOutlined />}
        placeholder="Search fields"
        value={value}
        onChange={(e) => onChange(e.target.value)}
    />
);
