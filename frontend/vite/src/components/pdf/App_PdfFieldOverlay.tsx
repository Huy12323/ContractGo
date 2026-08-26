// The page overlay that positioned fields live in — extracted from the copy that
// `App_PdfFieldEditor` (builder) and `App_ContractFiller` (filler) each carried.
//
// Everything here is PURE GEOMETRY: percent-of-page boxes, the absolute overlay
// that matches the rendered page bounds, drag-to-move, 8-direction resize, and
// click-to-place. Nothing in this file knows what a signer role, a field type or
// a required flag is — that is exactly why the builder's interaction code
// survived the CG-001 re-key untouched, and keeping the split explicit here is
// what stops it being re-coupled.
//
// Coordinates are 0–1 floats relative to the page box, so zoom never affects
// placement and the builder, filler and server-side burn all agree.

import { useCallback, useRef } from "react";
import { theme } from "antd";

/** The minimum shape this module positions. Any field type structurally fits. */
export type PdfOverlay_Box = {
    page: number;
    x_pct: number;
    y_pct: number;
    w_pct: number;
    h_pct: number;
};

/** 8-direction resize handle identifiers — n/s/e/w edges + 4 corners. */
export type PdfOverlay_ResizeCorner = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Smallest box a field can be resized to, as a fraction of the page. */
export const const_PdfOverlay_MinPct = 0.02;

/** Marks the overlay div. Click-outside handlers use this to keep selection. */
export const const_PdfOverlay_BoxAttr = "data-pdf-field-box";

/**
 * Marks editing chrome that must NOT count as a click outside — the properties
 * panel, the palette rail, anything whose whole job is to act on the current
 * selection. Without it a click-outside handler treats "click the Label input"
 * as "click away", clears the selection and unmounts the panel being typed into.
 */
export const const_PdfOverlay_KeepSelectionAttr = "data-pdf-keep-selection";

// ============================================================
// Overlay container
// ============================================================

type OverlayProps = {
    pageNumber: number;
    /** When set, the overlay captures pointer events and a click places a field. */
    isArmed: boolean;
    /** Fired on pointer-down while armed, with the click position in page percent. */
    onPlace?: (pageNumber: number, xPct: number, yPct: number) => void;
    children: React.ReactNode;
};

/**
 * Absolute overlay matching one rendered PDF page, rendered through
 * `App_PdfDocument`'s `overlayRenderer` slot.
 */
export const App_PdfFieldOverlay = ({ pageNumber, isArmed, onPlace, children }: OverlayProps) => (
    <div
        data-pdf-page-overlay
        onPointerDown={(e) => {
            // pointerdown, not click: preventDefault suppresses the synthetic click
            // in some browsers, which made an onClick-based drop unreliable. There is
            // no drag intent for placement anyway, so first contact is the right moment.
            if (!isArmed || !onPlace) return;
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            onPlace(
                pageNumber,
                (e.clientX - rect.left) / rect.width,
                (e.clientY - rect.top) / rect.height
            );
        }}
        style={{
            position: "absolute",
            inset: 0,
            // react-pdf's text layer carries `z-index: 2` in its own stylesheet; without
            // an explicit z-index the textLayer's spans intercept clicks over the page.
            zIndex: 3,
            pointerEvents: isArmed ? "auto" : "none",
            cursor: isArmed ? "crosshair" : "default",
        }}
    >
        {children}
    </div>
);

// ============================================================
// Positioned box
// ============================================================

type BoxProps = {
    box: PdfOverlay_Box;
    /** Border colour — the consumer's semantic layer (role colour, field state…). */
    borderColor: string;
    isSelected: boolean;
    onPointerDownCapture?: (e: React.PointerEvent) => void;
    style?: React.CSSProperties;
    children?: React.ReactNode;
};

/**
 * One absolutely-positioned box on the overlay. Percent units track the page at
 * any zoom level because the page wrapper is `width: fit-content`.
 *
 * `boxSizing: 'border-box'` is LOAD-BEARING, not housekeeping. There is no global
 * box-sizing reset in this app — antd v6 scopes its own to `.ant-*` selectors and
 * no reset stylesheet is imported — so the browser default is `content-box`. With
 * a border and horizontal padding, a content-box interpretation paints this
 * box ~12px wider and ~4px taller than `w_pct`/`h_pct` actually describe.
 *
 * That is not merely cosmetic: `App_DocumentFiller` sets `border-box` on the
 * signer's equivalent box, and the server-side burn works from the percentages
 * directly. Without this line the builder is the ONLY one of the three surfaces
 * that disagrees, so a field looks right while authoring and lands short when
 * signed. The percentages are the contract; every surface must render them the
 * same way.
 */
