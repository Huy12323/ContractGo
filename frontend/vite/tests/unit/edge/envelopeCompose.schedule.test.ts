import { describe, expect, it } from "vitest";
import {
    mergeScheduleDefaults,
    resolveSchedule,
} from "../../../supabase/functions/_shared/envelopeCompose.ts";

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

/**
 * CG-050. `mergeScheduleDefaults` is the rung between the template version and
 * the hard-coded fallback. `resolveSchedule` itself is deliberately unchanged —
 * these tests are about what gets HANDED to it.
 */
describe("mergeScheduleDefaults", () => {
    const version = (expiry: number | null, reminders: number[]) => ({
        default_expiry_days: expiry,
        default_reminder_days: reminders,
    });
    const org = (expiry: number | null, reminders: number[]) => ({
        default_expiry_days: expiry,
        default_reminder_days: reminders,
    });

    it("prefers the template version's expiry over the organization's", () => {
        expect(mergeScheduleDefaults(version(7, []), org(30, [])).defaultExpiryDays).toBe(7);
    });

    it("falls back to the organization when the version has no expiry", () => {
        // `default_expiry_days` is NULLABLE on the version, so a template really
        // can say "I have no opinion" — this is the rung that gives that answer
        // somewhere to go.
        expect(mergeScheduleDefaults(version(null, []), org(30, [])).defaultExpiryDays).toBe(30);
    });

    it("falls through to null when neither has an expiry", () => {
        // Null means "never expires" downstream, which is what every envelope
        // did before CG-013 and still does when nobody has chosen.
        expect(
            mergeScheduleDefaults(version(null, []), org(null, [])).defaultExpiryDays
        ).toBeNull();
    });

    it("prefers the version's reminders only when they are non-empty", () => {
        expect(
            mergeScheduleDefaults(version(null, [3]), org(null, [7])).defaultReminderDays
        ).toEqual([3]);
    });

    it("treats an empty version array as 'never configured', not 'no reminders'", () => {
        // The known limitation, pinned so it is a decision rather than a
        // surprise: `contract_template_versions.default_reminder_days` is
        // NOT NULL DEFAULT '{}', so `{}` cannot mean "explicitly none". It is
        // resolved toward inheritance; a sender still opts out per-envelope with
        // an explicit `reminder_days: []`, which outranks all of this.
        expect(
            mergeScheduleDefaults(version(null, []), org(null, [7])).defaultReminderDays
        ).toEqual([7]);
    });

    it("works with no organization at all", () => {
        // The parameter is optional so every pre-CG-050 shape still resolves.
        expect(mergeScheduleDefaults(version(5, [2]))).toEqual({
            defaultExpiryDays: 5,
            defaultReminderDays: [2],
        });
    });

    it("still lets an explicit request body outrank the merged defaults", () => {
        // The rung above. An explicit `expires_at: null` means NEVER, and must
        // not be filled in from the organization — that would make a house
        // default impossible to opt out of.
        const merged = mergeScheduleDefaults(version(null, []), org(30, [7]));
        const schedule = resolveSchedule({ expires_at: null, reminder_days: [] } as never, {
            ...merged,
            sentAt: new Date("2026-01-01T00:00:00Z"),
            strict: false,
        });
        expect(schedule.expiresAt).toBeNull();
        expect(schedule.reminderDays).toEqual([]);
    });
});
