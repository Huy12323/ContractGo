export type ViewMode = "day" | "week" | "month" | "cycle" | "custom";

export type DateRange = {
    startDate: string;
    endDate: string;
    label: string;
};

const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const startOfWeek = (d: Date) => {
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.getFullYear(), d.getMonth(), diff);
};

const endOfWeek = (d: Date) => {
    const sun = startOfWeek(d);
    return new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 6);
};

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatDateShort = (d: Date) => {
    const day = DAYS_SHORT[d.getDay()];
    return `${day}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

const formatDateFull = (d: Date) =>
    `${DAYS_SHORT[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

export const getDateRange = (mode: ViewMode, refDate: Date, customStart?: Date, customEnd?: Date): DateRange => {
    switch (mode) {
        case "day": {
            const d = startOfDay(refDate);
            return { startDate: fmt(d), endDate: fmt(d), label: formatDateFull(d) };
        }
        case "week": {
            const s = startOfWeek(refDate);
            const e = endOfWeek(refDate);
            return {
                startDate: fmt(s),
                endDate: fmt(e),
                label: `${formatDateShort(s)} – ${formatDateShort(e)}, ${e.getFullYear()}`,
            };
        }
        case "month": {
            const s = startOfMonth(refDate);
            const e = endOfMonth(refDate);
            return { startDate: fmt(s), endDate: fmt(e), label: `${MONTHS[refDate.getMonth()]} ${refDate.getFullYear()}` };
        }
        case "cycle": {
            const weekStart = startOfWeek(refDate);
            const weekNum = Math.floor((weekStart.getTime() - new Date(weekStart.getFullYear(), 0, 1).getTime()) / (7 * 86400000));
            const isEvenWeek = weekNum % 2 === 0;
            const cycleStart = isEvenWeek ? weekStart : new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 7);
            const cycleEnd = new Date(cycleStart.getFullYear(), cycleStart.getMonth(), cycleStart.getDate() + 13);
            return {
                startDate: fmt(cycleStart),
                endDate: fmt(cycleEnd),
                label: `${formatDateShort(cycleStart)} – ${formatDateShort(cycleEnd)}, ${cycleEnd.getFullYear()}`,
            };
        }
        case "custom": {
            const s = customStart ?? refDate;
            const e = customEnd ?? refDate;
            return {
                startDate: fmt(s),
                endDate: fmt(e),
                label: `${formatDateShort(s)} – ${formatDateShort(e)}, ${e.getFullYear()}`,
            };
        }
    }
};

export const navigateDate = (mode: ViewMode, refDate: Date, direction: "prev" | "next"): Date => {
    const d = direction === "next" ? 1 : -1;
    switch (mode) {
        case "day":
            return new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate() + d);
        case "week":
            return new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate() + d * 7);
        case "month":
            return new Date(refDate.getFullYear(), refDate.getMonth() + d, 1);
        case "cycle":
            return new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate() + d * 14);
        case "custom":
            return refDate;
    }
};

export const getDaysInRange = (startDate: string, endDate: string): Date[] => {
    const days: Date[] = [];
    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");
    const cur = new Date(start);
    while (cur <= end) {
        days.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return days;
};

export const fmtDate = fmt;
export const isToday = (d: Date) => fmt(d) === fmt(new Date());
export const isFuture = (d: Date) => fmt(d) > fmt(new Date());
export const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
export const formatDayLabel = (d: Date) => `${DAYS_SHORT[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
