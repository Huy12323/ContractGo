/**
 * Notifying the parties whose turn it is.
 *
 * This is the one place that mints a signer credential and puts it in front of a
 * human, so it is deliberately shared rather than inlined into `envelopes_send`:
 * the same three steps run when a request is first sent AND when routing
 * advances to the next order after someone signs. `signing_submit` left that
 * second case explicitly unimplemented ("Notifying the next signer is
 * `envelopes_remind`/`envelopes_send`'s job (Phase H)"); this module is what it
 * was waiting for, and Phase H wires both call sites to it.
 *
 * THE TOKEN EXISTS IN PLAINTEXT EXACTLY ONCE — as the return value of
 * `signer_token_issue`, on its way into the mail body. It is never logged, never
 * returned to the composer's browser, and never written anywhere: the database
 * holds only its sha256 (CG-005). That is why a resend cannot re-surface an old
 * link and must issue a new one, and why `signer_token_issue` revokes the
 * previous live token for the same signer as it goes.
 *
 * Failures are per-signer and non-fatal. A send that reaches three of four
 * recipients is a send with one delivery to retry, not a send to roll back — the
 * request is already in flight and the audit chain records exactly who was
 * reached. The caller gets the per-signer outcome and decides what to tell the
 * user.
 */

import type { SupabaseClient } from "supabase";
import type { Rpc_SignerTokenIssue } from "./rpcRows.ts";
import {
    type AuditEvidence,
    recipientSnapshot,
    resolveUserIdentity,
    systemEvidence,
} from "./auditEvidence.ts";
import type { NotifyHints } from "./notify.ts";

