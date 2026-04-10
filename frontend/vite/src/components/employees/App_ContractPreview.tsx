import { useState, useRef, useCallback, useEffect } from 'react'
import { Button, Tooltip, Typography, theme } from 'antd'
import { ZoomInOutlined, ZoomOutOutlined, ExpandOutlined } from '@ant-design/icons'
import { EditorContent, type Editor } from '@tiptap/react'

type Props = {
    editor: Editor | null
}

const ZOOM_MIN = 0.4
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1
const PAGE_WIDTH = 794

export const App_ContractPreview = ({ editor }: Props) => {
    const { token } = theme.useToken()
    const [zoom, setZoom] = useState(1)
    const scrollRef = useRef<HTMLDivElement>(null)

    const handleFit = useCallback(() => {
        if (!scrollRef.current) return
        const available = scrollRef.current.clientWidth - token.paddingLG * 2
        const fit = available / PAGE_WIDTH
        setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fit)))
    }, [token.paddingLG])

    // Auto-fit on first render
    useEffect(() => {
        const id = window.setTimeout(handleFit, 0)
        return () => window.clearTimeout(id)
    }, [handleFit])

    return (
        <>
            <style>{`
                .tiptap table { width: 100%; border-collapse: collapse; margin: ${token.marginSM}px 0; }
                .tiptap th, .tiptap td { border: 1px solid ${token.colorBorderSecondary}; padding: ${token.paddingXS}px ${token.paddingSM}px; min-width: 80px; vertical-align: top; }
                .tiptap th { background: ${token.colorFillQuaternary}; font-weight: 600; }
                .tiptap th p, .tiptap td p { margin: 0; }
            `}</style>
            <div style={{
                background: token.colorFillQuaternary,
                borderRadius: token.borderRadiusLG,
                overflow: 'hidden',
                height: '100%',
                position: 'relative',
            }}>
                {/* Zoom controls — top right */}
                <div style={{
                    position: 'absolute',
                    top: token.marginSM,
                    right: token.marginSM,
                    zIndex: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: token.colorBgContainer,
                    padding: '4px 8px',
                    borderRadius: token.borderRadiusSM,
                    boxShadow: token.boxShadowTertiary,
                }}>
                    <Tooltip title="Zoom out">
                        <Button
                            size="small"
                            icon={<ZoomOutOutlined />}
                            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
                        />
                    </Tooltip>
                    <Typography.Text style={{ fontSize: 12, minWidth: 40, textAlign: 'center' }}>
                        {Math.round(zoom * 100)}%
                    </Typography.Text>
                    <Tooltip title="Zoom in">
                        <Button
                            size="small"
                            icon={<ZoomInOutlined />}
                            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
                        />
                    </Tooltip>
                    <Tooltip title="Fit to width">
                        <Button size="small" icon={<ExpandOutlined />} onClick={handleFit} />
                    </Tooltip>
                </div>

                <div ref={scrollRef} style={{
                    padding: token.paddingLG,
                    overflow: 'auto',
                    height: '100%',
                    boxSizing: 'border-box',
                }}>
                    <div style={{
                        width: PAGE_WIDTH,
                        minWidth: PAGE_WIDTH,
                        margin: '0 auto',
                        background: token.colorBgContainer,
                        boxShadow: token.boxShadowSecondary,
                        padding: '40px 56px',
                        minHeight: 200,
                        boxSizing: 'border-box',
                        zoom,
                    }}>
                        <EditorContent editor={editor} />
                    </div>
                </div>
            </div>
        </>
    )
}
