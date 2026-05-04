import { useEffect, useRef, useState, useId } from 'react'
import { Spin, Typography, theme } from 'antd'
import { Document, Page } from 'react-pdf'

type PdfDocument_Page = {
    pageNumber: number
}

type Props = {
    /** Signed R2 URL (or any direct URL) to the source PDF. */
    fileUrl: string
    /** User zoom multiplier on top of fit-to-container-width. 1.0 = fit. */
    scale?: number
    /** Slot rendered inside each page's absolute overlay. Consumers position children
     *  with percent-based `top/left/width/height` — overlay matches the rendered page bounds.
     *  Set `pointer-events: auto` on children that need to receive input;
     *  the overlay itself uses `pointer-events: none` so dragging on empty space falls through to the page. */
    overlayRenderer?: (page: PdfDocument_Page) => React.ReactNode
    /** Called when the document fails to load (e.g. signed URL expired). */
    onLoadError?: (err: Error) => void
    /** Optional callback fired when document metadata loads. */
    onLoadSuccess?: (info: { numPages: number }) => void
}

const PAGE_GAP_MULTIPLIER = 1

export const App_PdfDocument = ({
    fileUrl,
    scale = 1.0,
    overlayRenderer,
    onLoadError,
    onLoadSuccess,
}: Props) => {
    const { token } = theme.useToken()
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)
    const [numPages, setNumPages] = useState(0)

    // Measure container width via ResizeObserver — fit-to-width is the base scale,
    // user `scale` prop multiplies on top.
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width)
            }
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    const renderedWidth = containerWidth > 0 ? containerWidth * scale : 0

    // Inject scrollbar styles into <head> — more reliable than inline <style> in a
    // React fragment, which can fail to apply in portal-rendered modals. Uses a stable
    // id so multiple App_PdfDocument instances share one <style> element.
    const styleId = useId()
    useEffect(() => {
        const id = `pdf-scroll-style-${styleId.replace(/:/g, '')}`
        if (document.getElementById(id)) return
        const style = document.createElement('style')
        style.id = id
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
        `
        document.head.appendChild(style)
        return () => { document.getElementById(id)?.remove() }
    }, [styleId, token.colorTextTertiary, token.colorTextSecondary, token.colorFillTertiary])

    return (
        <div
            ref={containerRef}
            className="pdf-scroll-container"
            style={{
                width: '100%',
                height: '100%',
                overflow: 'scroll',
                boxSizing: 'border-box',
                background: token.colorFillQuaternary,
                padding: token.paddingSM,
            }}
        >
            <Document
                file={fileUrl}
                onLoadSuccess={({ numPages: n }) => {
                    setNumPages(n)
                    onLoadSuccess?.({ numPages: n })
                }}
                onLoadError={(err) => onLoadError?.(err as Error)}
                loading={
                    <div style={{ display: 'flex', justifyContent: 'center', padding: token.paddingXL }}>
                        <Spin />
                    </div>
                }
                error={
                    <div style={{ padding: token.paddingMD, textAlign: 'center' }}>
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
                                width: 'fit-content',
                                margin: `0 auto ${token.marginMD * PAGE_GAP_MULTIPLIER}px`,
                                position: 'relative',
                                boxShadow: token.boxShadowTertiary,
                            }}
                        >
                            <Page pageNumber={pageNum} width={renderedWidth} />
                            {/* Consumer's overlay renders directly here as a sibling of
                                <Page>. It owns its own pointer-events strategy. The parent's
                                `fit-content` width means `inset: 0` matches the page exactly. */}
                            {overlayRenderer && overlayRenderer({ pageNumber: pageNum })}
                        </div>
                    ))}
            </Document>
        </div>
    )
}