export const App_PdfFieldBox = ({
    box,
    borderColor,
    isSelected,
    onPointerDownCapture,
    style,
    children,
}: BoxProps) => {
    const { token } = theme.useToken();

    // OPAQUE, deliberately. These boxes used to be 80% white, which let the PDF's
    // own paragraph text run straight through the label — on a text-dense page the
    // canvas read as two documents printed on top of each other. A flat role tint
    // over an opaque base keeps the box legible AND still says whose it is.
    //
    // Two layers rather than one blended hex because the tint has to sit on an
    // opaque base to stay opaque; `linear-gradient(c, c)` is the standard way to
    // express a solid layer in the `background` shorthand.
    //
    // The regex guard is not paranoia: `borderColor` is a caller-supplied colour
    // and only the persisted `SignerRole.color` values are guaranteed 6-digit hex.
    // Anything else (a named colour, an `rgb()`) would silently produce an invalid
    // `background` and paint nothing at all — so it falls back to the plain base.
    const tint = /^#[0-9a-f]{6}$/i.test(borderColor) ? `${borderColor}1F` : null;
    const background = isSelected
        ? `linear-gradient(${token.colorPrimary}2E, ${token.colorPrimary}2E), ${token.colorBgContainer}`
        : tint
          ? `linear-gradient(${tint}, ${tint}), ${token.colorBgContainer}`
          : token.colorBgContainer;

    return (
        <div
            {...{ [const_PdfOverlay_BoxAttr]: true }}
            onPointerDown={onPointerDownCapture}
            style={{
                position: "absolute",
                boxSizing: "border-box",
                left: `${box.x_pct * 100}%`,
                top: `${box.y_pct * 100}%`,
                width: `${box.w_pct * 100}%`,
                height: `${box.h_pct * 100}%`,
                border: `${isSelected ? 2 : 1}px solid ${borderColor}`,
                background,
                borderRadius: token.borderRadiusSM,
                pointerEvents: "auto",
                userSelect: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: `0 ${token.paddingXXS}px`,
                fontSize: token.fontSizeSM,
                overflow: "hidden",
                boxShadow: isSelected ? token.boxShadow : undefined,
                ...style,
            }}
        >
            {children}
        </div>
    );
};

// ============================================================
// Resize handles
// ============================================================

type HandlesProps = {
    /** Single-line boxes resize on the horizontal axis only — their visual height is
     *  one line of text, so a vertical handle would let the box lie about itself. */
    horizontalOnly: boolean;
    onStartResize: (e: React.PointerEvent, corner: PdfOverlay_ResizeCorner) => void;
};

export const App_PdfFieldResizeHandles = ({ horizontalOnly, onStartResize }: HandlesProps) => {
    const { token } = theme.useToken();

    const handleStyle: React.CSSProperties = {
        position: "absolute",
        boxSizing: "border-box",
        width: 10,
        height: 10,
        background: token.colorPrimary,
        border: `1px solid ${token.colorBgContainer}`,
        borderRadius: 2,
        pointerEvents: "auto",
    };

    if (horizontalOnly) {
        return (
            <>
                <div
                    onPointerDown={(e) => onStartResize(e, "w")}
                    style={{
                        ...handleStyle,
                        top: "50%",
                        left: -5,
                        transform: "translateY(-50%)",
                        cursor: "ew-resize",
                    }}
                />
                <div
                    onPointerDown={(e) => onStartResize(e, "e")}
                    style={{
                        ...handleStyle,
                        top: "50%",
                        right: -5,
                        transform: "translateY(-50%)",
                        cursor: "ew-resize",
                    }}
                />
            </>
        );
    }

    return (
        <>
            <div
                onPointerDown={(e) => onStartResize(e, "nw")}
                style={{ ...handleStyle, top: -5, left: -5, cursor: "nwse-resize" }}
            />
            <div
                onPointerDown={(e) => onStartResize(e, "ne")}
                style={{ ...handleStyle, top: -5, right: -5, cursor: "nesw-resize" }}
            />
            <div
                onPointerDown={(e) => onStartResize(e, "sw")}
                style={{ ...handleStyle, bottom: -5, left: -5, cursor: "nesw-resize" }}
            />
            <div
                onPointerDown={(e) => onStartResize(e, "se")}
                style={{ ...handleStyle, bottom: -5, right: -5, cursor: "nwse-resize" }}
            />
        </>
    );
};

// ============================================================
// Drag / resize
// ============================================================

/**
 * Pointer-driven move and resize for percent-positioned boxes.
 *
 * The active gesture lives in a ref, not state, so a move event costs one
 * geometry patch instead of a render of the whole overlay.
 *
 * `onGeometryChange` receives the box identity the caller passed to `startDrag`,
 * so this hook never learns whether fields are keyed by `id` or by `key` — the
 * distinction that changed in CG-001.
 */