function requireEnv(name: string): string {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

/**
 * Where the signer's browser lands. Defaults to `APP_URL` because in every
 * deployment so far the signer portal is the same origin as the app — the
 * separate variable exists so it can be split later (a different host, or a
 * bare-domain portal) without touching this code.
 */
export function getSignerPortalUrl(): string {
    return Deno.env.get("SIGNER_PORTAL_URL") || requireEnv("APP_URL");
}

/** Two weeks. Long enough that a signer on holiday does not need a resend. */
const DEFAULT_TOKEN_TTL_HOURS = 336;

export function getTokenTtlHours(): number {
    const raw = Deno.env.get("SIGNER_TOKEN_TTL_HOURS");
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOKEN_TTL_HOURS;
}

export type NotifyTarget = {
    id: string;
    signer_email: string;
    signer_name: string;
    /** Carried so the chain entry can identify the recipient by more than email. */
    signer_phone: string | null;
    signer_order: number;
};

/**
 * When a CC observer is told about a document.
 *
 * `completed` is the default and the one that matters: the artifact worth
 * observing is the finished one, and a copy sent at send time is a copy of
 * something that may never be signed. `sent` exists because some senders want
 * their counsel to see a contract go out, and it is composer state rather than a
 * stored column — nothing downstream needs to remember the choice once the mail
 * has left.
 */
export type CcNotifyStage = "sent" | "completed";

export type NotifyOutcome = {
    signer_id: string;
    signer_email: string;
    notified: boolean;
    /** Server-side detail. Never surfaced to an external caller verbatim. */
    error?: string;
};

/**
 * Issues an access token for one signer, emails them the link, flips them to
 * `notified`, and appends `signer_notified` to the hash chain.
 *
 * Order matters. The token is minted first (without it there is nothing to
 * send), the mail goes second, and the status flip is LAST — so a signer marked
 * `notified` is a signer whose mail actually left. The inverse ordering would
 * make the status a claim rather than a record, and `envelopes_remind` would
 * then skip exactly the people who never got their link.
 */
async function notifyOneSigner(args: {
    admin: SupabaseClient;
    signer: NotifyTarget;
    requestId: string;
    organizationId: string;
    organizationName: string;
    documentTitle: string;
    actorUserId: string | null;
    /**
     * The performer's identity and authentication, as `resolveSender` captured
     * it. Passed through rather than re-derived so a sender-triggered
     * notification names the person with the session facts from the call they
     * actually made (CG-016). Absent on the automatic paths.
     */
    actorEvidence?: AuditEvidence;
    /**
     * What acted when no human did — `envelopes_cron_remind`, or the routing
     * advance after a signature. "The system" is a real answer to "who sent
     * this"; an empty actor is not.
     */
    systemTask?: string;
}): Promise<NotifyOutcome> {
    const { admin, signer, requestId, organizationId, organizationName, documentTitle } = args;

    const { data: issued, error: issueError } = await admin
        .rpc("signer_token_issue", {
            p_signer_id: signer.id,
            p_purpose: "sign",
            p_ttl_hours: getTokenTtlHours(),
        })
        .maybeSingle<Rpc_SignerTokenIssue>();

    if (issueError || !issued?.token) {
        console.error(`signer_token_issue failed for ${signer.id}:`, issueError);
        return {
            signer_id: signer.id,
            signer_email: signer.signer_email,
            notified: false,
            error: issueError?.message ?? "Token issue returned no row",
        };
    }

    // `signer_token_issued` records that a credential now exists for this person
    // — the token id, never the token. A leaked audit log must not be a leaked
    // set of live signing links.
    await appendEvent(admin, {
        requestId,
        organizationId,
        signerId: signer.id,
        actorUserId: args.actorUserId,
        actorEvidence: args.actorEvidence,
        systemTask: args.systemTask,
        eventType: "signer_token_issued",
        payload: {
            token_id: issued.token_id,
            expires_at: issued.expires_at,
            signer_email: signer.signer_email,
            recipient: recipientSnapshot(signer),
        },
    });

    const signingLink = `${getSignerPortalUrl().replace(/\/+$/, "")}/sign/${issued.token}`;

    const emailError = await sendSigningEmail({
        to: signer.signer_email,
        orgName: organizationName,
        documentTitle,
        signerName: signer.signer_name,
        signingLink,
        // Most signers are external and resolve to no profile, so most of these
        // mirrors are a no-op. The ones that are not — a colleague inside the
        // org asked to countersign — are exactly the people who would otherwise
        // have to go hunting for a document they are already looking at the app
        // for.
        notify: { organizationId, requestId, link: appEnvelopeLink(organizationId, requestId) },
    });

    if (emailError) {
        return {
            signer_id: signer.id,
            signer_email: signer.signer_email,
            notified: false,
            error: emailError,
        };
    }

    const { error: statusError } = await admin
        .from("signature_request_signers")
        .update({ status: "notified", notified_at: new Date().toISOString() })
        .eq("id", signer.id)
        // Only a signer who has not yet engaged moves to `notified`. A resend to
        // someone who already opened the document must not walk their status
        // backwards from `viewed` and erase that evidence.
        .eq("status", "pending");

    if (statusError) {
        console.error(`Marking ${signer.id} notified failed:`, statusError);
    }

    await appendEvent(admin, {
        requestId,
        organizationId,
        signerId: signer.id,
        actorUserId: args.actorUserId,
        actorEvidence: args.actorEvidence,
        systemTask: args.systemTask,
        eventType: "signer_notified",
        payload: {
            signer_email: signer.signer_email,
            recipient: recipientSnapshot(signer),
            signer_order: signer.signer_order,
        },
    });

    return { signer_id: signer.id, signer_email: signer.signer_email, notified: true };
}

/**
 * Notifies every signer sitting at `order` who has not yet engaged.
 *
 * Signers sharing an order sign in PARALLEL. That is a v1.1 fact rather than a
 * v1.0 one: CG-011 dropped `UNIQUE (request_id, signer_order)` in favour of
 * `UNIQUE (request_id, role_id)`, so an order is now a SET of parties, and
 * `signature_advance_after_signature` holds the request there until every one of
 * them has signed. This function was already written for a set; before CG-011
 * the set simply could never have more than one member.
 *
 * `recipient_type = 'signer'` is not redundant with the order match. CC rows sit
 * at order 0 and would be excluded by arithmetic alone, but a CC must never
 * receive a SIGNING link under any future ordering scheme — their credential is
 * `purpose = 'view'`, minted by `notifyCcRecipients` below. Stating the filter
 * makes that a property of this function rather than of the CHECK constraint.
 *
 * Sequential rather than `Promise.all`: each iteration mints a credential and
 * hits the mail provider, and `signature_audit_append` takes `FOR UPDATE` on the
 * chain's tail row, so concurrency here buys contention rather than speed.
 */
export async function notifySignersAtOrder(args: {
    admin: SupabaseClient;
    requestId: string;
    organizationId: string;
    organizationName: string;
    documentTitle: string;
    order: number;
    actorUserId: string | null;
    /**
     * The performer's identity and authentication, as `resolveSender` captured
     * it. Passed through rather than re-derived so a sender-triggered
     * notification names the person with the session facts from the call they
     * actually made (CG-016). Absent on the automatic paths.
     */
    actorEvidence?: AuditEvidence;
    /**
     * What acted when no human did — `envelopes_cron_remind`, or the routing
     * advance after a signature. "The system" is a real answer to "who sent
     * this"; an empty actor is not.
     */
    systemTask?: string;
}): Promise<NotifyOutcome[]> {
    const { data: signers, error } = await args.admin
        .from("signature_request_signers")
        .select("id, signer_email, signer_name, signer_phone, signer_order")
        .eq("request_id", args.requestId)
        .eq("recipient_type", "signer")
        .eq("signer_order", args.order)
        .in("status", ["pending", "notified"])
        .order("created_at");

    if (error) {
        console.error("notifySignersAtOrder: could not load signers:", error);
        return [];
    }

    const outcomes: NotifyOutcome[] = [];
    for (const signer of signers ?? []) {
        outcomes.push(
            await notifyOneSigner({
                admin: args.admin,
                signer: signer as NotifyTarget,
                requestId: args.requestId,
                organizationId: args.organizationId,
                organizationName: args.organizationName,
                documentTitle: args.documentTitle,
                actorUserId: args.actorUserId,
                actorEvidence: args.actorEvidence,
                systemTask: args.systemTask,
            })
        );
    }
    return outcomes;
}

/**
 * Emails the CC observers a READ-ONLY link and chains `cc_notified`.
 *
 * The credential is `purpose = 'view'`, which is not a new mechanism: CG-005
 * created the purpose enum and `signerAuth.assertCanAct` has always rejected
 * anything but `sign` with *"This link is read-only."* CC did not need the
 * read-only path invented, only issued.
 *
 * Nothing about a CC can take a turn, and that is structural rather than
 * conventional. CG-011 pins a `cc` row to `signer_order = 0` and forbids it a
 * `role_id`, while `signature_requests.current_order` is `>= 1` — so
 * `signature_claim_turn`'s `r.current_order = s.signer_order` cannot match a CC
 * row even if a future code path asked it to. With no `role_id`, no field in the
 * snapshot resolves as theirs, so `signing_session_open` renders every box
 * locked without a special case.
 *
 * Never throws, and reports per-observer outcomes like `notifySignersAtOrder`: a
 * copy that failed to send is a delivery to retry, never a reason to fail the
 * completion or the send that triggered it.
 */
export async function notifyCcRecipients(args: {
    admin: SupabaseClient;
    requestId: string;
    organizationId: string;
    organizationName: string;
    documentTitle: string;
    stage: CcNotifyStage;
    actorUserId: string | null;
    /**
     * The performer's identity and authentication, as `resolveSender` captured
     * it. Passed through rather than re-derived so a sender-triggered
     * notification names the person with the session facts from the call they
     * actually made (CG-016). Absent on the automatic paths.
     */
    actorEvidence?: AuditEvidence;
    /**
     * What acted when no human did — `envelopes_cron_remind`, or the routing
     * advance after a signature. "The system" is a real answer to "who sent
     * this"; an empty actor is not.
     */
    systemTask?: string;
    /** Restrict to specific cc rows. Omit to notify every observer. */
    ccSignerIds?: string[];
}): Promise<NotifyOutcome[]> {
    let query = args.admin
        .from("signature_request_signers")
        .select("id, signer_email, signer_name, signer_phone, signer_order")
        .eq("request_id", args.requestId)
        .eq("recipient_type", "cc")
        .order("created_at");

    if (args.ccSignerIds) {
        if (args.ccSignerIds.length === 0) return [];
        query = query.in("id", args.ccSignerIds);
    }

    const { data: observers, error } = await query;

    if (error) {
        console.error("notifyCcRecipients: could not load observers:", error);
        return [];
    }

    const outcomes: NotifyOutcome[] = [];
    for (const observer of observers ?? []) {
        outcomes.push(
            await notifyOneCcRecipient({
                admin: args.admin,
                observer: observer as NotifyTarget,
                requestId: args.requestId,
                organizationId: args.organizationId,
                organizationName: args.organizationName,
                documentTitle: args.documentTitle,
                stage: args.stage,
                actorUserId: args.actorUserId,
                actorEvidence: args.actorEvidence,
                systemTask: args.systemTask,
            })
        );
    }
    return outcomes;
}

async function notifyOneCcRecipient(args: {
    admin: SupabaseClient;
    observer: NotifyTarget;
    requestId: string;
    organizationId: string;
    organizationName: string;
    documentTitle: string;
    stage: CcNotifyStage;
    actorUserId: string | null;
    /**
     * The performer's identity and authentication, as `resolveSender` captured
     * it. Passed through rather than re-derived so a sender-triggered
     * notification names the person with the session facts from the call they
     * actually made (CG-016). Absent on the automatic paths.
     */
    actorEvidence?: AuditEvidence;
    /**
     * What acted when no human did — `envelopes_cron_remind`, or the routing
     * advance after a signature. "The system" is a real answer to "who sent
     * this"; an empty actor is not.
     */
    systemTask?: string;
}): Promise<NotifyOutcome> {
    const { admin, observer, requestId, organizationId, stage } = args;

    const { data: issued, error: issueError } = await admin
        .rpc("signer_token_issue", {
            p_signer_id: observer.id,
            p_purpose: "view",
            p_ttl_hours: getTokenTtlHours(),
        })
        .maybeSingle<Rpc_SignerTokenIssue>();

    if (issueError || !issued?.token) {
        console.error(`signer_token_issue (view) failed for ${observer.id}:`, issueError);
        return {
            signer_id: observer.id,
            signer_email: observer.signer_email,
            notified: false,
            error: issueError?.message ?? "Token issue returned no row",
        };
    }

    await appendEvent(admin, {
        requestId,
        organizationId,
        signerId: observer.id,
        actorUserId: args.actorUserId,
        actorEvidence: args.actorEvidence,
        systemTask: args.systemTask,
        eventType: "signer_token_issued",
        payload: {
            token_id: issued.token_id,
            expires_at: issued.expires_at,
            signer_email: observer.signer_email,
            recipient: recipientSnapshot(observer),
            purpose: "view",
        },
    });

    const documentLink = `${getSignerPortalUrl().replace(/\/+$/, "")}/sign/${issued.token}`;

    const emailError = await sendCopyEmail({
        to: observer.signer_email,
        orgName: args.organizationName,
        documentTitle: args.documentTitle,
        recipientName: observer.signer_name,
        documentLink,
        introLine:
            stage === "completed"
                ? `<strong>${args.documentTitle}</strong> has been signed by every party. You were copied on it.`
                : `<strong>${args.documentTitle}</strong> has been sent out for signature. You were copied on it.`,
        notify: {
            organizationId,
            requestId,
            link: appEnvelopeLink(organizationId, requestId),
        },
    });

    if (emailError) {
        return {
            signer_id: observer.id,
            signer_email: observer.signer_email,
            notified: false,
            error: emailError,
        };
    }

    // Same ordering discipline as `notifyOneSigner`: the status flip records
    // that mail left, so it goes last. `pending` only — a second copy at
    // completion must not walk an observer who already opened theirs backwards.
    const { error: statusError } = await admin
        .from("signature_request_signers")
        .update({ status: "notified", notified_at: new Date().toISOString() })
        .eq("id", observer.id)
        .eq("status", "pending");

    if (statusError) {
        console.error(`Marking cc ${observer.id} notified failed:`, statusError);
    }

    await appendEvent(admin, {
        requestId,
        organizationId,
        signerId: observer.id,
        actorUserId: args.actorUserId,
        actorEvidence: args.actorEvidence,
        systemTask: args.systemTask,
        eventType: "cc_notified",
        payload: {
            signer_email: observer.signer_email,
            recipient: recipientSnapshot(observer),
            stage,
        },
    });

    return { signer_id: observer.id, signer_email: observer.signer_email, notified: true };
}

/**
 * Chases the people the document is currently waiting on.
 *
 * A REMINDER IS NOT A RESEND, and the difference is a consequence of CG-005
 * rather than a stylistic choice. The plaintext token exists exactly once — as
 * `signer_token_issue`'s return value, on its way into the mail body — and the
 * database keeps only its sha256. So a reminder CANNOT reproduce the link it is
 * reminding someone about. It could only mint a second one, which is precisely
 * what the plan forbids: a signer's inbox holding several live credentials for
 * one document, each of which revoked the last.
 *
 * The reminder therefore carries NO BUTTON. It says a document is still waiting,
 * when it was sent, and when it lapses, and points the recipient back at the
 * email they already have. When that email is genuinely gone, the sender's
 * "Resend link" (`envelopes_resend`) is the act that mints a new credential and
 * kills the old one — a different act, deliberately, and the UI keeps them apart.
 *
 * Everything else mirrors `notifySignersAtOrder`: `recipient_type = 'signer'`
 * (an observer is not waited on and must never be chased), sequential rather
 * than `Promise.all` because `signature_audit_append` takes `FOR UPDATE` on the
 * chain tail, and per-signer failures that are reported rather than thrown.
 *
 * The counters are written LAST, after the mail has left, for the same reason
 * `notifyOneSigner` flips status last: `last_reminded_at` is what stops the next
 * tick firing the same offset again, and setting it before a failed send would
 * silently consume a reminder nobody received.
 */
export async function remindSignersAtOrder(args: {
    admin: SupabaseClient;
    requestId: string;
    organizationId: string;
    organizationName: string;
    documentTitle: string;
    order: number;
    sentAt: string | null;
    expiresAt: string | null;
    actorUserId: string | null;
    /**
     * The performer's identity and authentication, as `resolveSender` captured
     * it. Passed through rather than re-derived so a sender-triggered
     * notification names the person with the session facts from the call they
     * actually made (CG-016). Absent on the automatic paths.
     */
    actorEvidence?: AuditEvidence;
    /**
     * What acted when no human did — `envelopes_cron_remind`, or the routing
     * advance after a signature. "The system" is a real answer to "who sent
     * this"; an empty actor is not.
     */
    systemTask?: string;
    /** Restrict to specific signer rows. Omit to chase everyone at `order`. */
    signerIds?: string[];
}): Promise<NotifyOutcome[]> {
    let query = args.admin
        .from("signature_request_signers")
        .select("id, signer_email, signer_name, signer_phone, signer_order, reminder_count")
        .eq("request_id", args.requestId)
        .eq("recipient_type", "signer")
        .eq("signer_order", args.order)
        // `pending` is excluded on purpose: that person was never successfully
        // emailed (`notifyOneSigner` flips the status only after the mail
        // leaves), so there is no original link for a reminder to point at.
        // Chasing them would be telling someone to open something they never
        // got — the sender's Resend is the right action there.
        .in("status", ["notified", "viewed"])
        .order("created_at");

    if (args.signerIds) {
        if (args.signerIds.length === 0) return [];
        query = query.in("id", args.signerIds);
    }

    const { data: signers, error } = await query;

    if (error) {
        console.error("remindSignersAtOrder: could not load signers:", error);
        return [];
    }

    const outcomes: NotifyOutcome[] = [];
    for (const signer of signers ?? []) {
        outcomes.push(
            await remindOneSigner({
                admin: args.admin,
                signer: signer as RemindTarget,
                requestId: args.requestId,
                organizationId: args.organizationId,
                organizationName: args.organizationName,
                documentTitle: args.documentTitle,
                sentAt: args.sentAt,
                expiresAt: args.expiresAt,
                actorUserId: args.actorUserId,
                actorEvidence: args.actorEvidence,
                systemTask: args.systemTask,
            })
        );
    }
    return outcomes;
}

type RemindTarget = NotifyTarget & { reminder_count: number };

async function remindOneSigner(args: {
    admin: SupabaseClient;
    signer: RemindTarget;
    requestId: string;
    organizationId: string;
    organizationName: string;
    documentTitle: string;
    sentAt: string | null;
    expiresAt: string | null;
    actorUserId: string | null;
    /**
     * The performer's identity and authentication, as `resolveSender` captured
     * it. Passed through rather than re-derived so a sender-triggered
     * notification names the person with the session facts from the call they
     * actually made (CG-016). Absent on the automatic paths.
     */
    actorEvidence?: AuditEvidence;
    /**
     * What acted when no human did — `envelopes_cron_remind`, or the routing
     * advance after a signature. "The system" is a real answer to "who sent
     * this"; an empty actor is not.
     */
    systemTask?: string;
}): Promise<NotifyOutcome> {
    const { admin, signer, requestId, organizationId } = args;

    const emailError = await sendEmail(
        "signature_request_reminder",
        signer.signer_email,
        {
            orgName: args.organizationName,
            documentTitle: args.documentTitle,
            signerName: signer.signer_name,
            sentOn: args.sentAt ? formatUtcDate(args.sentAt) : "recently",
            // Interpolated to empty rather than omitted: `shared--send-email`
            // replaces an unknown placeholder with "", so an absent deadline renders
            // as nothing at all instead of the literal `{{deadlineLine}}`.
            deadlineLine: args.expiresAt
                ? `This document stops accepting signatures on ${formatUtcDate(args.expiresAt)}.`
                : "",
        },
        {
            organizationId,
            requestId,
            link: appEnvelopeLink(organizationId, requestId),
        }
    );

    if (emailError) {
        return {
            signer_id: signer.id,
            signer_email: signer.signer_email,
            notified: false,
            error: emailError,
        };
    }

    const remindedAt = new Date().toISOString();
    const { error: counterError } = await admin
        .from("signature_request_signers")
        .update({
            last_reminded_at: remindedAt,
            reminder_count: signer.reminder_count + 1,
        })
        .eq("id", signer.id)
        // Guarded on the same states the SELECT filtered on, because the mail
        // round trip is long enough for the person to have signed or declined in
        // the meantime. Writing the counters onto a signer who has since acted
        // would leave a `last_reminded_at` later than their `signed_at`.
        .in("status", ["notified", "viewed"]);

    if (counterError) {
        console.error(`Recording the reminder for ${signer.id} failed:`, counterError);
    }

    await appendEvent(admin, {
        requestId,
        organizationId,
        signerId: signer.id,
        actorUserId: args.actorUserId,
        actorEvidence: args.actorEvidence,
        systemTask: args.systemTask,
        eventType: "signer_reminded",
        payload: {
            signer_email: signer.signer_email,
            recipient: recipientSnapshot(signer),
            signer_order: signer.signer_order,
            reminder_number: signer.reminder_count + 1,
        },
    });

    return { signer_id: signer.id, signer_email: signer.signer_email, notified: true };
}

/**
 * Tells ONE signer their turn has been sent back, and gives them a link that
 * works again.
 *
 * A FRESH CREDENTIAL IS REQUIRED HERE, and that is the difference between this
 * and a reminder. `signing_submit` calls `signer_token_consume` on the way out,
 * so a signer who has signed holds a SPENT token — there is no live link for a
 * nudge to point at, and telling them to re-open the email they already have
 * would be pointing them at a 401. Reminders can refuse to mint (CG-005: the
 * plaintext exists exactly once, so a reminder cannot reproduce a link); this
 * cannot, because the link it would reproduce is deliberately dead.
 *
 * THE STATUS IS NOT TOUCHED. `notifyOneSigner` flips `pending` → `notified`;
 * this leaves the signer in `changes_requested`, which is the state carrying the
 * sender's reason and the state `signature_claim_turn` was widened to accept
 * (CG-014). Flipping to `notified` would erase from the sender's list the fact
 * that this turn is a second attempt.
 *
 * The reason is quoted verbatim for the same reason a decline's is: it is hashed
 * into the `sender_requested_changes` chain entry, and mail that paraphrases what
 * the chain recorded makes the two disagree.
 *
 * Never throws — reports its outcome like every other notifier here. By the time
 * this runs the turn is already sent back and on the chain; a mail failure is a
 * delivery for the sender to retry with Resend, not a reason to un-send it.
 */
export async function notifySignerOfChangesRequested(args: {
    admin: SupabaseClient;
    signer: NotifyTarget;
    requestId: string;
    organizationId: string;
    organizationName: string;
    documentTitle: string;
    reason: string;
    actorUserId: string | null;
    /**
     * The performer's identity and authentication, as `resolveSender` captured
     * it. Passed through rather than re-derived so a sender-triggered
     * notification names the person with the session facts from the call they
     * actually made (CG-016). Absent on the automatic paths.
     */
    actorEvidence?: AuditEvidence;
    /**
     * What acted when no human did — `envelopes_cron_remind`, or the routing
     * advance after a signature. "The system" is a real answer to "who sent
     * this"; an empty actor is not.
     */
    systemTask?: string;
}): Promise<NotifyOutcome> {
    const { admin, signer, requestId, organizationId } = args;

    const { data: issued, error: issueError } = await admin
        .rpc("signer_token_issue", {
            p_signer_id: signer.id,
            p_purpose: "sign",
            p_ttl_hours: getTokenTtlHours(),
        })
        .maybeSingle<Rpc_SignerTokenIssue>();

    if (issueError || !issued?.token) {
        console.error(`signer_token_issue (re-sign) failed for ${signer.id}:`, issueError);
        return {
            signer_id: signer.id,
            signer_email: signer.signer_email,
            notified: false,
            error: issueError?.message ?? "Token issue returned no row",
        };
    }

    await appendEvent(admin, {
        requestId,
        organizationId,
        signerId: signer.id,
        actorUserId: args.actorUserId,
        actorEvidence: args.actorEvidence,
        systemTask: args.systemTask,
        eventType: "signer_token_issued",
        payload: {
            token_id: issued.token_id,
            expires_at: issued.expires_at,
            signer_email: signer.signer_email,
            recipient: recipientSnapshot(signer),
            purpose: "sign",
            cause: "changes_requested",
        },
    });

    const signingLink = `${getSignerPortalUrl().replace(/\/+$/, "")}/sign/${issued.token}`;

    const emailError = await sendEmail(
        "signature_request_changes_requested",
        signer.signer_email,
        {
            orgName: args.organizationName,
            documentTitle: args.documentTitle,
            signerName: signer.signer_name,
            changesReason: args.reason,
            signingLink,
        },
        {
            organizationId,
            requestId,
            link: appEnvelopeLink(organizationId, requestId),
        }
    );

    if (emailError) {
        return {
            signer_id: signer.id,
            signer_email: signer.signer_email,
            notified: false,
            error: emailError,
        };
    }

    await appendEvent(admin, {
        requestId,
        organizationId,
        signerId: signer.id,
        actorUserId: args.actorUserId,
        actorEvidence: args.actorEvidence,
        systemTask: args.systemTask,
        eventType: "signer_notified",
        payload: {
            signer_email: signer.signer_email,
            recipient: recipientSnapshot(signer),
            signer_order: signer.signer_order,
            // A `signer_notified` entry that does not say WHY reads as a first
            // invitation, and "how many times was this person asked" is one of
            // the questions the chain exists to answer.
            cause: "changes_requested",
        },
    });

    return { signer_id: signer.id, signer_email: signer.signer_email, notified: true };
}

/**
 * Tells the SENDER their document stopped.
 *
 * The direction is the opposite of everything else in this module: no token is
 * minted, because the sender is a real `auth.users` row who signs in and reads
 * the envelope through RLS. All this needs is their address, which is on
 * `profiles` via `signature_requests.created_by`.
 *
 * Never throws, for the same reason as the rest of the module — by the time this
 * runs the decline is recorded, the tokens are revoked and the chain entry is
 * written. A mail failure is a notification to retry, not a reason to tell the
 * signer their decline failed and invite them to click it again.
 *
 * @returns null on success, a server-side detail string on failure.
 */
export async function notifySenderOfDecline(args: {
    admin: SupabaseClient;
    requestId: string;
    organizationId: string;
    documentTitle: string;
    createdBy: string | null;
    signerName: string;
    signerEmail: string;
    reason: string;
}): Promise<string | null> {
    const sender = await resolveSenderEmail(args.admin, args.createdBy);
    if (typeof sender !== "string") return sender.error;

    return await sendEmail(
        "signature_request_declined",
        sender,
        {
            documentTitle: args.documentTitle,
            signerName: args.signerName,
            signerEmail: args.signerEmail,
            declineReason: args.reason,
            envelopeLink: envelopeLink(args.organizationId, args.requestId),
        },
        {
            organizationId: args.organizationId,
            requestId: args.requestId,
            link: appEnvelopeLink(args.organizationId, args.requestId),
        }
    );
}

/**
 * Tells the SENDER their document ran out of time.
 *
 * The second consumer of the resolve-sender path, which is why that path became
 * a helper: expiry is the one terminal state NOBODY chose. A decline was an act,
 * a void was an act; an expiry is the absence of one, so if this mail does not
 * arrive the sender's only signal is a status they have to go looking for.
 *
 * The outstanding parties are named because that is the actionable part — the
 * sender's next move is to send it again to those specific people.
 *
 * @returns null on success, a server-side detail string on failure.
 */
export async function notifySenderOfExpiry(args: {
    admin: SupabaseClient;
    requestId: string;
    organizationId: string;
    documentTitle: string;
    createdBy: string | null;
    expiredAt: string;
    outstanding: { signer_name: string; signer_email: string }[];
}): Promise<string | null> {
    const sender = await resolveSenderEmail(args.admin, args.createdBy);
    if (typeof sender !== "string") return sender.error;

    const outstandingList = args.outstanding.length
        ? args.outstanding.map((s) => `${s.signer_name} (${s.signer_email})`).join(", ")
        : "nobody — every party had already acted";

    return await sendEmail(
        "signature_request_expired",
        sender,
        {
            documentTitle: args.documentTitle,
            expiredOn: formatUtcDate(args.expiredAt),
            outstanding: outstandingList,
            envelopeLink: envelopeLink(args.organizationId, args.requestId),
        },
        {
            organizationId: args.organizationId,
            requestId: args.requestId,
            link: appEnvelopeLink(args.organizationId, args.requestId),
        }
    );
}

// ============================================================
// Helpers
// ============================================================

/**
 * Resolves the address to tell when a document stops.
 *
 * Two callers (`notifySenderOfDecline`, `notifySenderOfExpiry`) and a third
 * coming in Phase F, all needing the same "created_by → profiles.email" hop and
 * the same never-throw contract.
 *
 * @returns the email address, or `{error}` describing why there is nobody to
 *          tell. A request sent by a user who has since been deleted is a gap in
 *          the notification, never a failure of the thing being notified about.
 */
async function resolveSenderEmail(
    admin: SupabaseClient,
    createdBy: string | null
): Promise<string | { error: string }> {
    if (!createdBy) return { error: "Request has no created_by; nobody to notify" };

    const { data: sender, error } = await admin
        .from("profiles")
        .select("email, full_name")
        .eq("id", createdBy)
        .maybeSingle();

    if (error || !sender?.email) {
        console.error("resolveSenderEmail: could not resolve the sender:", error);
        return { error: error?.message ?? "Sender profile has no email" };
    }
    return sender.email as string;
}

/** Where the sender lands from a notification — the envelope's own page. */
function envelopeLink(organizationId: string, requestId: string): string {
    return `${requireEnv("APP_URL").replace(/\/+$/, "")}/${organizationId}/envelopes/${requestId}`;
}

/**
 * The same destination, RELATIVE, for the in-app notification row (CG-018).
 *
 * A bell item is clicked inside the app, so it routes rather than navigates —
 * an absolute `APP_URL` there would send a user on staging to production if the
 * env ever drifts. It is also the reason the mirror never reuses `signingLink`:
 * that one carries a plaintext token, and the notifications table must not
 * become a store of live signing credentials (CG-005).
 */
function appEnvelopeLink(organizationId: string, requestId: string): string {
    return `/${organizationId}/envelopes/${requestId}`;
}

/**
 * Dates in mail are UTC and spelled out — `2026-08-17` reads as either the 8th
 * of the 17th month depending on the reader, and a deadline nobody can parse is
 * a deadline that gets missed.
 */
function formatUtcDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    });
}

