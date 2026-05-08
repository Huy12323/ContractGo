import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useMatch } from "@tanstack/react-router";
import { Segmented, Button, Input, Typography, Spin, DatePicker, theme } from "antd";
import { LeftOutlined, RightOutlined, SearchOutlined } from "@ant-design/icons";
import { App_PageToolbar } from "@/components/app-shell/App_PageToolbar";
import { useQ_Tables_OrgEntities } from "@/hooks/useQ_Tables_OrgEntities";
import { useQ_Tables_OrgEmployees } from "@/hooks/useQ_Tables_OrgEmployees";
import { useQ_Tables_TimesheetGrid } from "@/hooks/useQ_Tables_EntityTimeclockEvents";
import { useQ_Tables_EntityTimeclockLiveStatus } from "@/hooks/useQ_Tables_EntityTimeclockLiveStatus";
import { useQ_Tables_EntityTimeclockEventsToday } from "@/hooks/useQ_Tables_EntityTimeclockEventsToday";
import type { EmployeeLiveStatus } from "@/hooks/useQ_Tables_EntityTimeclockLiveStatus";
import { getDateRange, navigateDate, getDaysInRange, isWeekend, fmtDate } from "@/utils/timeclock/utils_Timeclock_DateRange";
import type { ViewMode } from "@/utils/timeclock/utils_Timeclock_DateRange";
import { Utils_String_GetInitials } from "@/utils/Utils_String_GetInitials";
import { PageTimesheets_Grid } from "./PageTimesheets_Grid";
import type { GridEmployee } from "./PageTimesheets_Grid";
import { PageTimesheets_EmployeeModal } from "./PageTimesheets_EmployeeModal";
import type { RangePickerProps } from "antd/es/date-picker";
import dayjs from "dayjs";

const { Text } = Typography;
const { RangePicker } = DatePicker;

const HR_VIEWS = ["Week", "Month", "Cycle", "Custom"] as const;
const VIEW_MAP: Record<string, ViewMode> = { Week: "week", Month: "month", Cycle: "cycle", Custom: "custom" };
const VIEW_REVERSE: Record<string, string> = { week: "Week", month: "Month", cycle: "Cycle", custom: "Custom" };

const SAFE_ROW_LIMIT = 900;

