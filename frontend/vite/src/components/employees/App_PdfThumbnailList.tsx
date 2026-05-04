import { useState } from 'react'
import { Document, Page } from 'react-pdf'
import { Spin, Typography, theme } from 'antd'
import type { PdfLayout } from '@/types/contractTemplate.types'

type Props = {
    fileUrl: string
    /** Page count from the main editor's <Document> load callback. We don't trust the
     *  thumbnail's <Document> alone — it's a sibling render and starts unloaded. */
    numPages: number
    pdfLayout: PdfLayout
    onPageClick: (pageNumber: number) => void
}

const THUMB_WIDTH = 150

export const App_PdfThumbnailList = ({ fileUrl, numPages, pdfLayout, onPageClick }: Props) => {
    const { token } = theme.useToken()
    // Local doc-load state — independent from the main editor's load. The main editor
    // already drives `numPages` from its own <Document>; the local one is only here to
    // render thumbnails. We render thumbnails one-by-one as they load via <Page>'s
    // own internal lifecycle.
    const [hoveredPage, setHoveredPage] = useState<number | null>(null)

    return (
        <Document
            file={fileUrl}
            loading={
                <div style={{ display: 'flex', justifyContent: 'center', padding: token.paddingMD }}>
                    <Spin size="small" />
                </div>
            }
            error={
                <Typography.Text type="danger" style={{ fontSize: 12, padding: token.paddingSM }}>
                    Could not render thumbnails.
                </Typography.Text>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
                {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
                    const fieldsOnPage = pdfLayout.filter((f) => f.page === pageNum).length
                    const isHovered = hoveredPage === pageNum
                    return (
                        <div
                            key={pageNum}
                            onClick={() => onPageClick(pageNum)}
                            onMouseEnter={() => setHoveredPage(pageNum)}
                            onMouseLeave={() => setHoveredPage(null)}
                            style={{
                                cursor: 'pointer',
                                borderRadius: token.borderRadiusSM,
                                padding: token.paddingXS,
                                background: isHovered ? token.colorFillQuaternary : 'transparent',
                                border: `1px solid ${isHovered ? token.colorPrimary : token.colorBorderSecondary}`,
                                userSelect: 'none',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: token.marginXXS,
                            }}
                        >
                            <div style={{ boxShadow: token.boxShadowTertiary, lineHeight: 0 }}>
                                <Page
                                    pageNumber={pageNum}
                                    width={THUMB_WIDTH}
                                    renderTextLayer={false}
                                    renderAnnotationLayer={false}
                                    loading={
                                        <div
                                            style={{
                                                width: THUMB_WIDTH,
                                                height: THUMB_WIDTH * 1.4,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                background: token.colorFillTertiary,
                                            }}
                                        >
                                            <Spin size="small" />
                                        </div>
                                    }
                                />
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    width: '100%',
                                    alignItems: 'center',
                                    paddingInline: token.paddingXXS,
                                }}
                            >
                                <Typography.Text style={{ fontSize: 12 }}>
                                    Page {pageNum}
                                </Typography.Text>
                                {fieldsOnPage > 0 && (
                                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                        {fieldsOnPage} field{fieldsOnPage === 1 ? '' : 's'}
                                    </Typography.Text>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </Document>
    )
}