/**
 * Appends to the hash chain. Mirrors `signerAuth.ts::logSignerEvent` for the
 * SENDER side, where the actor is a real `auth.users` row rather than a token —
 * the two cannot share one function because they disagree about who the actor is
 * and neither should have to pass a null it does not mean.
 *
 * Never throws, for the same reason: a failed audit write must not roll back a
 * dispatched email, which cannot be un-sent.
 */
async function appendEvent(
    admin: SupabaseClient,
    args: {
        requestId: string;
        organizationId: string;
        signerId: string | null;
        actorUserId: string | null;
        /**
         * The performer's identity and authentication, as `resolveSender` captured
         * it. Passed through rather than re-derived so a sender-triggered
         * notification names the person with the session facts from the call they
         * actually made (CG-016). Absent on the automatic paths.
         */
        actorEvidence?: AuditEvidence;
        /**
         * What acted when no human did — `envelopes_cron_remind`, or the routing
         * advance after a signature. "The system" is a real answer to "who sent
         * this"; an empty actor is not.
         */
        systemTask?: string;
        eventType: string;
        payload: Record<string, unknown>;
    }
): Promise<void> {
    const evidence = await resolveActorEvidence(admin, args);

    const { error } = await admin.rpc("signature_audit_append", {
        p_request_id: args.requestId,
        p_organization_id: args.organizationId,
        p_signer_id: args.signerId,
        p_actor_user_id: args.actorUserId,
        p_event_type: args.eventType,
        // Evidence last — the event's payload describes its subject, and no call
        // site gets to overwrite who performed it.
        p_payload: { ...args.payload, ...evidence },
    });
    if (error) console.error(`Audit append (${args.eventType}) failed:`, error);
}