export const Page_Timesheets = () => {
    const { token } = theme.useToken();
    const organizationId = useMatch({ from: "/_protected/$organizationId", shouldThrow: false, select: (m) => m.params.organizationId }) ?? "";
    const qEntities = useQ_Tables_OrgEntities({ organizationId });

    const [entityId, setEntityId] = useState("");
    const [viewMode, setViewMode] = useState<ViewMode>("week");
    const [refDate, setRefDate] = useState(new Date());
    const [searchText, setSearchText] = useState("");
    const [customRange, setCustomRange] = useState<[Date, Date] | null>(null);
    const [selectedEmployee, setSelectedEmployee] = useState<GridEmployee | null>(null);

    const activeEntityId = entityId || qEntities.entities[0]?.id || "";
    const activeEntity = qEntities.entities.find((e) => e.id === activeEntityId);
    const timezone = activeEntity?.timezone ?? "UTC";
    const dateRange = useMemo(() => getDateRange(viewMode, refDate, customRange?.[0], customRange?.[1]), [viewMode, refDate, customRange]);
    const days = useMemo(() => getDaysInRange(dateRange.startDate, dateRange.endDate), [dateRange]);

    const { startUtc, endUtc } = useMemo(() => {
        const s = new Date(`${dateRange.startDate}T00:00:00Z`);
        const e = new Date(`${dateRange.endDate}T00:00:00Z`);
        e.setDate(e.getDate() + 1);
        const tzName = timezone || "UTC";
        const sampleLocal = new Date().toLocaleString("en-US", { timeZone: tzName });
        const sampleUtc = new Date().toLocaleString("en-US", { timeZone: "UTC" });
        const diff = new Date(sampleUtc).getTime() - new Date(sampleLocal).getTime();
        return {
            startUtc: new Date(s.getTime() + diff).toISOString(),
            endUtc: new Date(e.getTime() + diff).toISOString(),
        };
    }, [dateRange.startDate, dateRange.endDate, timezone]);

    const [debouncedSearch, setDebouncedSearch] = useState("");
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchText.trim()), 300);
        return () => clearTimeout(t);
    }, [searchText]);

    const qEmployees = useQ_Tables_OrgEmployees({ entityId: activeEntityId, searchText: debouncedSearch || undefined });
    const qLiveStatus = useQ_Tables_EntityTimeclockLiveStatus({ entityId: activeEntityId });
    const qToday = useQ_Tables_EntityTimeclockEventsToday({ entityId: activeEntityId, timezone });

    // --- Batch loading ---

    const batchSize = useMemo(() => Math.max(10, Math.floor(SAFE_ROW_LIMIT / Math.max(days.length, 1))), [days.length]);

    const employeeBase = useMemo(() => {
        return qEmployees.employees.map((emp) => ({
            id: emp.id,
            name: (emp.__full_name ?? `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim()) || emp.email,
            initials: Utils_String_GetInitials((emp.__full_name ?? `${emp.first_name ?? ""} ${emp.last_name ?? ""}`) || undefined),
        }));
    }, [qEmployees.employees]);

    const employeeBatches = useMemo(() => {
        const result: string[][] = [];
        for (let i = 0; i < employeeBase.length; i += batchSize) {
            result.push(employeeBase.slice(i, i + batchSize).map((e) => e.id));
        }
        return result;
    }, [employeeBase, batchSize]);

    const empToBatch = useMemo(() => {
        const map = new Map<string, number>();
        employeeBase.forEach((e, i) => map.set(e.id, Math.floor(i / batchSize)));
        return map;
    }, [employeeBase, batchSize]);

    const enabledBatchesRef = useRef(new Set<number>([0]));
    const [enabledBatchesVersion, setEnabledBatchesVersion] = useState(0);

    const prevBatchCountRef = useRef(employeeBatches.length);
    useEffect(() => {
        if (employeeBatches.length !== prevBatchCountRef.current) {
            prevBatchCountRef.current = employeeBatches.length;
            enabledBatchesRef.current = new Set([0]);
            setEnabledBatchesVersion((v) => v + 1);
        }
    }, [employeeBatches.length]);

    const handleVisibleRegionChanged = useCallback(
        (startRow: number, endRow: number) => {
            const overscan = batchSize;
            const start = Math.max(0, startRow - overscan);
            const end = Math.min(employeeBase.length - 1, endRow + overscan);
            let changed = false;
            for (let i = start; i <= end; i++) {
                const batchIdx = empToBatch.get(employeeBase[i]?.id ?? "");
                if (batchIdx !== undefined && !enabledBatchesRef.current.has(batchIdx)) {
                    enabledBatchesRef.current.add(batchIdx);
                    changed = true;
                }
            }
            if (changed) setEnabledBatchesVersion((v) => v + 1);
        },
        [batchSize, employeeBase, empToBatch]
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const enabledBatches = useMemo(() => new Set(enabledBatchesRef.current), [enabledBatchesVersion]);

    const qGrid = useQ_Tables_TimesheetGrid({
        entityId: activeEntityId,
        startUtc,
        endUtc,
        timezone,
        employeeBatches,
        enabledBatches,
    });

    const today = fmtDate(new Date());
    const dateRangeIncludesToday = dateRange.startDate <= today && dateRange.endDate >= today;

    const summaryIndex = useMemo(() => {
        const index = new Map<string, number>(qGrid.summaryIndex);
        if (dateRangeIncludesToday) {
            for (const [empId, ms] of qToday.todayWorkedByEmployee) {
                index.set(`${empId}|${today}`, ms);
            }
        }
        return index;
    }, [qGrid.summaryIndex, qToday.todayWorkedByEmployee, dateRangeIncludesToday, today]);

    const employeeGridData = useMemo((): GridEmployee[] => {
        return employeeBase.map((emp) => {
            const dailyHours: (number | null)[] = days.map((d) => {
                if (isWeekend(d)) return null;
                const ms = summaryIndex.get(`${emp.id}|${fmtDate(d)}`);
                return ms && ms > 0 ? ms : null;
            });
            const totalMs = dailyHours.reduce<number>((sum, h) => sum + (h ?? 0), 0);
            return {
                ...emp,
                liveStatus: (qLiveStatus.statusMap[emp.id] ?? "idle") as EmployeeLiveStatus,
                dailyHours,
                totalMs,
            };
        });
    }, [employeeBase, summaryIndex, qLiveStatus.statusMap, days]);

    const handleRangeChange: RangePickerProps["onChange"] = (dates) => {
        if (dates?.[0] && dates?.[1]) setCustomRange([dates[0].toDate(), dates[1].toDate()]);
    };

    if (qEntities.entities.length === 0) {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: token.colorTextQuaternary }}>
                <Text type="secondary">No entities found in this organization</Text>
            </div>
        );
    }

    if (!entityId && qEntities.entities[0]) {
        setEntityId(qEntities.entities[0].id);
    }

    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Top toolbar */}
            <App_PageToolbar
                organizationId={organizationId}
                entityId={activeEntityId}
                onEntityChange={setEntityId}
            />

            {/* Inner toolbar — search + view toggle + date nav */}
            <div style={{
                height: 40, minHeight: 40, display: "flex", alignItems: "center",
                padding: `0 ${token.paddingLG}px`, gap: token.marginXS,
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
            }}>
                <Segmented
                    size="small"
                    options={HR_VIEWS as unknown as string[]}
                    value={VIEW_REVERSE[viewMode]}
                    onChange={(v) => setViewMode(VIEW_MAP[v as string]!)}
                />
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    {viewMode === "custom" ? (
                        <RangePicker
                            size="small"
                            value={customRange ? [dayjs(customRange[0]), dayjs(customRange[1])] : undefined}
                            onChange={handleRangeChange}
                        />
                    ) : (
                        <>
                            <Button size="small" type="text" icon={<LeftOutlined />} onClick={() => setRefDate(navigateDate(viewMode, refDate, "prev"))} />
                            <Text strong style={{ minWidth: 180, textAlign: "center", fontSize: token.fontSizeSM }}>{dateRange.label}</Text>
                            <Button size="small" type="text" icon={<RightOutlined />} onClick={() => setRefDate(navigateDate(viewMode, refDate, "next"))} />
                            <Button size="small" onClick={() => setRefDate(new Date())}>Today</Button>
                        </>
                    )}
                </div>
                <Input
                    size="small"
                    placeholder="Search employee..."
                    prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    allowClear
                    style={{ width: 220 }}
                />
            </div>

            {/* Grid area */}
            <div style={{ flex: 1, overflow: "hidden" }}>
                {qEmployees.query.isLoading ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                        <Spin size="large" />
                    </div>
                ) : (
                    <PageTimesheets_Grid
                        employees={employeeGridData}
                        days={days}
                        onEmployeeClick={setSelectedEmployee}
                        onVisibleRegionChanged={handleVisibleRegionChanged}
                    />
                )}
            </div>

            {selectedEmployee && (
                <PageTimesheets_EmployeeModal
                    open={!!selectedEmployee}
                    onClose={() => setSelectedEmployee(null)}
                    employeeId={selectedEmployee.id}
                    employeeName={selectedEmployee.name}
                    entityId={activeEntityId}
                    timezone={timezone}
                />
            )}
        </div>
    );
};
