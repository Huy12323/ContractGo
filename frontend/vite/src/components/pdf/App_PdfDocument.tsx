import { useEffect, useRef, useState, useId } from "react";
import { Spin, Typography, theme } from "antd";
import { Document, Page } from "react-pdf";
import { const_PdfZoom_Max, const_PdfZoom_Min } from "@/components/pdf/App_PdfZoomControls";

type PdfDocument_Page = {
    pageNumber: number;
};

type Props = {
    /** Signed R2 URL (or any direct URL) to the source PDF. */
    fileUrl: string;
    /** User zoom multiplier on top of fit-to-container-width. 1.0 = fit. */
    scale?: number;
    /** Slot rendered inside each page's absolute overlay. Consumers position children
     *  with percent-based `top/left/width/height` — overlay matches the rendered page bounds.
     *  Set `pointer-events: auto` on children that need to receive input;
     *  the overlay itself uses `pointer-events: none` so dragging on empty space falls through to the page. */
    overlayRenderer?: (page: PdfDocument_Page) => React.ReactNode;
    /** Called when the document fails to load (e.g. signed URL expired). */
    onLoadError?: (err: Error) => void;
    /** Optional callback fired when document metadata loads. */
    onLoadSuccess?: (info: { numPages: number }) => void;
    /**
     * Two-finger pinch adjusts `scale`. Opt-in, and only the signer surface opts
     * in: the authoring surfaces put a drag-to-place gesture on the same pixels,
     * and a pinch that also moved a field would be a data change disguised as a
     * view change. Requires `onScaleChange` to have any effect — this component
     * does not own `scale`.
     */
    enablePinchZoom?: boolean;
    /** Reports a `scale` the user requested by pinching. */
    onScaleChange?: (scale: number) => void;
};

const PAGE_GAP_MULTIPLIER = 1;

