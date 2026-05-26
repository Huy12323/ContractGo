import { useState, useCallback } from "react";
import { theme } from "antd";
import type { TimeclockSession } from "@/utils/timeclock/utils_Timeclock_AggregateEvents";
import { formatTimeInTz, formatDuration } from "@/utils/timeclock/utils_Timeclock_AggregateEvents";
import { TIMECLOCK_COLORS } from "@/utils/timeclock/const_Timeclock_Colors";

const toPercent = (h: number, m: number, s: number) => ((h + m / 60 + s / 3600) / 24) * 100;

const timeToPercent = (isoStr: string, timezone: string) => {
    try {
        const parts = new Date(isoStr).toLocaleTimeString("en-GB", {
            timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        }).split(":");
        return toPercent(parseInt(parts[0]!), parseInt(parts[1]!), parseInt(parts[2]!));
    } catch {
        const d = new Date(isoStr);
        return toPercent(d.getHours(), d.getMinutes(), d.getSeconds());
    }
};

// Midnight end_at (00:00) should render as 100% (end of day), not 0% (start of day).
const endTimeToPercent = (isoStr: string, timezone: string, startPct: number) => {
    const pct = timeToPercent(isoStr, timezone);
    return pct === 0 && startPct === 0 ? 100 : pct;
};

const HOUR_TICKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

