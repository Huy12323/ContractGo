import { useState, useEffect, useMemo } from "react";
import { useMatch } from "@tanstack/react-router";
import { Button, Popover, theme, Typography } from "antd";
import {
  ClockCircleOutlined,
  CoffeeOutlined,
  CaretDownOutlined,
  PoweroffOutlined,
  PlayCircleOutlined,
  LoginOutlined,
} from "@ant-design/icons";
import { useQ_Tables_MyEmployeeEntities } from "@/hooks/useQ_Tables_MyEmployeeEntities";
import { useQ_Tables_MyTimeclockStatus } from "@/hooks/useQ_Tables_MyTimeclockStatus";
import { useQ_Tables_TimeclockSessions } from "@/hooks/useQ_Tables_TimeclockEvents";
import { useM_TimeclockEvent_Create } from "@/hooks/useM_TimeclockEvent_Create";
import { formatTimeInTz, formatDuration } from "@/utils/timeclock/utils_Timeclock_AggregateEvents";
import { TIMECLOCK_COLORS } from "@/utils/timeclock/const_Timeclock_Colors";
import { App_TimeclockEventDot } from "@/components/timeclock/App_TimeclockEventDot";

const formatElapsed = (startIso: string) => {
  const ms = Date.now() - new Date(startIso).getTime();
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

export const App_ClockStrip = () => {
  const { token } = theme.useToken();
  const organizationId = useMatch({
    from: "/_protected/$organizationId",
    shouldThrow: false,
    select: (m) => m.params.organizationId,
  }) ?? "";
  const qEntities = useQ_Tables_MyEmployeeEntities({ organizationId });
  const qStatus = useQ_Tables_MyTimeclockStatus({ organizationId });
  const mEvent = useM_TimeclockEvent_Create();
  const [elapsed, setElapsed] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const { status } = qStatus;
  const fallbackTz = (qEntities.employeeEntities[0]?.entities as { timezone?: string } | null)?.timezone;
  const timezone = status.entityTimezone ?? fallbackTz ?? "UTC";

  const employeeId = status.employeeId ?? qEntities.employeeEntities[0]?.id ?? "";
  const todayStart = useMemo(() => {
    const sampleLocal = new Date().toLocaleString("en-US", { timeZone: timezone });
    const sampleUtc = new Date().toLocaleString("en-US", { timeZone: "UTC" });
    const diff = new Date(sampleUtc).getTime() - new Date(sampleLocal).getTime();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")!.value;
    const m = parts.find((p) => p.type === "month")!.value;
    const d = parts.find((p) => p.type === "day")!.value;
    const s = new Date(new Date(`${y}-${m}-${d}T00:00:00Z`).getTime() + diff);
    return { startUtc: s.toISOString(), endUtc: new Date(s.getTime() + 86400000).toISOString() };
  }, [timezone]);

  const qTodaySessions = useQ_Tables_TimeclockSessions({
    employeeIds: employeeId ? [employeeId] : [],
    startUtc: todayStart.startUtc,
    endUtc: todayStart.endUtc,
  });

  const todayTimeline = useMemo(() => {
    const sessions = qTodaySessions.sessions;
    if (sessions.length === 0) return [];

    const events: { at: string; label: string; eventType: string }[] = [];
    for (const s of sessions) {
      if (s.type === "work") {
        events.push({ at: s.start_at, label: "Clock In", eventType: "clock_in" });
        if (s.end_at) events.push({ at: s.end_at, label: "Clock Out", eventType: "clock_out" });
      } else {
        events.push({ at: s.start_at, label: "Break", eventType: "lunch_start" });
        if (s.end_at) events.push({ at: s.end_at, label: "Back to Work", eventType: "lunch_end" });
      }
    }
    events.sort((a, b) => a.at.localeCompare(b.at));

    const result: { time: string; label: string; eventType: string; duration: string | null; isActive: boolean }[] = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      const elapsed = i > 0 ? new Date(e.at).getTime() - new Date(events[i - 1]!.at).getTime() : null;
      result.push({
        time: formatTimeInTz(e.at, timezone),
        label: e.label,
        eventType: e.eventType,
        duration: elapsed ? formatDuration(elapsed) : null,
        isActive: false,
      });
    }

    const hasOpenBreak = sessions.some((s) => s.type === "break" && !s.end_at);
    const hasOpenWork = sessions.some((s) => s.type === "work" && !s.end_at);
    if (hasOpenBreak) {
      result.push({ time: "", label: "On Break...", eventType: "on_lunch", duration: null, isActive: true });
    } else if (hasOpenWork) {
      result.push({ time: "", label: "Working...", eventType: "working", duration: null, isActive: true });
    }

    return result;
  }, [qTodaySessions.sessions, timezone]);

  const liveDuration = useMemo(() => {
    const openWork = qTodaySessions.sessions.find((s) => s.type === "work" && !s.end_at);
    return openWork?.start_at ?? null;
  }, [qTodaySessions.sessions]);

  const [liveDur, setLiveDur] = useState("");
  useEffect(() => {
    if (!liveDuration) { setLiveDur(""); return; }
    setLiveDur(formatElapsed(liveDuration));
    const interval = setInterval(() => setLiveDur(formatElapsed(liveDuration)), 1000);
    return () => clearInterval(interval);
  }, [liveDuration]);

  useEffect(() => {
    const timerSource = status.state === "on_lunch" ? status.lunchStartedAt : status.sessionStartedAt;
    if (!timerSource || status.state === "idle") { setElapsed(""); return; }
    setElapsed(formatElapsed(timerSource));
    const interval = setInterval(() => setElapsed(formatElapsed(timerSource)), 1000);
    return () => clearInterval(interval);
  }, [status.state, status.sessionStartedAt, status.lunchStartedAt]);

  if (qEntities.employeeEntities.length === 0) return null;

  const handleClockIn = (eId: string, entId: string) => {
    mEvent.mutation.mutate({ employee_id: eId, entity_id: entId, event_type: "clock_in" });
    setPopoverOpen(false);
  };

  const handleAction = (eventType: "clock_out" | "lunch_start" | "lunch_end") => {
    if (!status.employeeId || !status.entityId) return;
    mEvent.mutation.mutate({ employee_id: status.employeeId, entity_id: status.entityId, event_type: eventType });
    setPopoverOpen(false);
  };

  const stripBase: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, padding: "0 14px",
    borderRadius: token.borderRadiusSM, height: 32, fontSize: token.fontSizeSM,
    whiteSpace: "nowrap", cursor: "pointer", fontWeight: 500, transition: "background 0.15s",
  };

  const btnStyle: React.CSSProperties = {
    height: 34, borderRadius: token.borderRadiusSM, fontWeight: 600,
    fontSize: 12, border: "none", display: "flex", flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 6, padding: "0 14px",
  };

  const timelineSection = todayTimeline.length > 0 && (
    <div style={{ borderTop: `1px solid ${token.colorBorder}`, paddingTop: 10, marginTop: 10 }}>
      {todayTimeline.map((entry, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13 }}>
          <App_TimeclockEventDot eventType={entry.eventType} pulse={entry.isActive} />
          <span style={{ fontWeight: 700, width: 42, fontVariantNumeric: "tabular-nums", color: entry.isActive ? TIMECLOCK_COLORS.work.solid : token.colorText }}>
            {entry.time}
          </span>
          <span style={{ flex: 1, color: entry.isActive ? TIMECLOCK_COLORS.work.solid : token.colorTextSecondary, fontWeight: entry.isActive ? 600 : 400 }}>
            {entry.label}
          </span>
          {entry.duration && (
            <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>{entry.duration}</span>
          )}
          {entry.isActive && liveDur && (
            <span style={{ fontSize: 11, fontWeight: 600, color: TIMECLOCK_COLORS.work.solid, fontVariantNumeric: "tabular-nums" }}>{liveDur}</span>
          )}
        </div>
      ))}
    </div>
  );

  const popoverContent = (
    <div style={{ minWidth: 240 }}>
      {status.state === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>Clock in to:</Typography.Text>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {qEntities.employeeEntities.map((ee) => {
              const entity = ee.entities as { id: string; name: string; timezone: string } | null;
              return (
                <Button key={ee.id} icon={<LoginOutlined style={{ fontSize: 14 }} />}
                  onClick={() => handleClockIn(ee.id, ee.entity_id)} loading={mEvent.mutation.isPending}
                  style={{ ...btnStyle, background: "#6366f1", color: "#fff" }}>
                  {entity?.name ?? "Entity"}
                </Button>
              );
            })}
          </div>
          {timelineSection}
        </div>
      )}
      {status.state === "clocked_in" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>Working at {status.entityName}</Typography.Text>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Button icon={<CoffeeOutlined style={{ fontSize: 14 }} />}
              onClick={() => handleAction("lunch_start")} loading={mEvent.mutation.isPending}
              style={{ ...btnStyle, background: "#c7d2fe", color: "#4338ca" }}>
              Lunch
            </Button>
            <Button icon={<PoweroffOutlined style={{ fontSize: 14 }} />}
              onClick={() => handleAction("clock_out")} loading={mEvent.mutation.isPending}
              style={{ ...btnStyle, background: "#6366f1", color: "#fff" }}>
              Clock Out
            </Button>
          </div>
          {timelineSection}
        </div>
      )}
      {status.state === "on_lunch" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>On lunch at {status.entityName}</Typography.Text>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Button icon={<PlayCircleOutlined style={{ fontSize: 14 }} />}
              onClick={() => handleAction("lunch_end")} loading={mEvent.mutation.isPending}
              style={{ ...btnStyle, background: "#6366f1", color: "#fff" }}>
              Resume
            </Button>
          </div>
          {timelineSection}
        </div>
      )}
    </div>
  );

  if (status.state === "idle") {
    return (
      <Popover content={popoverContent} trigger="click" open={popoverOpen} onOpenChange={setPopoverOpen} placement="bottomRight">
        <div style={{ ...stripBase, background: "rgba(0,0,0,0.04)", color: token.colorTextSecondary }}>
          <ClockCircleOutlined />
          <span>Not clocked in</span>
          <CaretDownOutlined style={{ fontSize: 10 }} />
        </div>
      </Popover>
    );
  }

  const isLunch = status.state === "on_lunch";

  return (
    <Popover content={popoverContent} trigger="click" open={popoverOpen} onOpenChange={setPopoverOpen} placement="bottomRight">
      <div style={{
        ...stripBase,
        background: isLunch ? "#c7d2fe" : "#6366f1",
        color: isLunch ? "#4338ca" : "#fff",
      }}>
        {!isLunch && <App_TimeclockEventDot eventType="working" pulse color="#fff" />}
        {isLunch && <CoffeeOutlined />}
        <span>{status.entityName}</span>
        <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{elapsed}</span>
      </div>
    </Popover>
  );
};