export const usePdfFieldDrag = <TId,>(
    onGeometryChange: (id: TId, patch: Partial<PdfOverlay_Box>) => void
) => {
    const dragRef = useRef<null | {
        id: TId;
        mode: "move" | "resize";
        corner?: PdfOverlay_ResizeCorner;
        startClientX: number;
        startClientY: number;
        startBox: PdfOverlay_Box;
        pageRect: DOMRect;
    }>(null);

    const handlePointerMove = useCallback(
        (e: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            const dxPct = (e.clientX - drag.startClientX) / drag.pageRect.width;
            const dyPct = (e.clientY - drag.startClientY) / drag.pageRect.height;

            if (drag.mode === "move") {
                const nextX = clamp01(drag.startBox.x_pct + dxPct);
                const nextY = clamp01(drag.startBox.y_pct + dyPct);
                // Re-clamp against width/height so the box can't leave the right/bottom edge.
                onGeometryChange(drag.id, {
                    x_pct: Math.min(nextX, 1 - drag.startBox.w_pct),
                    y_pct: Math.min(nextY, 1 - drag.startBox.h_pct),
                });
                return;
            }

            // Each axis moves independently based on which edges the corner names.
            const corner = drag.corner ?? "se";
            let { x_pct, y_pct, w_pct, h_pct } = drag.startBox;

            if (corner.includes("e")) {
                w_pct = Math.max(const_PdfOverlay_MinPct, drag.startBox.w_pct + dxPct);
            } else if (corner.includes("w")) {
                const nextW = Math.max(const_PdfOverlay_MinPct, drag.startBox.w_pct - dxPct);
                x_pct = drag.startBox.x_pct + (drag.startBox.w_pct - nextW);
                w_pct = nextW;
            }

            if (corner.includes("s")) {
                h_pct = Math.max(const_PdfOverlay_MinPct, drag.startBox.h_pct + dyPct);
            } else if (corner.includes("n")) {
                const nextH = Math.max(const_PdfOverlay_MinPct, drag.startBox.h_pct - dyPct);
                y_pct = drag.startBox.y_pct + (drag.startBox.h_pct - nextH);
                h_pct = nextH;
            }

            onGeometryChange(drag.id, {
                x_pct: clamp01(x_pct),
                y_pct: clamp01(y_pct),
                w_pct: Math.min(w_pct, 1 - clamp01(x_pct)),
                h_pct: Math.min(h_pct, 1 - clamp01(y_pct)),
            });
        },
        [onGeometryChange]
    );

    const handlePointerUp = useCallback(() => {
        dragRef.current = null;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
    }, [handlePointerMove]);

    const startDrag = useCallback(
        (
            e: React.PointerEvent,
            id: TId,
            box: PdfOverlay_Box,
            mode: "move" | "resize",
            corner?: PdfOverlay_ResizeCorner
        ) => {
            e.stopPropagation();
            e.preventDefault();
            const pageDiv = (e.currentTarget as HTMLElement).closest("[data-pdf-page-overlay]");
            if (!pageDiv) return;
            dragRef.current = {
                id,
                mode,
                corner,
                startClientX: e.clientX,
                startClientY: e.clientY,
                startBox: { ...box },
                // Cached once at pointer-down, deliberately. Only `.width` and
                // `.height` are ever read from it, and neither changes while the
                // container scrolls — so a mid-drag scroll does NOT drift the box.
                // Do not "fix" this into a per-move getBoundingClientRect(): that
                // would cost a layout read on every pointermove to obtain values
                // that cannot have changed. (It would only go stale if `pdfScale`
                // changed mid-gesture, which no UI path allows.)
                pageRect: pageDiv.getBoundingClientRect(),
            };
            window.addEventListener("pointermove", handlePointerMove);
            window.addEventListener("pointerup", handlePointerUp);
        },
        [handlePointerMove, handlePointerUp]
    );

    return { startDrag };
};

/** Placement position for a newly-dropped box, centred on the click and clamped inside the page. */
export const utils_PdfOverlay_PlaceBox = (
    xPct: number,
    yPct: number,
    size: { w_pct: number; h_pct: number }
): Omit<PdfOverlay_Box, "page"> => {
    const x = Math.min(clamp01(xPct - size.w_pct / 2), 1 - size.w_pct);
    const y = Math.min(clamp01(yPct - size.h_pct / 2), 1 - size.h_pct);
    return { x_pct: x, y_pct: y, w_pct: size.w_pct, h_pct: size.h_pct };
};
