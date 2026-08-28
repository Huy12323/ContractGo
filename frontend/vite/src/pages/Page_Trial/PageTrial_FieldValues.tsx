// The values rail on step 2 — plain inputs for the fields the visitor placed.
//
// WHY NOT `App_DocumentFiller` HERE. The filler is reused verbatim on step 3 and
// it is the right component for that, but it mounts its OWN `App_PdfDocument`.
// Using it for filling would put placing and filling in two different scroll
// containers with two independent zoom states — the visitor would place a field
// at one zoom and then hunt for it at another. This rail types into the same
// document they are already looking at.
//
// Signature fields are absent by construction (`utils_Trial_FillableFields`),
// because a signature is captured on the sign step. A row of text inputs
// including one labelled "Signature" is exactly the confusion the real product
// avoids by splitting those steps.

import { DatePicker, Empty, Input, Typography, theme } from "antd";
import dayjs from "dayjs";
import type { TemplateLayout } from "@/types/template.types";
import { utils_Trial_FillableFields } from "./utils_Trial_Steps";

type Props = {
    layout: TemplateLayout;
    values: Record<string, unknown>;
    onChange: (fieldId: string, value: unknown) => void;
};

export const PageTrial_FieldValues = ({ layout, values, onChange }: Props) => {
    const { token } = theme.useToken();
    const fields = utils_Trial_FillableFields(layout);
    const signatureCount = layout.length - fields.length;

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: token.marginXS,
                height: "100%",
            }}
        >
            <div>
                <Typography.Text strong style={{ fontSize: token.fontSizeSM }}>
                    Fill your fields
                </Typography.Text>
                <Typography.Paragraph
                    type="secondary"
                    style={{ fontSize: token.fontSizeSM, marginBottom: 0 }}
                >
                    {signatureCount > 0
                        ? "Signatures are captured on the next step."
                        : "Type the values that should appear on the document."}
                </Typography.Paragraph>
            </div>

            {fields.length === 0 ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No fields to fill yet"
                    style={{ marginTop: token.marginMD }}
                />
            ) : (
                <div style={{ overflowY: "auto", display: "grid", gap: token.marginSM }}>
                    {fields.map((field) => (
                        <div key={field.id}>
                            <Typography.Text
                                style={{
                                    display: "block",
                                    fontSize: token.fontSizeSM,
                                    marginBottom: 2,
                                }}
                            >
                                {field.label}{" "}
                                <Typography.Text type="secondary">p{field.page}</Typography.Text>
                            </Typography.Text>

                            {field.type === "date" ? (
                                <DatePicker
                                    style={{ width: "100%" }}
                                    // Stored as a plain ISO date string, which is
                                    // what burns onto the page — a dayjs object in
                                    // state would have to be formatted at the burn
                                    // and that is the wrong place to decide format.
                                    value={
                                        values[field.id]
                                            ? dayjs(String(values[field.id]))
                                            : undefined
                                    }
                                    onChange={(date) =>
                                        onChange(field.id, date ? date.format("YYYY-MM-DD") : "")
                                    }
                                />
                            ) : (
                                <Input
                                    value={
                                        values[field.id] === undefined
                                            ? ""
                                            : String(values[field.id])
                                    }
                                    onChange={(e) => onChange(field.id, e.target.value)}
                                    placeholder={field.label}
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
