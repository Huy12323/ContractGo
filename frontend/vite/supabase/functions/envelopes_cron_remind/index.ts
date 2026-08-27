/**
 * envelopes_cron_remind — chase the parties a document is waiting on.
 *
 * SCHEDULED. Same shape as `envelopes_cron_expire`: no JWT, `assertCronSecret`
 * first via `serveCronFunction`, per-request failures that are logged rather
 * than thrown, and an hourly cadence that makes anything missed self-retrying.
 *
 * WHAT "DUE" MEANS. `reminder_days` is a set of offsets in days since `sent_at`
 * — `{3,7,14}` means "chase on day 3, again on day 7, again on day 14". An
 * offset is due when its moment has passed AND the person has not been reminded
 * since that moment. That second half is the whole of the idempotency: without
 * it, every hourly tick after day 3 would fire the day-3 reminder again.
 *
 * ONLY THE LATEST DUE OFFSET FIRES PER TICK. A job that was down for a week
 * comes back with three offsets overdue, and sending three identical reminders
 * in one minute is how a sender's domain gets marked as spam by the very person
 * they need a signature from. Firing the latest one and letting the earlier ones
 * fall away is correct: they said the same thing, and only the most recent is
 * still true.
 *
 * NO TOKEN IS RE-ISSUED. See `remindSignersAtOrder` — the plaintext token exists
 * exactly once (CG-005), so a reminder cannot carry a link and must not mint a
 * second one. `envelopes_resend` is the act that replaces a credential, and the
 * two are kept apart on purpose.
 */

import { jsonResponse } from "../_shared/http.ts";
import { getCronAdminClient, serveCronFunction } from "../_shared/cronAuth.ts";
import { remindSignersAtOrder } from "../_shared/envelopeNotify.ts";

const MAX_PER_RUN = 200;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type DueSigner = {
    id: string;
    last_reminded_at: string | null;
};

/**
 * The latest reminder offset that has come due for this person, as an ISO
 * instant — or null if none has.
 *
 * Offsets are read from the REQUEST and the watermark from the SIGNER, so two
 * parallel signers at the same order who were reminded at different times each
 * get their own answer. That matters as of CG-011: a batch is a set, and one of
 * them may have been added by a resend days after the other.
 */
function dueOffsetAt(
    sentAt: string,
    reminderDays: number[],
    lastRemindedAt: string | null,
    now: number
): string | null {
    const sent = new Date(sentAt).getTime();
    const watermark = lastRemindedAt ? new Date(lastRemindedAt).getTime() : 0;

    let latest: number | null = null;
    for (const days of reminderDays) {
        // A non-positive or non-finite offset would be due the instant the
        // document was sent, which is not a reminder — it is a duplicate of the
        // invitation. Ignored rather than rejected: the composer validates the
        // input, and a bad row already stored must not stall the whole job.
        if (!Number.isFinite(days) || days <= 0) continue;
        const dueAt = sent + days * MS_PER_DAY;
        if (dueAt > now) continue;
        if (dueAt <= watermark) continue;
        if (latest === null || dueAt > latest) latest = dueAt;
    }
    return latest === null ? null : new Date(latest).toISOString();
}

serveCronFunction("envelopes_cron_remind", async () => {
    const admin = getCronAdminClient();
    const nowIso = new Date().toISOString();
    const now = Date.parse(nowIso);

    const { data: requests, error } = await admin
        // ONE string literal — see `useQ_Tables_Envelopes.ts`: concatenation
        // widens the select to `string` and collapses the row type.
        .from("signature_requests")
        .select(
            "id, organization_id, title, current_order, sent_at, expires_at, reminder_days, organizations(name, timezone), signature_request_signers(id, last_reminded_at, signer_order, recipient_type, status)"
        )
        .eq("status", "in_progress")
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: true })
        .limit(MAX_PER_RUN);

    if (error) {
        console.error("envelopes_cron_remind: could not scan for requests:", error);
        return jsonResponse({ error: "Scan failed" }, 500);
    }

    let considered = 0;
    let reminded = 0;
    const failures: string[] = [];

    for (const request of requests ?? []) {
        const reminderDays = (request.reminder_days ?? []) as number[];
        if (reminderDays.length === 0) continue;
        if (!request.sent_at) continue;

        // Defence in depth rather than a necessity: `envelopes_cron_expire` runs
        // at :07 and this at :23, so a lapsed request is already `expired` by the
        // time this scan sees it. If the expiry job is down, this check is what
        // stops the reminder job cheerfully chasing people for a document that
        // has passed its deadline.
        if (request.expires_at && Date.parse(request.expires_at) <= now) continue;

        // `recipient_type = 'signer'` is not redundant with the order match. CC
        // rows sit at order 0 and `current_order` is >= 1, so arithmetic already
        // excludes them — stating it makes "an observer is never chased" a
        // property of this code rather than of a CHECK constraint elsewhere.
        const candidates: DueSigner[] = (request.signature_request_signers ?? []).filter(
            (signer: { recipient_type: string; signer_order: number; status: string }) =>
                signer.recipient_type === "signer" &&
                signer.signer_order === request.current_order &&
                (signer.status === "notified" || signer.status === "viewed")
        );

        const dueSignerIds = candidates
            .filter((signer) =>
                dueOffsetAt(request.sent_at!, reminderDays, signer.last_reminded_at, now)
            )
            .map((signer) => signer.id);

        considered += dueSignerIds.length;
        if (dueSignerIds.length === 0) continue;

        // The organization name is embedded rather than fetched per request: it
        // appears in every reminder's subject line, and a second round trip per
        // envelope would be N+1 over exactly the rows being processed.
        // The embed is many-to-one, so PostgREST returns an object here — but an
        // untyped client cannot know that and types every embed as an array, so
        // the assertion has to go through `unknown`.
        const organizationName =
            (request.organizations as unknown as { name: string } | null)?.name ?? "";
        // CG-050. Presentation only — it renders the deadline line. Read from the
        // SAME embed as the name, so it costs nothing. The pinned columns this
        // cron schedules from (`reminder_days`, `expires_at`) are untouched.
        const organizationTimezone = (
            request.organizations as unknown as { timezone?: string } | null
        )?.timezone;

        const outcomes = await remindSignersAtOrder({
            admin,
            requestId: request.id,
            organizationId: request.organization_id,
            organizationName,
            organizationTimezone,
            documentTitle: request.title,
            order: request.current_order,
            sentAt: request.sent_at,
            expiresAt: request.expires_at,
            actorUserId: null,
            // The scheduler chased them, not the sender. A recipient disputing
            // "you kept emailing me" is answered by which of the two it was.
            systemTask: "envelopes_cron_remind",
            signerIds: dueSignerIds,
        });

        for (const outcome of outcomes) {
            if (outcome.notified) reminded += 1;
            else failures.push(outcome.signer_email);
        }
    }

    // Emitted on every tick including the empty ones — `cron.job_run_details`
    // plus this line is how a silently-stopped scheduler is noticed. See the
    // deviation note in `envelopes_cron_expire` for why it is not an audit entry.
    console.log(
        `[cron:remind] scanned=${requests?.length ?? 0} due=${considered} sent=${reminded} failed=${failures.length}`
    );

    return jsonResponse(
        {
            ok: true,
            at: nowIso,
            scanned: requests?.length ?? 0,
            due: considered,
            reminded,
            failed: failures,
        },
        200
    );
});