/**
 * Who the chain will name for an entry written from this module, in order of
 * how much is known:
 *
 *   1. The sender's own captured evidence, when the action came from a call they
 *      made — the best answer, because it carries the session facts too.
 *   2. Their user id alone, resolved to a name/email/phone snapshot. This is the
 *      path `envelopes_send` took before it started passing its context through,
 *      and it stays because a caller that has only an id must still produce a
 *      named actor rather than a UUID.
 *   3. Nobody: a cron tick or the routing advance that follows a signature.
 *      Recorded as a `system` actor named after the task, which is a fact, not a
 *      placeholder — "this reminder was sent by the scheduler, not by the
 *      sender" is exactly what a recipient later disputes.
 */
async function resolveActorEvidence(
    admin: SupabaseClient,
    args: {
        actorUserId: string | null;
        actorEvidence?: AuditEvidence;
        systemTask?: string;
    }
): Promise<AuditEvidence> {
    if (args.actorEvidence) return args.actorEvidence;

    if (!args.actorUserId) {
        return systemEvidence({ task: args.systemTask ?? "envelope_automation" });
    }

    const identity = await resolveUserIdentity(admin, args.actorUserId);
    return {
        actor: {
            kind: "sender",
            user_id: args.actorUserId,
            signer_id: null,
            name: identity.name,
            email: identity.email,
            phone: identity.phone,
        },
        // `session: null` and not omitted: this path knows the act was performed
        // through an authenticated session but never saw the token, so the
        // assurance level is unrecorded rather than absent. The originating
        // entry — `request_sent`, `sender_requested_changes` — carries it.
        auth: { methods: ["app_session"], recorded: true, session: null, otp: null, ekyc: null },
        // Likewise unknown here rather than untrue. The sender's address is on the
        // entry for the call they made.
        ip: null,
        user_agent: null,
    };
}

