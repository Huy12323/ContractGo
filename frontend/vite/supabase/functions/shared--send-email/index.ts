import { mirrorEmailToNotification, type NotifyHints } from "../_shared/notify.ts";

function requireEnv(name: string): string {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// --- Delivery driver ---
//
// `resend` is the product path. `console` renders the message and logs it
// instead of sending, which is what makes the signing flow developable at all:
// an external signer's ONLY way in is the link in their email, so with no mail
// provider there is no way to reach the signer surface — the exact dead end
// `STORAGE_DRIVER=local` exists to avoid for files, applied to mail.
//
// Env is read lazily rather than at module scope, mirroring `_shared/storage.ts`:
// under `console` there are no Resend credentials to require, and requiring them
// eagerly is what made this function 500 on load in a fresh local stack.
type EmailDriverName = "resend" | "console";

function getEmailDriverName(): EmailDriverName {
    return Deno.env.get("EMAIL_DRIVER") === "console" ? "console" : "resend";
}

// --- Recipient allowlist (development) ---
//
// Resend's shared test sender `onboarding@resend.dev` delivers ONLY to the
// address owning the Resend account and 403s everyone else. Left alone, that
// 403 becomes a 502 here, which `auth_send-verification` and
// `organizations_send-invitation` treat as a hard failure — so with real
// credentials but no verified domain, signing up or inviting anyone but the
// account owner breaks outright. Being unable to mail a fictional recipient is
// expected in dev; failing the operation because of it is not.
//
// So when `EMAIL_ALLOWLIST` is set, addresses outside it are diverted to the
// console rather than attempted: the caller's flow completes, the message is
// still inspectable, and the in-app notification is still mirrored.
//
// UNSET IS THE PRODUCTION SETTING and means "no filtering" — the fail-safe
// direction. An allowlist that silently swallowed real mail in production would
// be far worse than the 502 it exists to avoid, so it can only ever be opted
// INTO, never inherited by forgetting to configure it.
function getEmailAllowlist(): string[] {
    return (Deno.env.get("EMAIL_ALLOWLIST") ?? "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

function isAllowedRecipient(to: string): boolean {
    const allowlist = getEmailAllowlist();
    return allowlist.length === 0 || allowlist.includes(to.trim().toLowerCase());
}

// --- Scenario Registry ---

// `employee_onboarding_invitation` is the v1 HR flow and retires with the
// `onboarding_invitations` table in Phase J. `signature_request_invitation` is
// its ContractGo replacement: it names a DOCUMENT and a PARTY rather than a job,
// because the recipient is not being hired — they are being asked to sign.
type EmailScenario =
    | "auth_confirmation"
    | "auth_recovery"
    // `admin_invitation` is superseded by `organization_invitation` (CG-020),
    // which carries the tier in `roleLabel` instead of baking "admin" into the
    // copy. It stays registered because notification rows already reference the
    // matching enum value and Postgres cannot drop one; nothing sends it.
    | "admin_invitation"
    | "organization_invitation"
    | "employee_onboarding_invitation"
    | "signature_request_invitation"
    | "signature_request_copy"
    | "signature_request_declined"
    | "signature_request_reminder"
    | "signature_request_expired"
    | "signature_request_changes_requested"
    // CG-031. The only scenario that carries a live credential in its body, which
    // is why it is also the only signer-facing one that is never mirrored to the
    // notification bell — see NOT_MIRRORED in _shared/notify.ts.
    | "signature_request_passcode";

interface ScenarioConfig {
    subject: string;
    template: string;
    requiredFields: string[];
}

// --- Inline Templates (Supabase edge runtime doesn't preserve non-TS files) ---

const TEMPLATE_SHELL = (title: string, body: string) =>
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${title}</title><style>body{margin:0;padding:0;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#eef2ff}.container{max-width:480px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06);border:1px solid #e8e8e8}.header{background:#6366f1;padding:32px 24px;text-align:center}.logo{width:40px;height:40px;background:rgba(255,255,255,.2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:20px;color:#fff}.header h1{color:#fff;font-size:18px;font-weight:700;margin:0;letter-spacing:.5px}.content{padding:32px 28px}.content h2{color:#1a1a1a;font-size:20px;font-weight:600;margin:0 0 12px}.content p{color:#555;font-size:15px;line-height:1.6;margin:0 0 16px}.btn{display:inline-block;padding:12px 28px;background:#6366f1;color:#fff!important;text-decoration:none!important;border-radius:6px;font-weight:600;font-size:15px}.btn-wrap{text-align:center;margin:24px 0}.divider{height:1px;background:#e8e8e8;margin:24px 0}.muted{color:#999;font-size:13px;line-height:1.5}.footer{background:#fafafa;padding:20px 28px;text-align:center;border-top:1px solid #e8e8e8}.footer p{color:#999;font-size:12px;margin:4px 0}</style></head><body><div class="container"><div class="header"><div class="logo">&#128221;</div><h1>ContractGo</h1></div><div class="content">${body}</div><div class="footer"><p>&copy; 2026 ContractGo. All rights reserved.</p></div></div></body></html>`;

const TEMPLATES: Record<EmailScenario, string> = {
    auth_confirmation: TEMPLATE_SHELL(
        "Verify your email - ContractGo",
        `<h2>Verify your email</h2><p>Hi {{name}}, thanks for signing up! Click the button below to verify your email address.</p><div class="btn-wrap"><a href="{{confirmationUrl}}" class="btn" style="color:#fff!important;text-decoration:none!important">Verify Email Address</a></div><div class="divider"></div><p class="muted">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>`
    ),
    auth_recovery: TEMPLATE_SHELL(
        "Reset your password - ContractGo",
        `<h2>Reset your password</h2><p>Hi {{name}}, we received a request to reset your password. Click the button below to choose a new one.</p><div class="btn-wrap"><a href="{{recoveryUrl}}" class="btn" style="color:#fff!important;text-decoration:none!important">Reset Password</a></div><div class="divider"></div><p class="muted">This link expires in 24 hours. If you didn't request a password reset, you can safely ignore this email.</p>`
    ),
    admin_invitation: TEMPLATE_SHELL(
        "You're invited - ContractGo",
        `<h2>You've been invited!</h2><p>You've been invited to join <strong>{{orgName}}</strong> as an admin on ContractGo.</p><div class="btn-wrap"><a href="{{invitationLink}}" class="btn" style="color:#fff!important;text-decoration:none!important">Accept Invitation</a></div><p class="muted">This invitation expires in 7 days. If you didn't expect this, you can safely ignore it.</p>`
    ),
    organization_invitation: TEMPLATE_SHELL(
        "You're invited - ContractGo",
        `<h2>You've been invited!</h2><p>{{inviterLine}}You've been invited to join <strong>{{orgName}}</strong> on ContractGo as {{roleArticle}} <strong>{{roleLabel}}</strong>.</p><div class="btn-wrap"><a href="{{invitationLink}}" class="btn" style="color:#fff!important;text-decoration:none!important">Accept Invitation</a></div><div class="divider"></div><p class="muted">Accept with this email address &mdash; the invitation is tied to it. This link expires in 7 days. If you didn't expect this, you can safely ignore it.</p>`
    ),
    employee_onboarding_invitation: TEMPLATE_SHELL(
        "Onboarding Invitation - ContractGo",
        `<h2>Welcome aboard!</h2><p><strong>{{orgName}}</strong> has invited you to complete your onboarding contract. Click the button below to review and sign your employment contract.</p><div class="btn-wrap"><a href="{{invitationLink}}" class="btn" style="color:#fff!important;text-decoration:none!important">Complete Onboarding</a></div><div class="divider"></div><p class="muted">If you weren't expecting this invitation, you can safely ignore it.</p>`
    ),
    signature_request_invitation: TEMPLATE_SHELL(
        "Signature requested - ContractGo",
        `<h2>Your signature is requested</h2><p>Hi {{signerName}}, <strong>{{orgName}}</strong> has asked you to review and sign <strong>{{documentTitle}}</strong>.</p><div class="btn-wrap"><a href="{{signingLink}}" class="btn" style="color:#fff!important;text-decoration:none!important">Review &amp; Sign</a></div><div class="divider"></div><p class="muted">This link is personal to you &mdash; please don't forward it. It expires in 14 days. If you weren't expecting this, you can safely ignore this email.</p>`
    ),
    // The CC observer's copy. The button says View, never Sign: a `view` token is
    // rejected by `assertCanAct` with "This link is read-only", and an email that
    // asked them to sign would be an email promising something the link refuses.
    signature_request_copy: TEMPLATE_SHELL(
        "A copy for your records - ContractGo",
        `<h2>A copy for your records</h2><p>Hi {{recipientName}}, {{introLine}}</p><p>You are not asked to sign it &mdash; this link opens the document read-only.</p><div class="btn-wrap"><a href="{{documentLink}}" class="btn" style="color:#fff!important;text-decoration:none!important">View Document</a></div><div class="divider"></div><p class="muted">This link is personal to you &mdash; please don't forward it. It expires in 14 days. If you weren't expecting this, you can safely ignore this email.</p>`
    ),
    // To the SENDER, not to a party. A decline ends the route for everyone, so
    // this is the only signal the sender gets that the document stopped — an
    // in-app status they have to go looking for is a route that silently stalls.
    // The reason is quoted verbatim because it is evidence: it is on the hash
    // chain in the `signer_declined` payload, and the mail must not paraphrase it.
    signature_request_declined: TEMPLATE_SHELL(
        "A document was declined - ContractGo",
        `<h2>{{signerName}} declined to sign</h2><p><strong>{{signerName}}</strong> ({{signerEmail}}) declined to sign <strong>{{documentTitle}}</strong>. The document is now closed and every signing link has been revoked &mdash; no other party can sign it.</p><p><strong>Reason given:</strong></p><p style="padding:12px 16px;background:#f5f5f5;border-left:3px solid #6366f1;border-radius:4px">{{declineReason}}</p><div class="btn-wrap"><a href="{{envelopeLink}}" class="btn" style="color:#fff!important;text-decoration:none!important">View Document</a></div><div class="divider"></div><p class="muted">To continue, send the document again &mdash; a declined request cannot be reopened.</p>`
    ),
    // THE ONE SIGNER-FACING TEMPLATE WITH NO BUTTON, and that is not an oversight.
    // The plaintext token exists exactly once, on its way into the original
    // invitation (CG-005) — the database keeps only its sha256, so a reminder
    // cannot reproduce the link. Minting a fresh one would revoke the link the
    // recipient may already have open, which is the opposite of a nudge. A dead
    // button would be worse than none, so this points back at the mail they have
    // and names the date it arrived, which is how they find it.
    signature_request_reminder: TEMPLATE_SHELL(
        "Still waiting on your signature - ContractGo",
        `<h2>A reminder</h2><p>Hi {{signerName}}, <strong>{{orgName}}</strong> is still waiting on your signature for <strong>{{documentTitle}}</strong>.</p><p>Please open the signing link from the email we sent you on {{sentOn}}. {{deadlineLine}}</p><div class="divider"></div><p class="muted">Can't find it? Ask {{orgName}} to resend the document &mdash; they can issue you a fresh link, which replaces the old one.</p>`
    ),
    // To the SENDER. Expiry is the only terminal state nobody chose: a decline was
    // an act and a void was an act, but this is the absence of one, so without
    // this mail the sender's only signal is a status they have to go looking for.
    // The outstanding parties are named because that is the actionable part.
    // CG-031. THE SECOND SIGNER-FACING TEMPLATE WITH NO BUTTON, and for a sharper
    // reason than the reminder's. A passcode mail is the exact shape phishing
    // imitates, so this one teaches the opposite habit: it contains no link at
    // all, and it tells the reader that a real ContractGo code mail never will.
    // Somebody who has learned to click the button in the passcode email is
    // somebody who will click it in the forgery.
    //
    // It also never says which document link to open, because the recipient
    // already has the document open — this code was minted by a button they just
    // pressed on the signing page.
    signature_request_passcode: TEMPLATE_SHELL(
        "Your signing code - ContractGo",
        `<h2>{{code}}</h2><p>Hi {{signerName}}, here is your code to sign <strong>{{documentTitle}}</strong> for <strong>{{orgName}}</strong>.</p><p>Enter it on the page you already have open. It expires in {{expiresInMinutes}} minutes and can be used once.</p><div class="divider"></div><p class="muted">We will never ask you for this code by phone, by reply, or through a link &mdash; a genuine ContractGo code email contains no buttons at all. If you did not just ask to sign a document, somebody else may have your signing link: ignore this email and tell {{orgName}}.</p>`
    ),
    signature_request_expired: TEMPLATE_SHELL(
        "A document expired - ContractGo",
        `<h2>{{documentTitle}} expired</h2><p><strong>{{documentTitle}}</strong> reached its deadline on {{expiredOn}} without being fully signed. It is now closed and every signing link has been revoked.</p><p><strong>Still outstanding:</strong> {{outstanding}}</p><div class="btn-wrap"><a href="{{envelopeLink}}" class="btn" style="color:#fff!important;text-decoration:none!important">View Document</a></div><div class="divider"></div><p class="muted">Signatures already made are kept and remain on the audit trail. To continue, send the document again with a new deadline.</p>`
    ),
    // Back to the SIGNER, and the one signer-facing mail besides the invitation
    // that carries a live link. It has to: `signing_submit` consumed their previous
    // token when they signed, so unlike a reminder there is no existing link to
    // point them at — see `notifySignerOfChangesRequested`.
    //
    // The reason is quoted verbatim and given the same visual treatment as a
    // decline reason, because it plays the same role in the opposite direction: it
    // is hashed into the `sender_requested_changes` chain entry, and it is the only
    // thing telling the signer what to do differently. It says their earlier
    // signature is on record but no longer counts, because a signer who thinks they
    // already signed will not sign again.
    signature_request_changes_requested: TEMPLATE_SHELL(
        "Changes requested - ContractGo",
        `<h2>{{orgName}} has asked for changes</h2><p>Hi {{signerName}}, you signed <strong>{{documentTitle}}</strong>, but {{orgName}} has asked you to look at it again before it can be completed.</p><p><strong>What they asked for:</strong></p><p style="padding:12px 16px;background:#f5f5f5;border-left:3px solid #6366f1;border-radius:4px">{{changesReason}}</p><div class="btn-wrap"><a href="{{signingLink}}" class="btn" style="color:#fff!important;text-decoration:none!important">Review &amp; Sign Again</a></div><div class="divider"></div><p class="muted">Your earlier signature is kept on the document's audit trail but no longer counts &mdash; the document is not complete until you sign again. This is a NEW link and replaces any earlier one; it expires in 14 days.</p>`
    ),
};

const SCENARIOS: Record<EmailScenario, ScenarioConfig> = {
    auth_confirmation: {
        subject: "Verify your email - ContractGo",
        template: TEMPLATES.auth_confirmation,
        requiredFields: ["name", "confirmationUrl"],
    },
    auth_recovery: {
        subject: "Reset your password - ContractGo",
        template: TEMPLATES.auth_recovery,
        requiredFields: ["name", "recoveryUrl"],
    },
    admin_invitation: {
        subject: "You're invited to join {{orgName}} on ContractGo",
        template: TEMPLATES.admin_invitation,
        requiredFields: ["orgName", "invitationLink"],
    },
    organization_invitation: {
        subject: "You're invited to join {{orgName}} on ContractGo",
        template: TEMPLATES.organization_invitation,
        // `inviterLine` and `roleArticle` are NOT required: an unknown placeholder
        // renders as an empty string, and the sentence reads correctly without
        // either. The caller supplies them when it can name the inviter.
        requiredFields: ["orgName", "roleLabel", "invitationLink"],
    },
    employee_onboarding_invitation: {
        subject: "Onboarding invitation from {{orgName}} - ContractGo",
        template: TEMPLATES.employee_onboarding_invitation,
        requiredFields: ["orgName", "invitationLink"],
    },
    signature_request_invitation: {
        subject: "{{orgName}} requests your signature on {{documentTitle}}",
        template: TEMPLATES.signature_request_invitation,
        requiredFields: ["orgName", "documentTitle", "signerName", "signingLink"],
    },
    signature_request_copy: {
        subject: "Copy: {{documentTitle}} from {{orgName}}",
        template: TEMPLATES.signature_request_copy,
        requiredFields: ["orgName", "documentTitle", "recipientName", "documentLink", "introLine"],
    },
    signature_request_declined: {
        subject: "Declined: {{documentTitle}}",
        template: TEMPLATES.signature_request_declined,
        requiredFields: [
            "documentTitle",
            "signerName",
            "signerEmail",
            "declineReason",
            "envelopeLink",
        ],
    },
    signature_request_reminder: {
        subject: "Reminder: {{documentTitle}} is waiting for your signature",
        template: TEMPLATES.signature_request_reminder,
        // `deadlineLine` is NOT required — a request with no expiry has nothing to
        // say there, and `interpolate` renders an absent placeholder as "".
        requiredFields: ["orgName", "documentTitle", "signerName", "sentOn"],
    },
    // The code is in the SUBJECT as well as the body. A passcode the recipient can
    // read from a notification preview without opening the mail is the difference
    // between a ten-second step and a context switch, and it discloses nothing the
    // body does not — the mail is already in their mailbox.
    signature_request_passcode: {
        subject: "{{code}} is your signing code for {{documentTitle}}",
        template: TEMPLATES.signature_request_passcode,
        requiredFields: ["orgName", "documentTitle", "signerName", "code", "expiresInMinutes"],
    },
    signature_request_expired: {
        subject: "Expired: {{documentTitle}}",
        template: TEMPLATES.signature_request_expired,
        requiredFields: ["documentTitle", "expiredOn", "outstanding", "envelopeLink"],
    },
    signature_request_changes_requested: {
        subject: "{{orgName}} asked for changes to {{documentTitle}}",
        template: TEMPLATES.signature_request_changes_requested,
        // `changesReason` IS required, unlike the reminder's optional `deadlineLine`:
        // the server refuses an empty reason, so an absent one here would mean the
        // mail and the audit entry disagree about what was said.
        requiredFields: ["orgName", "documentTitle", "signerName", "changesReason", "signingLink"],
    },
};

// --- Helpers ---

function interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// --- Handler ---

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Auth check — service role key only
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.replace("Bearer ", "");
    if (bearerToken !== SERVICE_ROLE_KEY) {
        return jsonResponse({ error: "Unauthorized" }, 401);
    }

    try {
        // `notify` is optional and additive (CG-018): callers that do not send it
        // still mirror, they just produce a row with no org, no request and no link.
        const { scenario, to, payload, notify } = (await req.json()) as {
            scenario: string;
            to: string;
            payload: Record<string, string>;
            notify?: NotifyHints;
        };

        if (!scenario || !(scenario in SCENARIOS)) {
            return jsonResponse({ error: "Invalid scenario", valid: Object.keys(SCENARIOS) }, 400);
        }

        if (!to) {
            return jsonResponse({ error: "Missing 'to' email address" }, 400);
        }

        const config = SCENARIOS[scenario as EmailScenario];

        const missing = config.requiredFields.filter((f) => !payload?.[f]);
        if (missing.length > 0) {
            return jsonResponse({ error: "Missing payload fields", missing }, 400);
        }

        const html = interpolate(config.template, payload);
        const subject = interpolate(config.subject, payload);

        // CG-018. Runs only on a path that has already succeeded, and is never
        // observable in the response: the mail HAS left, and surfacing a mirror
        // failure as a non-200 would invite the caller to send it a second time.
        // `mirrorEmailToNotification` does not throw; the try/catch is belt and
        // braces for the import itself.
        const mirrorNotification = async () => {
            try {
                await mirrorEmailToNotification(scenario, to, payload, notify);
            } catch (err) {
                console.error("shared--send-email: notification mirror failed:", err);
            }
        };

        // The links are logged in full and deliberately so — both paths that reach
        // here only run where the developer is already the intended recipient. This
        // must never happen in staging or production, where the same log line would
        // be a live signing credential in a log aggregator.
        const logToConsole = (reason: "console" | "filtered") =>
            console.log(
                `[email:${reason}] to=${to} scenario=${scenario}\n` +
                    `  subject: ${subject}\n` +
                    Object.entries(payload)
                        .map(([key, value]) => `  ${key}: ${value}`)
                        .join("\n")
            );

        if (getEmailDriverName() === "console") {
            logToConsole("console");
            // Mirrored on the console path too, for the same reason the console driver
            // exists at all: without it the in-app inbox is undevelopable locally.
            await mirrorNotification();
            return jsonResponse({ id: `console_${scenario}`, status: "logged" }, 200);
        }

        // Driver is `resend`, but this recipient is outside the allowlist. 200 with a
        // DISTINCT status rather than an error: the caller's operation genuinely
        // succeeded — the invitation row exists, the token was minted — and the only
        // thing that did not happen is delivery to an address this environment was
        // never able to reach. `status` is what tells the two apart.
        if (!isAllowedRecipient(to)) {
            logToConsole("filtered");
            console.warn(
                `[email:filtered] ${to} is not in EMAIL_ALLOWLIST — logged instead of sent.`
            );
            await mirrorNotification();
            return jsonResponse({ id: `filtered_${scenario}`, status: "filtered" }, 200);
        }

        const resendRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: `${requireEnv("RESEND_SENDER_NAME")} <${requireEnv("RESEND_SENDER_EMAIL")}>`,
                to: [to],
                subject,
                html,
            }),
        });

        if (!resendRes.ok) {
            const resendError = await resendRes.text();
            console.error("Resend error:", resendError);
            return jsonResponse({ error: "Email delivery failed", details: resendError }, 502);
        }

        const resendData = await resendRes.json();
        await mirrorNotification();
        return jsonResponse({ id: resendData.id, status: "sent" }, 200);
    } catch (err) {
        console.error("shared--send-email error:", err);
        return jsonResponse(
            {
                error: err instanceof Error ? err.message : "Internal error",
            },
            500
        );
    }
});
