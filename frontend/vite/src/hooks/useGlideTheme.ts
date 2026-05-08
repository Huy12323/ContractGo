import { useMemo } from "react";
import { theme } from "antd";
import type { Theme } from "@glideapps/glide-data-grid";

export const GRID_EXPAND_ICON = {
    padding: 34,
    boxSize: 20,
    borderRadius: 3,
    iconScale: 12 / 24,
    svgPath: "M15 3h6v6 M21 3l-7 7 M3 21l7-7 M9 21H3v-6",
} as const;

export function drawExpandIcon(
    ctx: CanvasRenderingContext2D,
    rectX: number,
    rectY: number,
    rectHeight: number,
    colorText: string,
) {
    const { padding, boxSize, borderRadius: br, iconScale: scale, svgPath } = GRID_EXPAND_ICON;
    const cx = rectX + padding / 2;
    const cy = rectY + rectHeight / 2;
    const bh = boxSize / 2;
    const bx = cx - bh;
    const by = cy - bh;

    // Icon
    ctx.save();
    ctx.strokeStyle = colorText;
    ctx.globalAlpha = 0.85;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const iconPath = new Path2D(svgPath);
    const iconOffset = (scale * 24) / 2;
    ctx.translate(cx - iconOffset, cy - iconOffset);
    ctx.scale(scale, scale);
    ctx.lineWidth = 1 / scale;
    ctx.stroke(iconPath);
    ctx.restore();

    // Border
    ctx.save();
    ctx.strokeStyle = colorText;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 0.25;
    ctx.beginPath();
    ctx.moveTo(bx + br, by);
    ctx.lineTo(bx + boxSize - br, by);
    ctx.arcTo(bx + boxSize, by, bx + boxSize, by + br, br);
    ctx.lineTo(bx + boxSize, by + boxSize - br);
    ctx.arcTo(bx + boxSize, by + boxSize, bx + boxSize - br, by + boxSize, br);
    ctx.lineTo(bx + br, by + boxSize);
    ctx.arcTo(bx, by + boxSize, bx, by + boxSize - br, br);
    ctx.lineTo(bx, by + br);
    ctx.arcTo(bx, by, bx + br, by, br);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
}

export const useGlideTheme = (): Partial<Theme> => {
    const { token } = theme.useToken();
    return useMemo(() => ({
        baseFontStyle: `${token.fontSizeSM}px`,
        headerFontStyle: `600 ${token.fontSizeSM}px`,
        fontFamily: token.fontFamily,
        bgHeader: "#FFFFFF",
        bgHeaderHovered: token.colorFillAlter,
        bgHeaderHasFocus: token.colorFillAlter,
        textHeader: token.colorText,
        textDark: token.colorText,
        textMedium: token.colorTextSecondary,
        textLight: token.colorTextTertiary,
        textBubble: token.colorPrimary,
        bgBubble: token.colorPrimaryBg,
        bgBubbleSelected: token.colorPrimaryBgHover,
        borderColor: token.colorBorderSecondary,
        horizontalBorderColor: token.colorBorderSecondary,
        bgCell: token.colorBgContainer,
        bgCellMedium: token.colorFillAlter,
        accentColor: token.colorPrimary,
        accentFg: "#ffffff",
        accentLight: token.colorPrimaryBg,
        cellHorizontalPadding: token.paddingXS,
        cellVerticalPadding: token.paddingXXS,
    }), [token]);
};