/** Re-exported so `envelopes_send` can log its own sender-side events without
 *  duplicating the never-throw discipline above. */
export { appendEvent as logEnvelopeEvent };

/**
 * The one call into `shared--send-email`.
 *
 * Extracted when the third scenario arrived: three copies of the same fetch,
 * each with its own error handling, is how one of them ends up not logging its
 * failure. The scenario name and payload are the only things that actually
 * differ, and `shared--send-email` validates both against its own registry.
 *
 * Never throws — mail is best-effort everywhere in this module.
 *
 * @returns null on success, a server-side detail string on failure.
 */
async function sendEmail(
    scenario: string,
    to: string,
    payload: Record<string, unknown>,
    /**
     * CG-018. Routes the in-app mirror `shared--send-email` writes after a
     * successful send. Passed explicitly at every call site because every one of
     * them already holds these ids — recovering them by regex from
     * `payload.envelopeLink` would break the day `APP_URL` grows a path prefix.
     */
    notify?: NotifyHints
): Promise<string | null> {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    try {
        const response = await fetch(`${supabaseUrl}/functions/v1/shared--send-email`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${serviceRoleKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ scenario, to, payload, notify }),
        });

        if (!response.ok) {
            const detail = await response.text();
            console.error(`Email (${scenario}) failed:`, detail);
            return detail.slice(0, 500);
        }
        return null;
    } catch (err) {
        console.error(`Email (${scenario}) threw:`, err);
        return err instanceof Error ? err.message : String(err);
    }
}