export const App_PdfDocument = ({
    fileUrl,
    scale = 1.0,
    overlayRenderer,
    onLoadError,
    onLoadSuccess,
    enablePinchZoom = false,
    onScaleChange,
}: Props) => {
    const { token } = theme.useToken();
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);
    const [numPages, setNumPages] = useState(0);

    usePdfPinchZoom({
        containerRef,
        enabled: enablePinchZoom && !!onScaleChange,
        scale,
        onScaleChange,
    });

    // Measure container width via ResizeObserver — fit-to-width is the base scale,
    // user `scale` prop multiplies on top.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const renderedWidth = containerWidth > 0 ? containerWidth * scale : 0;

    // Inject scrollbar styles into <head> — more reliable than inline <style> in a
    // React fragment, which can fail to apply in portal-rendered modals. Uses a stable
    // id so multiple App_PdfDocument instances share one <style> element.
    const styleId = useId();
    useEffect(() => {
        const id = `pdf-scroll-style-${styleId.replace(/:/g, "")}`;
        if (document.getElementById(id)) return;
        const style = document.createElement("style");
        style.id = id;
        style.textContent = `
            .pdf-scroll-container {
                scrollbar-width: auto !important;
                scrollbar-color: ${token.colorTextTertiary} ${token.colorFillTertiary} !important;
            }
            .pdf-scroll-container::-webkit-scrollbar { width: 14px; height: 14px; }
            .pdf-scroll-container::-webkit-scrollbar-track {
                background: ${token.colorFillTertiary};
            }
            .pdf-scroll-container::-webkit-scrollbar-thumb {
                background-color: ${token.colorTextTertiary};
                background-clip: padding-box;
                border: 3px solid transparent;
                border-radius: 7px;
            }
            .pdf-scroll-container::-webkit-scrollbar-thumb:hover {
                background-color: ${token.colorTextSecondary};
                background-clip: padding-box;
            }
            .pdf-scroll-container::-webkit-scrollbar-corner {
                background: ${token.colorFillTertiary};
            }
        `;
        document.head.appendChild(style);
        return () => {
            document.getElementById(id)?.remove();
        };
    }, [styleId, token.colorTextTertiary, token.colorTextSecondary, token.colorFillTertiary]);

    return (
        <div
            ref={containerRef}
            className="pdf-scroll-container"
            style={{
                width: "100%",
                height: "100%",
                // `scroll`, NOT `auto`, and deliberately so. With `auto` the vertical
                // scrollbar's appearance changes the container's content width, which
                // feeds `renderedWidth`, which resizes the page, which can remove the
                // scrollbar — a ResizeObserver feedback loop that oscillates. Reserving
                // both gutters unconditionally is what breaks the cycle.
                overflow: "scroll",
                // The SECOND half of the same guarantee, and the one that holds even
                // when a consumer's flex chain is imperfect. A scroll container still
                // reports a CONTENT-BASED min-content size, so the page wrapper's
                // `min-width: fit-content` (page width + padding) propagates back out
                // through any ancestor flex item left at `min-width: auto` — that
                // ancestor then can't shrink below the page, the container widens,
                // `renderedWidth` grows, and the PDF zooms itself larger every frame.
                // `contain: inline-size` sizes this box's inline axis as if it were
                // empty, so content can never feed back into its own width.
                contain: "inline-size",
                minWidth: 0,
                boxSizing: "border-box",
                background: token.colorFillQuaternary,
                // Single-finger panning stays the browser's; the pinch handler
                // claims two-finger gestures. `pinch-zoom` is deliberately NOT in
                // this list when the handler is active — leaving it would let the
                // browser visually zoom the whole pane on top of our re-render,
                // and the two scales would compound.
                touchAction: enablePinchZoom ? "pan-x pan-y" : undefined,
            }}
        >
            {/* Sizing wrapper. `min-width: fit-content` is what makes a zoomed page
                scrollable to its LEFT edge.

                Without it, the page wrapper below (wider than the container once
                `scale > 1`) has `margin: 0 auto`, and auto margins on an
                over-constrained box resolve equal and NEGATIVE — centring the overflow
                on both sides. `scrollLeft` cannot go below 0, so the left half becomes
                permanently unreachable and reads as a clipped page.

                With this wrapper as wide as the widest page, the margins are never
                over-constrained: they resolve to 0 when zoomed (flush left, fully
                scrollable) and still centre a page narrower than the container.

                Do NOT convert this to `display: flex; flex-direction: column` without
                also setting `align-items: center` — the default `stretch` would widen
                each page wrapper past its <Page>, and the overlay's `inset: 0` would
                silently stop matching the page, shifting every field.

                The padding lives here rather than on the scroll container because
                trailing padding on a scroll container is honoured inconsistently across
                engines, and because it would otherwise be subtracted from `contentRect`. */}
            <div style={{ minWidth: "fit-content", padding: token.paddingSM }}>
                <Document
                    file={fileUrl}
                    onLoadSuccess={({ numPages: n }) => {
                        setNumPages(n);
                        onLoadSuccess?.({ numPages: n });
                    }}
                    onLoadError={(err) => onLoadError?.(err as Error)}
                    loading={
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "center",
                                padding: token.paddingXL,
                            }}
                        >
                            <Spin />
                        </div>
                    }
                    error={
                        <div style={{ padding: token.paddingMD, textAlign: "center" }}>
                            <Typography.Text type="danger">Failed to load PDF.</Typography.Text>
                        </div>
                    }
                >
                    {renderedWidth > 0 &&
                        Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
                            <div
                                key={pageNum}
                                data-pdf-page={pageNum}
                                style={{
                                    // `width: fit-content` makes the wrapper hug the actual rendered
                                    // <Page> dimensions instead of stretching to the scroll container's
                                    // width. This is critical for percent-based field overlay sizing —
                                    // overlay's `inset: 0` then matches the page exactly, so x_pct/w_pct
                                    // values track the page at any zoom level.
                                    //
                                    // NEVER add `border` or `padding` here. `inset: 0` on an absolutely
                                    // positioned child resolves against this element's PADDING box, so
                                    // either one would offset the whole overlay by its own width and
                                    // move every field. `boxShadow` is outside layout and is safe.
                                    width: "fit-content",
                                    margin: `0 auto ${token.marginMD * PAGE_GAP_MULTIPLIER}px`,
                                    position: "relative",
                                    boxShadow: token.boxShadowTertiary,
                                }}
                            >
                                {/* Floored to match react-pdf's own `Math.floor(viewport.width)`
                                    on the canvas. A fractional width leaves the wrapper a
                                    sub-pixel wider than the canvas, which shows up as a
                                    permanent 1px horizontal scrollbar at fit-to-width. */}
                                <Page pageNumber={pageNum} width={Math.floor(renderedWidth)} />
                                {/* Consumer's overlay renders directly here as a sibling of
                                    <Page>. It owns its own pointer-events strategy. The parent's
                                    `fit-content` width means `inset: 0` matches the page exactly. */}
                                {overlayRenderer && overlayRenderer({ pageNumber: pageNum })}
                            </div>
                        ))}
                </Document>
            </div>
        </div>
    );
};