export const App_TimeclockBar24 = ({
    sessions,
    timezone,
    height = 20,
    showNow = false,
    showHourLabels = false,
}: {
    sessions: TimeclockSession[];
    timezone: string;
    height?: number;
    showNow?: boolean;
    showHourLabels?: boolean;
}) => {
    const { token } = theme.useToken();
    const [tip, setTip] = useState<{ x: number; y: number; text: string; color: string } | null>(null);

    const showTip = useCallback((e: React.MouseEvent, text: string, color: string) => {
        setTip({ x: e.clientX, y: e.clientY, text, color });
    }, []);
    const hideTip = useCallback(() => setTip(null), []);

    const nowPercent = showNow ? (() => {
        const now = new Date();
        try {
            const parts = now.toLocaleTimeString("en-GB", {
                timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
            }).split(":");
            return toPercent(parseInt(parts[0]!), parseInt(parts[1]!), parseInt(parts[2]!));
        } catch {
            return toPercent(now.getHours(), now.getMinutes(), now.getSeconds());
        }
    })() : null;

    return (
        <div style={{ position: "relative", height, background: token.colorFillAlter, borderRadius: token.borderRadiusSM, overflow: "visible", marginLeft: 6, marginRight: 10 }}>
            {HOUR_TICKS.map((h) => (
                <div key={h} style={{ position: "absolute", left: `${(h / 24) * 100}%`, top: 0, height: "100%", width: 1, background: token.colorBorder, opacity: 0.6 }} />
            ))}

            {showHourLabels && HOUR_TICKS.map((h) => (
                <span key={`lbl-${h}`} style={{
                    position: "absolute", left: `${(h / 24) * 100}%`, bottom: -16,
                    transform: "translateX(-50%)", fontSize: 10, color: token.colorTextQuaternary, fontWeight: 500,
                    pointerEvents: "none",
                }}>
                    {h}
                </span>
            ))}

            {(() => {
                const workSessions = sessions.filter((s) => s.type === "work");
                const lunchSessions = sessions.filter((s) => s.type === "lunch");

                if (workSessions.length === 0) return null;

                return (
                    <>
                        {workSessions.map((ws, wi) => {
                            const startPct = timeToPercent(ws.startAt, timezone);
                            const endPct = ws.endAt ? endTimeToPercent(ws.endAt, timezone, startPct) : (nowPercent ?? startPct);
                            const width = Math.max(endPct - startPct, 0.3);
                            const wsText = `Work: ${formatTimeInTz(ws.startAt, timezone)} → ${ws.endAt ? formatTimeInTz(ws.endAt, timezone) : "Now"} · ${formatDuration(ws.durationMs)}`;

                            const innerLunches = lunchSessions.filter((ls) => {
                                const lsPct = timeToPercent(ls.startAt, timezone);
                                return lsPct >= startPct && lsPct < endPct;
                            });

                            return (
                                <div key={`work-${wi}`}
                                    onMouseMove={(e) => showTip(e, wsText, TIMECLOCK_COLORS.work.solid)}
                                    onMouseLeave={hideTip}
                                    style={{
                                        position: "absolute", left: `${startPct}%`, width: `${width}%`, top: 0, height: "100%",
                                        background: TIMECLOCK_COLORS.work.solid,
                                        borderRadius: token.borderRadiusSM,
                                        overflow: "hidden",
                                    }}
                                >
                                    {innerLunches.map((ls, li) => {
                                        const lsStartPct = timeToPercent(ls.startAt, timezone);
                                        const lsEndPct = ls.endAt ? endTimeToPercent(ls.endAt, timezone, lsStartPct) : (nowPercent ?? lsStartPct);
                                        const lsWidth = Math.max(lsEndPct - lsStartPct, 0.3);
                                        const relLeft = ((lsStartPct - startPct) / width) * 100;
                                        const relWidth = (lsWidth / width) * 100;
                                        const lsText = `Break: ${formatTimeInTz(ls.startAt, timezone)} → ${ls.endAt ? formatTimeInTz(ls.endAt, timezone) : "Now"} · ${formatDuration(ls.durationMs)}`;
                                        return (
                                            <div key={`lunch-${li}`}
                                                onMouseMove={(e) => { e.stopPropagation(); showTip(e, lsText, TIMECLOCK_COLORS.lunch.text); }}
                                                onMouseLeave={(e) => { e.stopPropagation(); hideTip(); }}
                                                style={{
                                                    position: "absolute", left: `${relLeft}%`, width: `${relWidth}%`, top: 0, height: "100%",
                                                    background: TIMECLOCK_COLORS.lunch.solid,
                                                }}
                                            />
                                        );
                                    })}
                                </div>
                            );
                        })}

                        {/* Timestamps */}
                        {workSessions.map((ws, wi) => {
                            const startPct = timeToPercent(ws.startAt, timezone);
                            const endPct = ws.endAt ? endTimeToPercent(ws.endAt, timezone, startPct) : (nowPercent ?? startPct);
                            const width = Math.max(endPct - startPct, 0.3);
                            const startLabel = formatTimeInTz(ws.startAt, timezone);
                            const endLabel = ws.endAt ? formatTimeInTz(ws.endAt, timezone) : null;

                            const innerLunches = lunchSessions.filter((ls) => {
                                const lsPct = timeToPercent(ls.startAt, timezone);
                                return lsPct >= startPct && lsPct < endPct;
                            });

                            return (
                                <div key={`labels-${wi}`}>
                                    <span style={{ position: "absolute", left: `${startPct}%`, top: -16, fontSize: 11, color: token.colorTextSecondary, fontWeight: 600, transform: "translateX(-50%)", whiteSpace: "nowrap", zIndex: 3 }}>
                                        {startLabel}
                                    </span>
                                    {endLabel && (
                                        <span style={{ position: "absolute", left: `${startPct + width}%`, top: -16, fontSize: 11, color: token.colorTextSecondary, fontWeight: 600, transform: "translateX(-50%)", whiteSpace: "nowrap", zIndex: 3 }}>
                                            {endLabel}
                                        </span>
                                    )}
                                    {innerLunches.map((ls, li) => {
                                        const lsStartPct = timeToPercent(ls.startAt, timezone);
                                        const lsEndPct = ls.endAt ? endTimeToPercent(ls.endAt, timezone, lsStartPct) : (nowPercent ?? lsStartPct);
                                        const lsWidth = Math.max(lsEndPct - lsStartPct, 0.3);
                                        return (
                                            <div key={`lunch-label-${li}`}>
                                                <span style={{ position: "absolute", left: `${lsStartPct}%`, top: -16, fontSize: 11, color: token.colorTextSecondary, fontWeight: 600, transform: "translateX(-50%)", whiteSpace: "nowrap", zIndex: 3 }}>
                                                    {formatTimeInTz(ls.startAt, timezone)}
                                                </span>
                                                {ls.endAt && (
                                                    <span style={{ position: "absolute", left: `${lsStartPct + lsWidth}%`, top: -16, fontSize: 11, color: token.colorTextSecondary, fontWeight: 600, transform: "translateX(-50%)", whiteSpace: "nowrap", zIndex: 3 }}>
                                                        {formatTimeInTz(ls.endAt, timezone)}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </>
                );
            })()}

            {nowPercent !== null && (
                <>
                    <div style={{ position: "absolute", left: `${nowPercent}%`, top: -4, height: "calc(100% + 8px)", width: 2, background: token.colorError, zIndex: 2 }} />
                    <span style={{ position: "absolute", left: `${nowPercent}%`, top: -16, fontSize: 11, color: token.colorError, fontWeight: 700, transform: "translateX(-50%)" }}>
                        {new Date().toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })}
                    </span>
                </>
            )}

            {tip && (
                <div style={{
                    position: "fixed", left: tip.x, top: tip.y + 24,
                    background: "rgba(255,255,255,0.88)", color: tip.color,
                    padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                    pointerEvents: "none", zIndex: 9999, whiteSpace: "nowrap",
                    transform: "translateX(-50%)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                }}>
                    {tip.text}
                </div>
            )}
        </div>
    );
};

export const App_TimeclockBar24HourRuler = () => {
    const { token } = theme.useToken();
    const labels = [0, 3, 6, 9, 12, 15, 18, 21, 24];
    return (
        <div style={{ position: "relative", height: 14 }}>
            {labels.map((h) => (
                <span key={h} style={{
                    position: "absolute", left: `${(h / 24) * 100}%`, transform: "translateX(-50%)",
                    fontSize: 11, color: token.colorTextQuaternary, fontWeight: 500,
                }}>
                    {h}
                </span>
            ))}
        </div>
    );
};

export const App_TimeclockLegend = () => {
    const { token } = theme.useToken();
    const items = [
        { color: TIMECLOCK_COLORS.work.solid, label: "Work" },
        { color: TIMECLOCK_COLORS.lunch.solid, label: "Lunch", border: true },
        { color: TIMECLOCK_COLORS.idle.solid, label: "Idle" },
    ];
    return (
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: token.colorTextSecondary, marginBottom: 8 }}>
            {items.map((it) => (
                <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 14, height: 10, borderRadius: 2, background: it.color, border: it.border ? `1px solid ${token.colorBorder}` : undefined }} />
                    {it.label}
                </div>
            ))}
        </div>
    );
};
