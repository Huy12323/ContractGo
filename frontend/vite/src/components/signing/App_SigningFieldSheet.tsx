// The mobile replacement for `App_DocumentFiller`'s 260px "Your fields" rail.
//
// WHY A STEPPER AND NOT A NARROWER RAIL. The rail is a list, and a list is fine
// when it sits beside the document. Stacked above it on a 390px screen it either
// pushes the page off-screen or scrolls independently of the thing it annotates,
// and the signer loses the correspondence between "the box on the page" and "the
// input I am typing into". The on-page boxes cannot take over either: they are
// sized from `w_pct`/`h_pct` of the page, so a date field on a phone is a ~10px
// tall input — below any usable touch target, and not fixable without moving the
// box, which would move where the value gets burned.
//
// So the document stays a document — read-only, pinchable, scrollable — and this
// sheet is the only place a value is entered. One field at a time, with the page
// scrolled to the box being filled and that box ringed. The signer never hunts.
//
// The sheet is a plain fixed element rather than an ANTD `Drawer`: it has two
// heights (a collapsed bar and an expanded editor), it must never take a mask or
// trap focus — tapping the document behind it is how you jump between fields —
// and expressing all of that through `Drawer` is more override than component.

import { useMemo } from "react";
import { Button, Checkbox, Select, Tag, Typography, theme } from "antd";
import { DownOutlined, LeftOutlined, RightOutlined, UpOutlined } from "@ant-design/icons";
import type { Signing_Field } from "@/hooks/useQ_Signing_Session";

type Props = {
    /** This signer's fillable fields, in the order they appear in the document. */
    fields: Signing_Field[];
    values: Record<string, unknown>;
    onChange: (fieldId: string, value: unknown) => void;
    errors?: Record<string, string>;
    /** Index into `fields`. The parent owns it so the on-page boxes can set it. */
    activeIndex: number;
    onActiveIndexChange: (index: number) => void;
    collapsed: boolean;
    onCollapsedChange: (collapsed: boolean) => void;
    readOnly?: boolean;
    /** Back to the welcome step. */
    onBack: () => void;
    /** On to the sign step. */
    onContinue: () => void;
};

/** The height the collapsed bar occupies, exported so the document pane can
 *  reserve it — otherwise the last page's final field sits under the sheet with
 *  no way to scroll it clear. */
export const const_SigningFieldSheet_CollapsedHeight = 56;

const isMeaningful = (v: unknown): boolean =>
    v !== undefined && v !== null && v !== "" && v !== false;

export const App_SigningFieldSheet = ({
    fields,
    values,
    onChange,
    errors,
    activeIndex,
    onActiveIndexChange,
    collapsed,
    onCollapsedChange,
    readOnly = false,
    onBack,
    onContinue,
}: Props) => {
    const { token } = theme.useToken();

    const missing = useMemo(
        () => fields.filter((f) => f.required && !isMeaningful(values[f.id])),
        [fields, values]
    );

    const active = fields[activeIndex];
    const canGoPrev = activeIndex > 0;
    const canGoNext = activeIndex < fields.length - 1;

    // "The next thing that still needs you", wrapping past the end. Plain `Next`
    // walks the document in order; this is the shortcut for a signer who has
    // skipped around and wants to know what is left.
    const goToNextRequired = () => {
        const order = [...fields.slice(activeIndex + 1), ...fields.slice(0, activeIndex + 1)];
        const target = order.find((f) => f.required && !isMeaningful(values[f.id]));
        if (!target) return;
        onActiveIndexChange(fields.indexOf(target));
    };

    return (
        <div
            style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 20,
                background: token.colorBgContainer,
                borderTop: `1px solid ${token.colorBorder}`,
                borderTopLeftRadius: token.borderRadiusLG,
                borderTopRightRadius: token.borderRadiusLG,
                boxShadow: token.boxShadowSecondary,
                // The home indicator on a notched phone sits over the bottom ~34px.
                // Without this the primary button is under it and mis-taps become
                // "swipe to close the app" on a legally consequential screen.
                paddingBottom: "var(--app-safe-bottom)",
                display: "flex",
                flexDirection: "column",
            }}
        >
            {/* Header — doubles as the collapse toggle, so the whole bar is the
                target rather than just the chevron. */}
            <div
                role="button"
                tabIndex={0}
                onClick={() => onCollapsedChange(!collapsed)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onCollapsedChange(!collapsed);
                }}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginXS,
                    height: const_SigningFieldSheet_CollapsedHeight,
                    padding: `0 ${token.paddingMD}px`,
                    cursor: "pointer",
                    flexShrink: 0,
                }}
            >
                <Typography.Text strong style={{ flex: 1 }}>
                    {fields.length === 0
                        ? "Nothing to fill in"
                        : `Field ${activeIndex + 1} of ${fields.length}`}
                </Typography.Text>

                {!readOnly &&
                    (missing.length > 0 ? (
                        <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                            {missing.length} left
                        </Tag>
                    ) : (
                        <Tag color="success" style={{ marginInlineEnd: 0 }}>
                            All done
                        </Tag>
                    ))}

                {collapsed ? <UpOutlined /> : <DownOutlined />}
            </div>

            {!collapsed && (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: token.marginSM,
                        padding: `0 ${token.paddingMD}px ${token.paddingMD}px`,
                        // The sheet must never grow past half the screen — the
                        // document behind it is what the signer is agreeing to, and
                        // a sheet that covers it is a consent problem, not a layout
                        // one. A long choice list scrolls inside instead.
                        maxHeight: "50vh",
                        overflowY: "auto",
                    }}
                >
                    {active && (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: token.marginXXS,
                            }}
                        >
                            <Typography.Text>
                                {active.label}
                                {active.required && (
                                    <span style={{ color: token.colorError }}> *</span>
                                )}
                            </Typography.Text>

                            <SheetFieldControl
                                field={active}
                                value={values[active.id]}
                                onChange={(v) => onChange(active.id, v)}
                                readOnly={readOnly}
                            />

                            {errors?.[active.id] && (
                                <Typography.Text
                                    type="danger"
                                    style={{ fontSize: token.fontSizeSM }}
                                >
                                    {errors[active.id]}
                                </Typography.Text>
                            )}
                        </div>
                    )}

                    <div style={{ display: "flex", gap: token.marginXS }}>
                        <Button
                            block
                            size="large"
                            icon={<LeftOutlined />}
                            disabled={!canGoPrev}
                            onClick={() => onActiveIndexChange(activeIndex - 1)}
                        >
                            Previous
                        </Button>
                        <Button
                            block
                            size="large"
                            disabled={!canGoNext}
                            onClick={() => onActiveIndexChange(activeIndex + 1)}
                        >
                            Next <RightOutlined />
                        </Button>
                    </div>

                    {missing.length > 0 ? (
                        <>
                            <Button block size="large" type="primary" onClick={goToNextRequired}>
                                Go to next required field
                            </Button>
                            {/* Named, not counted. "2 fields left" sends the signer
                                looking; the labels tell them where to look. */}
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: token.fontSizeSM, textAlign: "center" }}
                            >
                                Still to complete: {missing.map((f) => f.label).join(", ")}
                            </Typography.Text>
                        </>
                    ) : (
                        <Button block size="large" type="primary" onClick={onContinue}>
                            Continue to sign
                        </Button>
                    )}

                    <Button block type="text" onClick={onBack}>
                        Back to document details
                    </Button>
                </div>
            )}
        </div>
    );
};

