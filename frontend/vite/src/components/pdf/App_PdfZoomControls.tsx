import { Button, Tooltip, Typography, theme } from "antd";
import { ZoomInOutlined, ZoomOutOutlined, FullscreenExitOutlined } from "@ant-design/icons";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

type Props = {
    scale: number;
    onScaleChange: (scale: number) => void;
    min?: number;
    max?: number;
    step?: number;
};

/** Exported so `App_PdfDocument`'s pinch gesture clamps to the same range these
 *  buttons do — two zoom affordances on one pane must not disagree about the
 *  limits, or a pinch can leave the buttons stuck. */
export const const_PdfZoom_Min = 0.5;
export const const_PdfZoom_Max = 3.0;
const DEFAULT_STEP = 0.25;

export const App_PdfZoomControls = ({
    scale,
    onScaleChange,
    min = const_PdfZoom_Min,
    max = const_PdfZoom_Max,
    step = DEFAULT_STEP,
}: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const canZoomOut = scale > min + 0.001;
    const canZoomIn = scale < max - 0.001;

    // `small` is a ~24px target — below the ~44px a fingertip needs. Tooltips also
    // go, since on touch they open on tap and then sit over the thing just tapped.
    const size = isMobile ? "middle" : "small";
    const wrap = (title: string, node: React.ReactNode) =>
        isMobile ? node : <Tooltip title={title}>{node}</Tooltip>;

    return (
        <div style={{ display: "inline-flex", alignItems: "center", gap: token.marginXXS }}>
            {wrap(
                "Zoom out",
                <Button
                    type="text"
                    size={size}
                    aria-label="Zoom out"
                    icon={<ZoomOutOutlined />}
                    disabled={!canZoomOut}
                    onClick={() => onScaleChange(Math.max(min, scale - step))}
                />
            )}
            {wrap(
                "Reset to fit width",
                <Button
                    type="text"
                    size={size}
                    aria-label="Reset to fit width"
                    icon={<FullscreenExitOutlined />}
                    onClick={() => onScaleChange(1.0)}
                />
            )}
            {wrap(
                "Zoom in",
                <Button
                    type="text"
                    size={size}
                    aria-label="Zoom in"
                    icon={<ZoomInOutlined />}
                    disabled={!canZoomIn}
                    onClick={() => onScaleChange(Math.min(max, scale + step))}
                />
            )}
            <Typography.Text
                type="secondary"
                style={{ fontSize: token.fontSizeSM, minWidth: 36, textAlign: "right" }}
            >
                {Math.round(scale * 100)}%
            </Typography.Text>
        </div>
    );
};
