import { useMemo } from "react";
import { Alert, DatePicker, InputNumber, Select, Switch, Typography, theme } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

// Deadline + reminder schedule, in one control used from two places.
//
// The template builder sets DEFAULTS (in days after sending, because a template
// has no send date), and the composer sets the ACTUAL deadline (an absolute
// date, because this send has one). Those are different values of the same idea,
// so the component takes the deadline as a `Dayjs | null` and lets each caller
// convert — the builder in days, the composer in dates — rather than growing a
// mode flag that changes what its props mean.
//
// The reminder offsets are the same shape in both: days since sending. That is
// not a simplification, it is what `signature_requests.reminder_days` stores and
// what `envelopes_cron_remind` compares against `sent_at`. Storing dates would
// make a schedule meaningless the moment a send slipped by a day.

/** Common schedules, offered as a starting point rather than a constraint. */
const PRESET_REMINDERS = [
    { label: "No reminders", value: "" },
    { label: "Day 3", value: "3" },
    { label: "Days 3 and 7", value: "3,7" },
    { label: "Days 3, 7 and 14", value: "3,7,14" },
];

export type EnvelopeSchedule = {
    /** Absolute deadline, or null for "never expires". */
    expiresAt: Dayjs | null;
    /** Offsets in whole days since sending, ascending and deduped. */
    reminderDays: number[];
};

type Props = {
    value: EnvelopeSchedule;
    onChange: (patch: Partial<EnvelopeSchedule>) => void;
    /**
     * Where day 0 is. The composer passes "now" so a reminder on day 3 is three
     * days from sending; the builder passes the same, because the offsets it
     * stores mean the same thing relative to a send that has not happened yet.
     */
    sentAt: Dayjs;
    /** Renders the deadline as a day count instead of a date — builder mode. */
    asDefaults?: boolean;
    /** Builder mode only: the default expiry in days, or null for none. */
    expiryDays?: number | null;
    onExpiryDaysChange?: (days: number | null) => void;
};

export const App_EnvelopeScheduleEditor = ({
    value,
    onChange,
    sentAt,
    asDefaults = false,
    expiryDays = null,
    onExpiryDaysChange,
}: Props) => {
    const { token } = theme.useToken();
    // 240px inside a near-fullscreen modal on a 360px phone leaves the
    // InputNumber's "days after sending" addon nowhere to go.
    const { isMobile } = useApp_Breakpoint();
    const controlWidth = isMobile ? "100%" : 240;

    const hasDeadline = asDefaults ? expiryDays !== null : value.expiresAt !== null;

    // `envelopes_send` rejects an offset that falls on or after the expiry,
    // because the expiry job runs first and the reminder job skips anything not
    // `in_progress` — such a reminder would never be sent. Saying so here means
    // the sender fixes it before pressing Send rather than reading a 400.
    const strandedReminders = useMemo(() => {
        const deadlineDay = asDefaults
            ? expiryDays
            : value.expiresAt
              ? value.expiresAt.diff(sentAt, "day", true)
              : null;
        if (deadlineDay === null) return [];
        return value.reminderDays.filter((days) => days >= deadlineDay);
    }, [asDefaults, expiryDays, value.expiresAt, value.reminderDays, sentAt]);

    const presetValue = value.reminderDays.join(",");

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
            <div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: token.marginXS,
                        marginBottom: token.marginXXS,
                    }}
                >
                    <Switch
                        size="small"
                        checked={hasDeadline}
                        onChange={(checked) => {
                            if (asDefaults) onExpiryDaysChange?.(checked ? 14 : null);
                            // Two weeks is the same default `SIGNER_TOKEN_TTL_HOURS`
                            // uses (336h): a deadline past the life of the link
                            // would promise a signing window the credential
                            // cannot honour.
                            else onChange({ expiresAt: checked ? sentAt.add(14, "day") : null });
                        }}
                    />
                    <Typography.Text strong>
                        {asDefaults ? "Default deadline" : "Deadline"}
                    </Typography.Text>
                </div>

                {hasDeadline &&
                    (asDefaults ? (
                        <InputNumber
                            min={1}
                            max={365}
                            precision={0}
                            value={expiryDays ?? undefined}
                            onChange={(days) => onExpiryDaysChange?.(days ?? null)}
                            addonAfter="days after sending"
                            style={{ width: controlWidth }}
                        />
                    ) : (
                        <DatePicker
                            showTime
                            value={value.expiresAt}
                            onChange={(next) => onChange({ expiresAt: next })}
                            // A deadline in the past would be picked up by the
                            // next hourly expiry tick and close the document
                            // within the hour, having emailed everyone first.
                            disabledDate={(date) => date.isBefore(sentAt, "day")}
                            style={{ width: controlWidth }}
                        />
                    ))}

                {!hasDeadline && (
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        The document stays open until it is signed, declined or voided.
                    </Typography.Text>
                )}
            </div>

            <div>
                <Typography.Text strong style={{ display: "block", marginBottom: token.marginXXS }}>
                    Reminders
                </Typography.Text>
                <Select
                    style={{ width: controlWidth }}
                    value={
                        PRESET_REMINDERS.some((p) => p.value === presetValue)
                            ? presetValue
                            : "custom"
                    }
                    onChange={(next) =>
                        onChange({
                            reminderDays:
                                next === "custom" || next === "" ? [] : next.split(",").map(Number),
                        })
                    }
                    options={
                        PRESET_REMINDERS.some((p) => p.value === presetValue)
                            ? PRESET_REMINDERS
                            : [
                                  ...PRESET_REMINDERS,
                                  { label: `Days ${presetValue}`, value: "custom" },
                              ]
                    }
                />
                <Typography.Text
                    type="secondary"
                    style={{
                        display: "block",
                        fontSize: token.fontSizeSM,
                        marginTop: token.marginXXS,
                    }}
                >
                    A reminder nudges whoever the document is waiting on. It does not issue a new
                    link — the one they already have keeps working.
                </Typography.Text>
            </div>

            {strandedReminders.length > 0 && (
                <Alert
                    type="warning"
                    showIcon
                    message="Some reminders would never be sent"
                    description={`Day ${strandedReminders.join(", ")} falls on or after the deadline. Move the deadline out or drop those reminders.`}
                />
            )}
        </div>
    );
};

/** Shared by both callers so "now" is decided in one place. */
export const utils_Envelope_ScheduleNow = () => dayjs();