// ============================================================
// The control
// ============================================================

/**
 * The sheet's twin of `FieldInput` in `App_DocumentFiller`, and deliberately a
 * SEPARATE implementation rather than a shared one.
 *
 * They render the same field types to different requirements: `FieldInput` draws
 * inside the box the sender positioned, so it is a bare HTML control with no
 * padding or radius of its own — anything else would stop matching the burn.
 * This one is a full-width touch target and can look like the rest of the app.
 *
 * What they DO have to agree on is the VALUE each type produces, because both
 * feed the same `field_values` payload that `signing_submit` validates and
 * `pdfBurn` renders. Hence native `<input>` for text/number/date here too — an
 * ANTD `DatePicker` yields a dayjs object and an `InputNumber` a number, where
 * the document surface yields the raw string in both cases. Same payload from
 * either surface, no server-side branch on which one the signer used.
 */
const SheetFieldControl = ({
    field,
    value,
    onChange,
    readOnly,
}: {
    field: Signing_Field;
    value: unknown;
    onChange: (value: unknown) => void;
    readOnly: boolean;
}) => {
    const { token } = theme.useToken();

    if (field.type === "checkbox") {
        return (
            <Checkbox
                disabled={readOnly}
                checked={value === true || value === "true"}
                onChange={(e) => onChange(e.target.checked)}
                // The label is already above; this is padding for the finger.
                style={{ padding: `${token.paddingSM}px 0` }}
            >
                {field.label}
            </Checkbox>
        );
    }

    if (field.type === "choice") {
        return (
            <Select
                size="large"
                style={{ width: "100%" }}
                disabled={readOnly}
                placeholder={field.label}
                value={typeof value === "string" && value !== "" ? value : undefined}
                onChange={(v) => onChange(v ?? "")}
                options={field.options ?? []}
                allowClear
            />
        );
    }

    // A native control, not an ANTD one: `type="date"` opens the platform date
    // wheel and `type="number"` the numeric keypad, and neither is something an
    // ANTD component gives a phone.
    return (
        <input
            type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
            disabled={readOnly}
            placeholder={field.label}
            value={
                value === undefined || value === null
                    ? ""
                    : typeof value === "string"
                      ? value
                      : String(value)
            }
            onChange={(e) => onChange(e.target.value)}
            style={{
                width: "100%",
                boxSizing: "border-box",
                minHeight: 44,
                padding: `${token.paddingXS}px ${token.paddingSM}px`,
                border: `1px solid ${token.colorBorder}`,
                borderRadius: token.borderRadius,
                background: token.colorBgContainer,
                color: token.colorText,
                fontFamily: "inherit",
                // 16px exactly. Below it, iOS Safari zooms the page on focus and
                // leaves it zoomed — which on this page means a signer who taps one
                // field and can no longer see the document.
                fontSize: 16,
            }}
        />
    );
};
