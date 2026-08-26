import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Grid, Tooltip, theme } from "antd";
import { PicRightOutlined } from "@ant-design/icons";
import { App_TemplateBuilder } from "@/components/templates/App_TemplateBuilder";
import { App_TemplateFieldPalette } from "@/components/templates/App_TemplateFieldPalette";
import { App_TemplateFieldPropertiesPanel } from "@/components/templates/App_TemplateFieldPropertiesPanel";
import { App_TemplateRoleManager } from "@/components/templates/App_TemplateRoleManager";
import { App_PdfThumbnailList } from "@/components/pdf/App_PdfThumbnailList";
import { App_PdfZoomControls } from "@/components/pdf/App_PdfZoomControls";
import { const_PdfOverlay_KeepSelectionAttr } from "@/components/pdf/App_PdfFieldOverlay";
import { App_SmallScreenNotice } from "@/components/app-shell/App_SmallScreenNotice";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import type {
    SignerRole,
    TemplateField,
    TemplateField_Type,
    TemplateLayout,
} from "@/types/template.types";

type Props = {
    /** Signed URL, or an object URL for a PDF picked but not yet uploaded. */
    pdfFileUrl: string | null;
    hasPdf: boolean;
    layout: TemplateLayout;
    onLayoutChange: (next: TemplateLayout) => void;
    signerRoles: SignerRole[];
    onSignerRolesChange: (next: SignerRole[]) => void;
    /** Fired when a PDF is picked in the empty-state dropzone. */
    onPendingPdfFileChange: (file: File | null) => void;
    /** Rendered at the right of this component's own strip — Save, History, … */
    toolbarExtra?: React.ReactNode;
};

/**
 * The field-placement workspace: thumbnail rail · roles + palette · canvas ·
 * properties panel.
 *
 * EXTRACTED FROM `Page_TemplateBuilder` so the envelope composer can offer the
 * same editor for a document uploaded during composition (CG-017) without a
 * second copy of it. That mattered more than the line count: the placement
 * geometry has exactly one subtle failure mode per surface that renders it (see
 * the box-sizing note in `App_PdfFieldOverlay`), and a second copy is a second
 * place for those to drift apart from the signer's view and the server's burn.
 *
 * WHAT IT OWNS vs WHAT THE PARENT OWNS. Everything here is workspace-local
 * interaction state — selection, which role is highlighted, the armed field drop,
 * page count, zoom, rail visibility. The DOCUMENT — layout, roles, the pending
 * PDF — is controlled by the parent, because the parent is what knows whether
 * saving means "write a template version" (the builder) or "persist an ad-hoc
 * template mid-compose" (the composer). This component never persists anything.
 */
