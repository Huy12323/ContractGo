import { useCallback, useMemo, useRef } from "react";
import { DataEditor, GridCellKind } from "@glideapps/glide-data-grid";
import type { GridCell, GridColumn, Item, DrawHeaderCallback, Rectangle, DrawCellCallback, GridMouseEventArgs, DataEditorRef } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { theme } from "antd";
import { useGlideTheme, GRID_EXPAND_ICON, drawExpandIcon } from "@/hooks/useGlideTheme";
import { formatDuration } from "@/utils/timeclock/utils_Timeclock_AggregateEvents";
import { fmtDate } from "@/utils/timeclock/utils_Timeclock_DateRange";
import { TIMECLOCK_COLORS } from "@/utils/timeclock/const_Timeclock_Colors";

const MS_8H = 8 * 60 * 60 * 1000;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type GridEmployee = {
    id: string;
    name: string;
    initials: string;
};

type Props = {
    employees: GridEmployee[];
    days: Date[];
    summaryIndex: Map<string, number>;
    onEmployeeClick?: (employee: GridEmployee) => void;
    onDayCellClick?: (employee: GridEmployee, day: Date) => void;
    onVisibleRegionChanged?: (startRow: number, endRow: number) => void;
};

export const PageTimesheets_Grid = ({ employees, days, summaryIndex, onEmployeeClick, onDayCellClick, onVisibleRegionChanged }: Props) => {
    const { token } = theme.useToken();
    const gridTheme = useGlideTheme();
    const gridRef = useRef<DataEditorRef>(null);
    const hoveredRowRef = useRef<number | undefined>(undefined);

    const COL_W = 68;

    const columns = useMemo((): GridColumn[] => {
        const cols: GridColumn[] = [
            { title: "Employee", width: 210, id: "employee" },
            { title: "Total", width: 80, id: "total" },
        ];
        for (const d of days) {
            const dayName = DAY_NAMES[d.getDay()]!;
            const dateNum = String(d.getDate());
            cols.push({ title: `${dayName}\n${dateNum}`, width: COL_W, id: fmtDate(d) });
        }
        return cols;
    }, [days]);

    const dayDateStrings = useMemo(() => days.map(fmtDate), [days]);

    const getCellContent = useCallback(([col, row]: Item): GridCell => {
        const emp = employees[row]!;

        if (col === 0) {
            return { kind: GridCellKind.Text, data: emp.name, displayData: emp.name, allowOverlay: false, readonly: true,
                cursor: "pointer",
                themeOverride: { baseFontStyle: "500 13px", cellHorizontalPadding: GRID_EXPAND_ICON.padding } };
        }

        if (col === 1) {
            let totalMs = 0;
            for (const ds of dayDateStrings) {
                totalMs += summaryIndex.get(`${emp.id}|${ds}`) ?? 0;
            }
            const display = totalMs > 0 ? formatDuration(totalMs) : "—";
            return { kind: GridCellKind.Text, data: display, displayData: display, allowOverlay: false, readonly: true, contentAlign: "center",
                themeOverride: { baseFontStyle: "700 13px" } };
        }

        const ms = summaryIndex.get(`${emp.id}|${dayDateStrings[col - 2]}`) ?? 0;

        if (ms === 0) {
            return { kind: GridCellKind.Text, data: "—", displayData: "—", allowOverlay: false, readonly: true, contentAlign: "center",
                themeOverride: { textDark: token.colorTextQuaternary } };
        }

        const hours = (ms / 3600000).toFixed(2) + "h";
        return { kind: GridCellKind.Text, data: hours, displayData: hours, allowOverlay: false, readonly: true, contentAlign: "center",
            themeOverride: { baseFontStyle: "600 13px", textDark: ms >= MS_8H ? TIMECLOCK_COLORS.work.dark : TIMECLOCK_COLORS.work.soft } };
    }, [employees, dayDateStrings, summaryIndex, token]);

    const handleItemHovered = useCallback((args: GridMouseEventArgs) => {
        const newRow = args.kind === "cell" ? args.location[1] : undefined;
        if (hoveredRowRef.current !== newRow) {
            const damage: { cell: Item }[] = [];
            if (hoveredRowRef.current !== undefined) damage.push({ cell: [0, hoveredRowRef.current] });
            if (newRow !== undefined) damage.push({ cell: [0, newRow] });
            hoveredRowRef.current = newRow;
            if (damage.length > 0) gridRef.current?.updateCells(damage);
        }
    }, []);

    const drawCell: DrawCellCallback = useCallback((args, drawContent) => {
        const { ctx, rect, col, row } = args;
        drawContent();
        if (col === 0 && hoveredRowRef.current === row) {
            drawExpandIcon(ctx, rect.x, rect.y, rect.height, token.colorText);
        }
    }, [token]);

    const drawHeader: DrawHeaderCallback = useCallback((args, draw) => {
        const { ctx, rect, column, theme: glideTheme } = args;
        const title = column.title ?? "";

        if (!title.includes("\n")) {
            draw();
            return;
        }

        const [dayName, dateNum] = title.split("\n");
        ctx.save();

        ctx.fillStyle = glideTheme.bgHeader;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${token.fontSizeSM + 1}px ${glideTheme.fontFamily}`;
        ctx.fillStyle = glideTheme.textHeader;
        ctx.fillText(dateNum!, rect.x + rect.width / 2, rect.y + rect.height / 2 - 7);

        ctx.font = `400 ${token.fontSizeSM - 1}px ${glideTheme.fontFamily}`;
        ctx.fillStyle = token.colorTextTertiary;
        ctx.fillText(dayName!, rect.x + rect.width / 2, rect.y + rect.height / 2 + 8);

        ctx.strokeStyle = glideTheme.borderColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rect.x, rect.y + rect.height);
        ctx.lineTo(rect.x + rect.width, rect.y + rect.height);
        ctx.stroke();

        ctx.restore();
    }, [token]);

    const handleVisibleRegion = useCallback((range: Rectangle) => {
        onVisibleRegionChanged?.(range.y, range.y + range.height);
    }, [onVisibleRegionChanged]);

    const handleCellClicked = useCallback(([col, row]: Item) => {
        if (row >= employees.length) return;
        const emp = employees[row]!;
        if (col === 0) {
            onEmployeeClick?.(emp);
            return;
        }
        if (col >= 2 && onDayCellClick) {
            const day = days[col - 2];
            if (day) onDayCellClick(emp, day);
        }
    }, [employees, days, onEmployeeClick, onDayCellClick]);

    return (
        <DataEditor
            ref={gridRef}
            columns={columns}
            rows={employees.length}
            getCellContent={getCellContent}
            rowHeight={32}
            headerHeight={44}
            smoothScrollX
            smoothScrollY
            width="100%"
            height="100%"
            freezeColumns={2}
            fixedShadowX
            theme={gridTheme}
            rowMarkers="number"
            drawHeader={drawHeader}
            drawCell={drawCell}
            onItemHovered={handleItemHovered}
            onVisibleRegionChanged={handleVisibleRegion}
            onCellClicked={handleCellClicked}
        />
    );
};
