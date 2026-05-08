import { TIMECLOCK_COLORS } from "@/utils/timeclock/const_Timeclock_Colors";

export const TIMECLOCK_EVENT_COLORS: Record<string, string> = {
    clock_in: TIMECLOCK_COLORS.work.solid,
    clock_out: TIMECLOCK_COLORS.work.dark,
    lunch_start: TIMECLOCK_COLORS.lunch.solid,
    lunch_end: TIMECLOCK_COLORS.work.soft,
    working: TIMECLOCK_COLORS.work.solid,
    on_lunch: TIMECLOCK_COLORS.lunch.solid,
};

let styleInjected = false;
const ensureKeyframes = () => {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement("style");
    style.textContent = "@keyframes tc-pulse-dot{0%,100%{opacity:1}50%{opacity:.3}}";
    document.head.appendChild(style);
};

export const App_TimeclockEventDot = ({
    eventType,
    size = 8,
    pulse = false,
    color,
}: {
    eventType: string;
    size?: number;
    pulse?: boolean;
    color?: string;
}) => {
    if (pulse) ensureKeyframes();
    return (
        <span
            style={{
                width: size,
                height: size,
                borderRadius: "50%",
                flexShrink: 0,
                background: color ?? TIMECLOCK_EVENT_COLORS[eventType] ?? TIMECLOCK_COLORS.idle.solid,
                animation: pulse ? "tc-pulse-dot 1.5s ease-in-out infinite" : undefined,
            }}
        />
    );
};