export const App_TemplateFieldWorkspace = ({
    pdfFileUrl,
    hasPdf,
    layout,
    onLayoutChange,
    signerRoles,
    onSignerRolesChange,
    onPendingPdfFileChange,
    toolbarExtra,
}: Props) => {
    const { token } = theme.useToken();
    const canvasRef = useRef<HTMLDivElement>(null);

    const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
    const [highlightedRoleId, setHighlightedRoleId] = useState<string | null>(null);
    const [pendingFieldDrop, setPendingFieldDrop] = useState<{
        key: string;
        label: string;
        type: TemplateField_Type;
    } | null>(null);
    const [pdfNumPages, setPdfNumPages] = useState(0);
    const [pdfScale, setPdfScale] = useState(1.0);

    // Rail visibility. The rails cost ~785px of chrome before the canvas gets a
    // pixel, so on a 1280px viewport the PDF was down to a couple of hundred.
    // Percent coordinates are width-independent by construction, so nothing moves
    // when the canvas re-widths — which is what makes hiding rails safe at all.
    const screens = Grid.useBreakpoint();
    const isXl = !!screens.xl;
    const { isMobile } = useApp_Breakpoint();
    const [thumbnailsOpen, setThumbnailsOpen] = useState(true);
    // A breakpoint-driven DEFAULT, never a lock: it runs on the breakpoint EDGE so
    // it cannot slam shut a rail the user deliberately opened.
    useEffect(() => setThumbnailsOpen(isXl), [isXl]);

    // Below `md` the rails alone are wider than the screen, so placement becomes
    // guesswork on a surface where a few percent of error is a wrong document.
    // See `App_SmallScreenNotice` — the notice is skippable, not a wall.
    const [smallScreenOverride, setSmallScreenOverride] = useState(false);

    const selectedField = useMemo(
        () => layout.find((f) => f.id === selectedFieldId) ?? null,
        [layout, selectedFieldId]
    );

    const activeRoleId = useMemo(
        () =>
            highlightedRoleId ?? signerRoles.slice().sort((a, b) => a.order - b.order)[0]?.id ?? "",
        [highlightedRoleId, signerRoles]
    );

    const patchField = useCallback(
        (fieldId: string, patch: Partial<TemplateField>) =>
            onLayoutChange(layout.map((f) => (f.id === fieldId ? { ...f, ...patch } : f))),
        [layout, onLayoutChange]
    );

    const deleteField = useCallback(
        (fieldId: string) => {
            onLayoutChange(layout.filter((f) => f.id !== fieldId));
            setSelectedFieldId((id) => (id === fieldId ? null : id));
        },
        [layout, onLayoutChange]
    );

    // Scoped to THIS workspace's canvas rather than a document-wide query: the
    // version history modal mounts a second PDF scroll container, and a global
    // lookup would scroll whichever one the DOM happened to return first.
    const scrollPageIntoView = useCallback((pageNumber: number, yOffsetPct?: number) => {
        const container = canvasRef.current?.querySelector(
            ".pdf-scroll-container"
        ) as HTMLElement | null;
        const pageEl = canvasRef.current?.querySelector(
            `[data-pdf-page="${pageNumber}"]`
        ) as HTMLElement | null;
        if (!container || !pageEl) return;
        const pageTop = pageEl.offsetTop - container.offsetTop;
        const fieldOffset = yOffsetPct !== undefined ? yOffsetPct * pageEl.offsetHeight : 0;
        container.scrollTo({ top: Math.max(0, pageTop + fieldOffset - 8), behavior: "smooth" });
    }, []);

    const selectFieldFromPalette = useCallback(
        (fieldId: string) => {
            setSelectedFieldId(fieldId);
            const field = layout.find((f) => f.id === fieldId);
            if (field) scrollPageIntoView(field.page, field.y_pct);
        },
        [layout, scrollPageIntoView]
    );

    if (isMobile && !smallScreenOverride) {
        return (
            <App_SmallScreenNotice
                title="Field placement needs a wider screen"
                description="Fields are positioned by dragging them onto the page, and this editor puts four panels either side of it. Open this template on a tablet or a computer to place fields. Sending and signing work fine on a phone."
                onViewAnyway={() => setSmallScreenOverride(true)}
            />
        );
    }

    return (
        // `flex: 1` + `minWidth: 0` because BOTH hosts mount this inside a flex
        // container. The builder's is a ROW, where a flex item's default
        // `flex: 0 1 auto` sizes it shrink-to-fit — so without this the workspace is
        // only as wide as its own max-content and the canvas never claims the free
        // space to its right. (It looked right before only because the PDF's
        // runaway min-content width was inflating that max-content measurement.)
        // The composer's is a COLUMN, where the same declaration fills the height and
        // stretch already handles the width.
        <div
            style={{
                height: "100%",
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginXS,
                    padding: `0 0 ${token.paddingXS}px`,
                }}
            >
                {/* Arming a field lives in THIS component's state, not the
                    palette's, so collapsing a rail never disarms a pending drop —
                    and the canvas keeps showing `Click a page to place "..."`
                    regardless of which rails are open. */}
                {hasPdf && pdfFileUrl && (
                    <Tooltip
                        title={thumbnailsOpen ? "Hide page thumbnails" : "Show page thumbnails"}
                    >
                        <Button
                            icon={<PicRightOutlined />}
                            type={thumbnailsOpen ? "default" : "text"}
                            onClick={() => setThumbnailsOpen((open) => !open)}
                        />
                    </Tooltip>
                )}
                {hasPdf && <App_PdfZoomControls scale={pdfScale} onScaleChange={setPdfScale} />}
                {toolbarExtra && (
                    <div style={{ marginLeft: "auto", display: "flex", gap: token.marginXS }}>
                        {toolbarExtra}
                    </div>
                )}
            </div>

            {/* Every rail is `boxSizing: 'border-box'` so its declared width is its
                TRUE outer width — without it the 1px borders and padding stacked on
                top and the arithmetic behind any breakpoint was a lie. */}
            {/* The "view anyway" path from `App_SmallScreenNotice`. The rails have
                real minimum widths, so on a phone the row cannot fit — it gets a
                floor and its own horizontal scroll rather than compressing the
                canvas to nothing. Untouched above `md`. */}
            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    position: "relative",
                    overflowX: isMobile ? "auto" : undefined,
                }}
            >
                {hasPdf && pdfFileUrl && thumbnailsOpen && (
                    <div
                        style={{
                            width: 170,
                            minWidth: 170,
                            boxSizing: "border-box",
                            borderRight: `1px solid ${token.colorBorderSecondary}`,
                            overflow: "auto",
                            padding: token.paddingXS,
                        }}
                    >
                        <App_PdfThumbnailList
                            fileUrl={pdfFileUrl}
                            numPages={pdfNumPages}
                            fields={layout}
                            onPageClick={scrollPageIntoView}
                        />
                    </div>
                )}

                <div
                    {...{ [const_PdfOverlay_KeepSelectionAttr]: true }}
                    style={{
                        width: 280,
                        minWidth: 280,
                        boxSizing: "border-box",
                        borderRight: `1px solid ${token.colorBorderSecondary}`,
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
                    }}
                >
                    <div
                        style={{
                            borderBottom: `1px solid ${token.colorBorderSecondary}`,
                            padding: token.paddingSM,
                            maxHeight: "45%",
                            overflow: "auto",
                        }}
                    >
                        <App_TemplateRoleManager
                            signerRoles={signerRoles}
                            onChange={onSignerRolesChange}
                            layout={layout}
                            highlightedRoleId={highlightedRoleId}
                            onHighlightRole={setHighlightedRoleId}
                        />
                    </div>
                    <div
                        style={{
                            flex: 1,
                            minHeight: 0,
                            padding: token.paddingSM,
                            overflow: "hidden",
                        }}
                    >
                        <App_TemplateFieldPalette
                            placedFields={layout}
                            signerRoles={signerRoles}
                            onArmField={setPendingFieldDrop}
                            selectedFieldId={selectedFieldId}
                            onSelectField={selectFieldFromPalette}
                        />
                    </div>
                </div>

                {/* `overflow: 'hidden'` is the real guarantee that no descendant can
                    push this row taller than its shell; `minHeight: 0` is the flex
                    escape hatch that lets it shrink below its content. */}
                <div
                    ref={canvasRef}
                    style={{
                        flex: 1,
                        // `minWidth: 0` is the flex escape hatch that stops the PDF's
                        // min-content width driving this column (see the note at the
                        // top of the component). On the "view anyway" mobile path it
                        // would drive the canvas to nothing instead, since the rails
                        // beside it will not shrink — so there it gets a floor and
                        // the row above scrolls horizontally to reach it.
                        minWidth: isMobile ? 520 : 0,
                        minHeight: 0,
                        overflow: "hidden",
                        boxSizing: "border-box",
                        display: "flex",
                        padding: token.paddingSM,
                    }}
                >
                    <App_TemplateBuilder
                        pdfFileUrl={pdfFileUrl}
                        hasPdf={hasPdf}
                        layout={layout}
                        onLayoutChange={onLayoutChange}
                        onFieldPatch={patchField}
                        signerRoles={signerRoles}
                        pdfScale={pdfScale}
                        pendingFieldDrop={pendingFieldDrop}
                        onPendingFieldDropConsumed={() => setPendingFieldDrop(null)}
                        activeRoleId={activeRoleId}
                        highlightedRoleId={highlightedRoleId}
                        onPendingPdfFileChange={onPendingPdfFileChange}
                        onNumPagesChange={setPdfNumPages}
                        selectedFieldId={selectedFieldId}
                        onSelectedFieldIdChange={setSelectedFieldId}
                    />
                </div>

                {/* Only while something is selected. This column used to stand open
                    permanently showing "Select a field to edit it" — 317px of canvas
                    spent on a placeholder, which is its state most of the time.
                    Selection happens on pointer-down on a box, so it appears exactly
                    when it is asked for.

                    FLOATING, not in flow, and that is the whole point. In flow it
                    took 300px off the canvas the moment a field was selected — the
                    PDF re-rendered narrower and the page slid out from under the
                    pointer that had just clicked it, every single time. Clicking a
                    field to edit it must not move the field. Out of flow the canvas
                    geometry is identical selected or not, so the document never
                    shifts and the percent-positioned boxes stay exactly where the
                    user aimed. */}
                {selectedField && (
                    <div
                        {...{ [const_PdfOverlay_KeepSelectionAttr]: true }}
                        style={{
                            position: "absolute",
                            top: 0,
                            right: 0,
                            bottom: 0,
                            width: 300,
                            zIndex: 4,
                            boxSizing: "border-box",
                            background: token.colorBgContainer,
                            borderLeft: `1px solid ${token.colorBorderSecondary}`,
                            boxShadow: token.boxShadowSecondary,
                            overflow: "auto",
                            padding: token.paddingSM,
                        }}
                    >
                        <App_TemplateFieldPropertiesPanel
                            field={selectedField}
                            signerRoles={signerRoles}
                            onPatch={patchField}
                            onDelete={deleteField}
                            existingKeys={layout.map((f) => f.key)}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
