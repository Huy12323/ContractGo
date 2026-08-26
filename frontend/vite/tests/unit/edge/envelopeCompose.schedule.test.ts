import { describe, expect, it } from "vitest";
import { resolveSchedule } from "../../../supabase/functions/_shared/envelopeCompose.ts";

/**
 * Scheduling. Every rule here guards a way a schedule can be silently useless
 * rather than loudly wrong — a reminder that never fires reads as "set" in the UI
 * forever.
 *
 * sentAt is a fixed instant, so no fake timers are needed. That is a property of
 * the signature worth preserving.
 */

const SENT_AT = new Date("2026-01-01T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const resolve = (body: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    resolveSchedule(
        body as never,
        {
            defaultExpiryDays: 14,
            defaultReminderDays: [3, 7],
            sentAt: SENT_AT,
            strict: true,
            ...over,
        } as never
    );

describe("resolveSchedule — expiry", () => {
    it("undefined takes the version default", () => {
        expect(resolve({}).expiresAt).toBe(new Date(SENT_AT.getTime() + 14 * DAY).toISOString());
    });

    it("explicit null means never — distinct from undefined", () => {
        // The three-way distinction is the point: a two-way flag could not
        // express "no deadline on this one" against a template that has a default.
        expect(resolve({ expires_at: null }).expiresAt).toBeNull();
    });

    it("a default of null or 0 yields no expiry", () => {
        expect(resolve({}, { defaultExpiryDays: null }).expiresAt).toBeNull();
        expect(resolve({}, { defaultExpiryDays: 0 }).expiresAt).toBeNull();
    });

    it("an explicit future date is used verbatim", () => {
        const future = new Date(SENT_AT.getTime() + 30 * DAY).toISOString();
        expect(resolve({ expires_at: future }).expiresAt).toBe(future);
    });

    it("throws on an unparseable date", () => {
        expect(() => resolve({ expires_at: "not-a-date" })).toThrow(/not a valid date/);
    });

    it("strict rejects a past expiry; non-strict (draft) accepts it", () => {
        // A past expiry would be picked up by the very next cron_expire tick and
        // close the document within the hour, having emailed everyone first.
        const past = new Date(SENT_AT.getTime() - DAY).toISOString();
        expect(() => resolve({ expires_at: past })).toThrow(/deadline has already passed/);
        expect(resolve({ expires_at: past }, { strict: false }).expiresAt).toBe(past);
    });

    it("strict enforces the 365-day ceiling", () => {
        const tooFar = new Date(SENT_AT.getTime() + 366 * DAY).toISOString();
        expect(() => resolve({ expires_at: tooFar })).toThrow(/more than 365 days/);
        expect(resolve({ expires_at: tooFar }, { strict: false }).expiresAt).toBe(tooFar);
    });
});

describe("resolveSchedule — reminders", () => {
    it("undefined takes the version default", () => {
        expect(resolve({}).reminderDays).toEqual([3, 7]);
    });

    it("an explicit empty list means no reminders", () => {
        expect(resolve({ reminder_days: [] }).reminderDays).toEqual([]);
    });

    it("collapses duplicates and sorts ascending", () => {
        // Duplicates would each be due at the same instant and only one of a tie
        // fires — surprising to anyone reading the column later.
        expect(resolve({ reminder_days: [7, 3, 7, 1] }).reminderDays).toEqual([1, 3, 7]);
    });

    it("rejects non-whole and non-positive offsets", () => {
        for (const bad of [0, -1, 1.5]) {
            expect(() => resolve({ reminder_days: [bad] })).toThrow(/whole numbers of days/);
        }
    });

    it("rejects a non-array", () => {
        expect(() => resolve({ reminder_days: 3 })).toThrow(/must be a list of days/);
    });

    it("strict refuses a reminder at or after the expiry", () => {
        // The expiry job runs first and the reminder job skips anything not
        // in_progress, so such a reminder never sends.
        expect(() => resolve({ reminder_days: [14] })).toThrow(/would never be sent/);
        expect(() => resolve({ reminder_days: [20] })).toThrow(/would never be sent/);
        expect(resolve({ reminder_days: [13] }).reminderDays).toEqual([13]);
    });

    it("non-strict (draft) tolerates a reminder past the expiry", () => {
        expect(resolve({ reminder_days: [20] }, { strict: false }).reminderDays).toEqual([20]);
    });

    it("has nothing to compare against when there is no expiry", () => {
        expect(resolve({ expires_at: null, reminder_days: [999] }).reminderDays).toEqual([999]);
    });
});
