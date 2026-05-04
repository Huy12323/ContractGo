import { Button, Tooltip, Typography, theme } from 'antd'
import { ZoomInOutlined, ZoomOutOutlined, FullscreenExitOutlined } from '@ant-design/icons'

type Props = {
    scale: number
    onScaleChange: (scale: number) => void
    min?: number
    max?: number
    step?: number
}

const DEFAULT_MIN = 0.5
const DEFAULT_MAX = 3.0
const DEFAULT_STEP = 0.25

export const App_PdfZoomControls = ({
    scale,
    onScaleChange,
    min = DEFAULT_MIN,
    max = DEFAULT_MAX,
    step = DEFAULT_STEP,
}: Props) => {
    const { token } = theme.useToken()
    const canZoomOut = scale > min + 0.001
    const canZoomIn = scale < max - 0.001

    return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXXS }}>
            <Tooltip title="Zoom out">
                <Button
                    type="text"
                    size="small"
                    icon={<ZoomOutOutlined />}
                    disabled={!canZoomOut}
                    onClick={() => onScaleChange(Math.max(min, scale - step))}
                />
            </Tooltip>
            <Tooltip title="Reset to fit width">
                <Button
                    type="text"
                    size="small"
                    icon={<FullscreenExitOutlined />}
                    onClick={() => onScaleChange(1.0)}
                />
            </Tooltip>
            <Tooltip title="Zoom in">
                <Button
                    type="text"
                    size="small"
                    icon={<ZoomInOutlined />}
                    disabled={!canZoomIn}
                    onClick={() => onScaleChange(Math.min(max, scale + step))}
                />
            </Tooltip>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, minWidth: 36, textAlign: 'right' }}>
                {Math.round(scale * 100)}%
            </Typography.Text>
        </div>
    )
}