/** @returns null on success, a server-side detail string on failure. */
async function sendSigningEmail(args: {
    to: string;
    orgName: string;
    documentTitle: string;
    signerName: string;
    signingLink: string;
    notify?: NotifyHints;
}): Promise<string | null> {
    return await sendEmail(
        "signature_request_invitation",
        args.to,
        {
            orgName: args.orgName,
            documentTitle: args.documentTitle,
            signerName: args.signerName,
            signingLink: args.signingLink,
        },
        args.notify
    );
}

/**
 * The observer's copy. A separate scenario from `signature_request_invitation`
 * rather than the same one with different words: the call to action is "view",
 * not "sign", and telling someone their signature is requested when it is not is
 * the kind of mistake that gets a document ignored by the party who actually
 * owes one.
 *
 * @returns null on success, a server-side detail string on failure.
 */
async function sendCopyEmail(args: {
    to: string;
    orgName: string;
    documentTitle: string;
    recipientName: string;
    documentLink: string;
    introLine: string;
    notify?: NotifyHints;
}): Promise<string | null> {
    return await sendEmail(
        "signature_request_copy",
        args.to,
        {
            orgName: args.orgName,
            documentTitle: args.documentTitle,
            recipientName: args.recipientName,
            documentLink: args.documentLink,
            introLine: args.introLine,
        },
        args.notify
    );
}