// ============================================================
// Pinch to zoom
// ============================================================

/**
 * Two-finger pinch → `scale`.
 *
 * Written against pointer events rather than the `gesturestart`/`gesturechange`
 * pair, which only Safari fires, and rather than `touchmove`, which would need a
 * non-passive listener to be cancelable. Two live pointers are tracked; the ratio
 * of their current separation to the separation at the moment the second one
 * landed is the gesture's scale factor, applied to the scale that was in effect
 * when the gesture began.
 *
 * Deliberately does NOT re-anchor the scroll position on the pinch midpoint. Doing
 * that well means owning the scroll offset through a re-render that changes the
 * rendered page width, and getting it wrong throws the signer to a different part
 * of the document mid-gesture. Zooming about the top-left and letting them pan is
 * the duller behaviour and the one that cannot lose their place.
 */
const usePdfPinchZoom = ({
    containerRef,
    enabled,
    scale,
    onScaleChange,
}: {
    containerRef: React.RefObject<HTMLDivElement | null>;
    enabled: boolean;
    scale: number;
    onScaleChange?: (scale: number) => void;
}) => {
    // Held in refs, not state: these change on every `pointermove` of a gesture
    // and none of them belong in a render.
    const pointersRef = useRef(new Map<number, { x: number; y: number }>());
    const gestureRef = useRef<{ startDistance: number; startScale: number } | null>(null);

    // The live `scale` for the START of the next gesture, without making it a
    // dependency of the effect — re-subscribing the listeners on every zoom step
    // would drop a gesture in progress.
    const scaleRef = useRef(scale);
    useEffect(() => {
        scaleRef.current = scale;
    });

    const onScaleChangeRef = useRef(onScaleChange);
    useEffect(() => {
        onScaleChangeRef.current = onScaleChange;
    });

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !enabled) return;

        const distance = () => {
            const [a, b] = Array.from(pointersRef.current.values());
            if (!a || !b) return 0;
            return Math.hypot(a.x - b.x, a.y - b.y);
        };

        const endGesture = (event: PointerEvent) => {
            pointersRef.current.delete(event.pointerId);
            // Lifting one finger ends the gesture rather than pausing it. Putting
            // it back down starts a fresh one from the current scale, which is
            // what makes repeated pinches accumulate the way people expect.
            if (pointersRef.current.size < 2) gestureRef.current = null;
        };

        const onPointerDown = (event: PointerEvent) => {
            if (event.pointerType !== "touch") return;
            pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointersRef.current.size === 2) {
                gestureRef.current = { startDistance: distance(), startScale: scaleRef.current };
            }
        };

        const onPointerMove = (event: PointerEvent) => {
            if (!pointersRef.current.has(event.pointerId)) return;
            pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            const gesture = gestureRef.current;
            if (!gesture || pointersRef.current.size !== 2) return;

            const current = distance();
            if (gesture.startDistance <= 0 || current <= 0) return;

            const next = clamp(
                gesture.startScale * (current / gesture.startDistance),
                const_PdfZoom_Min,
                const_PdfZoom_Max
            );
            // A pinch re-renders every page at a new width, so quantising to 1%
            // steps is what keeps a slow gesture from queueing a render per frame
            // for a change nobody can see.
            const rounded = Math.round(next * 100) / 100;
            if (rounded !== scaleRef.current) onScaleChangeRef.current?.(rounded);
        };

        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("pointermove", onPointerMove);
        // On `window`, because a finger that leaves the pane mid-pinch still ends
        // the gesture — a `pointerup` the element never sees would strand
        // `pointersRef` at two entries and leave the next tap zooming.
        window.addEventListener("pointerup", endGesture);
        window.addEventListener("pointercancel", endGesture);

        return () => {
            el.removeEventListener("pointerdown", onPointerDown);
            el.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", endGesture);
            window.removeEventListener("pointercancel", endGesture);
            pointersRef.current.clear();
            gestureRef.current = null;
        };
    }, [containerRef, enabled]);
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
