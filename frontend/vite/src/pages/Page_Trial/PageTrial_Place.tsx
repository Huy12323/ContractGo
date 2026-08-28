// Step 2 — place fields on the document, and fill them.
//
// The canvas is `App_TemplateFieldWorkspace`, the product's real placement
// surface, driven entirely by props with no network of its own. Three optional
// props adapt it here, and every one of them defaults to today's behaviour so
// the two template-authoring hosts are unchanged: `showRoleManager={false}` (one
// party, so there is no role question to ask), `allowedTypes` (signature, text
// and date only), and `onNumPagesChange` (the page count, which is not knowable
// until the PDF has parsed).
//
// Every field is forced onto the single trial role as it is created. The
// workspace assigns `role_id` from the roles it is given, and it is given
// exactly one — but normalising here means a layout can never carry a role id
// that nothing in the trial knows about, whatever the workspace does later.

import { theme } from "antd";
import { App_TemplateFieldWorkspace } from "@/components/templates/App_TemplateFieldWorkspace";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import type { TemplateLayout } from "@/types/template.types";
import { PageTrial_FieldValues } from "./PageTrial_FieldValues";
import { const_Trial_FieldTypes } from "./utils_Trial_Steps";
import { const_Trial_SignerRole, utils_Trial_NormalizeField } from "./utils_Trial_Layout";

type Props = {
    pdfUrl: string;
    layout: TemplateLayout;
    onLayoutChange: (next: TemplateLayout) => void;
    values: Record<string, unknown>;
    onValueChange: (fieldId: string, value: unknown) => void;
    /** Reported once the PDF parses; the page limit is checked against it. */
    onNumPagesChange: (numPages: number) => void;
};

export const PageTrial_Place = ({
    pdfUrl,
    layout,
    onLayoutChange,
    values,
    onValueChange,
    onNumPagesChange,
}: Props) => {
    const { token } = theme.useToken();
    const { isDesktop } = useApp_Breakpoint();

    return (
        <div style={{ flex: 1, minHeight: 0, display: "flex", minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
                <App_TemplateFieldWorkspace
                    pdfFileUrl={pdfUrl}
                    hasPdf
                    layout={layout}
                    onLayoutChange={(next) => onLayoutChange(next.map(utils_Trial_NormalizeField))}
                    signerRoles={[const_Trial_SignerRole]}
                    // The role list is fixed and the editor is hidden, so nothing
                    // can call this. Kept as a no-op rather than a throw: a
                    // crash-on-impossible is a worse outcome than a no-op if some
                    // future workspace path does call it.
                    onSignerRolesChange={() => {}}
                    onPendingPdfFileChange={() => {}}
                    showRoleManager={false}
                    allowedTypes={[...const_Trial_FieldTypes]}
                    onNumPagesChange={onNumPagesChange}
                />
            </div>

            {/* Desktop only. On a narrower screen the workspace already owns every
                pixel it has, and a third rail beside it would leave the document
                unreadable — the same reasoning `useApp_Breakpoint` records for
                `isWide` on the signing assistant. The values are filled on the
                sign step instead, where the filler renders them inline. */}
            {isDesktop && (
                <div
                    style={{
                        width: 280,
                        minWidth: 280,
                        boxSizing: "border-box",
                        borderLeft: `1px solid ${token.colorBorderSecondary}`,
                        background: token.colorBgContainer,
                        padding: token.paddingSM,
                        overflow: "hidden",
                    }}
                >
                    <PageTrial_FieldValues
                        layout={layout}
                        values={values}
                        onChange={onValueChange}
                    />
                </div>
            )}
        </div>
    );
};
