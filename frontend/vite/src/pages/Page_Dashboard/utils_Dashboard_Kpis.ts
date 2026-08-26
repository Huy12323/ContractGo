import type { Tables_Envelopes_Record } from "@/hooks/useQ_Tables_Envelopes";

// Reporting, derived from the rows the dashboard already has in memory.
//
// `Page_Dashboard` loads every envelope with its signers in ONE query and filters
// client-side, with a header comment explaining why: a count query per tile would
// be three round trips for numbers all derivable from rows the page needs anyway.
// These metrics follow the same rule and add no query at all.
//
// PURE, and in its own file, so the arithmetic is testable without rendering —
// which matters more here than usual, because a wrong completion rate is not
// obviously wrong on screen.

export type Dashboard_Kpis = {
    /** Documents that reached a terminal state. The denominator for the rate. */
    finished: number;
    completed: number;
    declined: number;
    expired: number;
    voided: number;
    /**
     * Completed as a share of finished, 0–100, rounded. NULL when nothing has
     * finished — see `hasEnoughData`.
     */
    completionRate: number | null;
    /** MEDIAN hours from send to completion. NULL when nothing has completed. */
    medianHoursToComplete: number | null;
    /** Completed documents per month, oldest first. */
    byMonth: Array<{ month: string; completed: number }>;
    /**
     * Whether the numbers above mean anything yet.
     *
     * An organization with two finished documents can show "100% completion",
     * which is arithmetically true and tells the reader nothing except that they
     * have not used the product much. A KPI that is technically correct and
     * practically misleading is worse than an empty state saying so, because
     * somebody will quote it.
     */
    hasEnoughData: boolean;
};

/** Below this, report the counts and refuse to report the rates. */
const MIN_SAMPLE = 5;

const TERMINAL = new Set(["completed", "declined", "expired", "cancelled"]);

/**
 * MEDIAN, not mean, and this is the whole reason the function exists rather than
 * an inline `reduce`.
 *
 * Time-to-sign is exactly the distribution where a mean lies: one contract that
 * sat unsigned over a holiday drags the average into a number that describes no
 * real document. The median answers the question people actually ask — "how long
 * does this usually take" — and is unmoved by the straggler.
 */
const median = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

export const utils_Dashboard_Kpis = (envelopes: Tables_Envelopes_Record[]): Dashboard_Kpis => {
    let completed = 0;
    let declined = 0;
    let expired = 0;
    let voided = 0;
    const durations: number[] = [];
    const monthly = new Map<string, number>();

    for (const envelope of envelopes) {
        if (!TERMINAL.has(envelope.status)) continue;

        if (envelope.status === "declined") declined += 1;
        else if (envelope.status === "expired") expired += 1;
        else if (envelope.status === "cancelled") voided += 1;
        else if (envelope.status === "completed") {
            completed += 1;

            if (envelope.completed_at) {
                monthly.set(
                    envelope.completed_at.slice(0, 7),
                    (monthly.get(envelope.completed_at.slice(0, 7)) ?? 0) + 1
                );

                if (envelope.sent_at) {
                    const ms =
                        new Date(envelope.completed_at).getTime() -
                        new Date(envelope.sent_at).getTime();
                    // Negative or non-finite means the two timestamps disagree —
                    // a clock skew, or a row edited by hand. Dropping it keeps one
                    // bad row out of the median rather than letting it define it.
                    if (Number.isFinite(ms) && ms >= 0) durations.push(ms / 3_600_000);
                }
            }
        }
    }

    const finished = completed + declined + expired + voided;

    return {
        finished,
        completed,
        declined,
        expired,
        voided,
        completionRate: finished === 0 ? null : Math.round((completed / finished) * 100),
        medianHoursToComplete: median(durations),
        byMonth: [...monthly.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([month, count]) => ({ month, completed: count })),
        hasEnoughData: finished >= MIN_SAMPLE,
    };
};

/** "3h" / "2d" / "3w" — a duration someone can read at a glance. */
export const utils_Dashboard_FormatHours = (hours: number | null): string => {
    if (hours === null) return "—";
    if (hours < 1) return "under an hour";
    if (hours < 48) return `${Math.round(hours)}h`;
    const days = hours / 24;
    if (days < 14) return `${Math.round(days)}d`;
    return `${Math.round(days / 7)}w`;
};
