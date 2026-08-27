import {
    getNotifyAdminClient,
    mirrorEmailToNotification,
    type NotifyHints,
    type NotifyResult,
} from "../_shared/notify.ts";
import { getStorageDriver } from "../_shared/storage.ts";

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
    template: EmailTemplate;
    requiredFields: string[];
}

/**
 * A template is now a TITLE PLUS A BODY, not a finished document.
 *
 * ═══ WHY THIS CHANGED (CG-050) ═══
 *
 * The shell used to be applied at MODULE LOAD — `TEMPLATES` held fully rendered
 * HTML strings — which is precisely why per-organization branding could not
 * reach it: by the time a request knew which organization it was for, the
 * document had been built minutes or hours earlier and cached in the isolate.
 * Splitting title from body lets the shell be applied at REQUEST time, once the
 * brand is known.
 *
 * THE RISK IS WORTH NAMING. This moved rendering for EVERY outbound email in the
 * product, including password recovery. The unbranded path (`brand === null`)
 * must render byte-identically to what shipped before — that is the invariant to
 * check first if anything about mail looks wrong after this change.
 */
type EmailTemplate = { title: string; body: string };

// --- Inline Templates (Supabase edge runtime doesn't preserve non-TS files) ---

/**
 * Kept as the authoring call so the template table below reads unchanged. It no
 * longer renders — it just pairs a title with a body for `renderShell`.
 */
const TEMPLATE_SHELL = (title: string, body: string): EmailTemplate => ({ title, body });

/** The product's own look. What every organization is until it chooses otherwise. */
const DEFAULT_BRAND_COLOR = "#6366f1";
const DEFAULT_BRAND_BG = "#eef2ff";

type EmailBrand = {
    orgName: string;
    /** `#RRGGBB` or null for the product palette. */
    brandColor: string | null;
    /** Absolute public URL, or null for the default 📝 mark. */
    logoUrl: string | null;
    /**
     * Display name for the `from:` header, or null for the product default.
     *
     * On the brand rather than looked up separately because it is the same
     * decision as the logo and the colour — "who does this mail look like it is
     * from" — and it is loaded by the same single query.
     */
    senderName: string | null;
};

/**
 * `interpolate` escapes nothing, which is fine while every placeholder is
 * server-generated. A brand value is the first that is TENANT-CONTROLLED, so it
 * is escaped here. The database has a CHECK refusing the dangerous characters in
 * `email_sender_name` too — this is the second layer, and it covers the org NAME
 * as well, which has no such CHECK.
 */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Wraps a body in the ContractGo email chrome, branded if the organization has
 * chosen a look.
 *
 * ═══ COLOURS GO INLINE, NOT ONLY IN `<style>` ═══
 *
 * Several mail clients drop the stylesheet entirely. The `<style>` block is kept
 * because it carries layout that has always worked, but every BRAND colour is
 * also written onto the element — so a client that ignores the stylesheet
 * degrades to readable rather than to unstyled.
 *
 * ═══ THE LOGO KEEPS THE 📝 FALLBACK IN ITS `alt` ═══
 *
 * Remote images are blocked by default in a lot of clients, so `alt` is not a
 * courtesy here — it is what carries the sender's identity when the image never
 * loads. That is also why the org name is printed as text beside it rather than
 * being baked into the logo.
 */
function renderShell(template: EmailTemplate, brand: EmailBrand | null): string {
    const accent = brand?.brandColor ?? DEFAULT_BRAND_COLOR;
    const headerName = brand ? escapeHtml(brand.orgName) : "ContractGo";
    const logoUrl = brand?.logoUrl ?? null;

    const logoMark = logoUrl
        ? `<img src="${escapeHtml(logoUrl)}" alt="${headerName}" style="max-width:160px;max-height:48px;margin-bottom:12px"/>`
        : `<div class="logo" style="width:40px;height:40px;background:rgba(255,255,255,.2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:20px;color:#fff">&#128221;</div>`;

    // A branded email still says who actually operates the service — a recipient
    // who has never heard of ContractGo needs to be able to tell what they are
    // looking at, and a completely white-labelled mail from an unknown sender is
    // a phishing shape.
    const footerLine = brand
        ? `<p>Sent by ${headerName} via ContractGo.</p><p>&copy; 2026 ContractGo. All rights reserved.</p>`
        : `<p>&copy; 2026 ContractGo. All rights reserved.</p>`;

    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${template.title}</title><style>body{margin:0;padding:0;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:${DEFAULT_BRAND_BG}}.container{max-width:480px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06);border:1px solid #e8e8e8}.header{background:${accent};padding:32px 24px;text-align:center}.logo{width:40px;height:40px;background:rgba(255,255,255,.2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:20px;color:#fff}.header h1{color:#fff;font-size:18px;font-weight:700;margin:0;letter-spacing:.5px}.content{padding:32px 28px}.content h2{color:#1a1a1a;font-size:20px;font-weight:600;margin:0 0 12px}.content p{color:#555;font-size:15px;line-height:1.6;margin:0 0 16px}.btn{display:inline-block;padding:12px 28px;background:${accent};color:#fff!important;text-decoration:none!important;border-radius:6px;font-weight:600;font-size:15px}.btn-wrap{text-align:center;margin:24px 0}.divider{height:1px;background:#e8e8e8;margin:24px 0}.muted{color:#999;font-size:13px;line-height:1.5}.footer{background:#fafafa;padding:20px 28px;text-align:center;border-top:1px solid #e8e8e8}.footer p{color:#999;font-size:12px;margin:4px 0}</style></head><body style="margin:0;padding:0;background-color:${DEFAULT_BRAND_BG}"><div class="container"><div class="header" style="background:${accent};padding:32px 24px;text-align:center">${logoMark}<h1 style="color:#fff;font-size:18px;font-weight:700;margin:0;letter-spacing:.5px">${headerName}</h1></div><div class="content">${template.body}</div><div class="footer">${footerLine}</div></div></body></html>`;
}

const TEMPLATES: Record<EmailScenario, EmailTemplate> = {
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

/**
 * Scenarios that are NEVER branded, whatever `organization_id` says.
 *
 * These concern a CONTRACTGO ACCOUNT, not a tenant. They arrive before the
 * recipient has any relationship with an organization — often before they have
 * an account at all — and dressing a password-reset mail in a customer's logo
 * would be actively misleading about who is asking for the credential.
 */
const NEVER_BRANDED: ReadonlySet<EmailScenario> = new Set<EmailScenario>([
    "auth_confirmation",
    "auth_recovery",
]);

/**
 * Loads an organization's branding, or null.
 *
 * ═══ FAILURE IS SILENT AND THAT IS THE POINT ═══
 *
 * Mail here is best-effort: an UNBRANDED INVITATION BEATS AN UNSENT ONE. Every
 * failure path — no id, an id that does not resolve, a database error, a logo
 * whose `files` row has gone — returns null and the message renders in the
 * product's own look, exactly as every message did before CG-050.
 *
 * Uses the already-cached `getNotifyAdminClient()` rather than building a second
 * service-role client per request.
 */
async function loadBrand(
    scenario: EmailScenario,
    organizationId: string | undefined
): Promise<EmailBrand | null> {
    if (!organizationId || NEVER_BRANDED.has(scenario)) return null;

    try {
        const admin = getNotifyAdminClient();
        const { data, error } = await admin
            .from("organizations")
            .select(
                "name, brand_color, email_sender_name, logo_file_id, files:logo_file_id (r2_key)"
            )
            .eq("id", organizationId)
            .maybeSingle();

        if (error || !data) return null;

        const file = Array.isArray(data.files) ? data.files[0] : data.files;
        const r2Key = (file as { r2_key?: string } | null)?.r2_key ?? null;

        let logoUrl: string | null = null;
        if (r2Key) {
            // Unsigned, permanent. A signed URL cannot work in mail — the client
            // holds no credential and the message is opened weeks later — and a
            // TTL long enough to survive that is a bearer credential living in a
            // mail archive. See the CG-050 migration header.
            try {
                logoUrl = getStorageDriver().publicUrl(r2Key);
            } catch (err) {
                // A missing R2_WORKER_URL must not cost the whole email.
                console.error("shared--send-email: could not build logo URL:", err);
            }
        }

        return {
            orgName: (data.name as string) ?? "",
            brandColor: (data.brand_color as string | null) ?? null,
            logoUrl,
            senderName: (data.email_sender_name as string | null) ?? null,
        };
    } catch (err) {
        console.error("shared--send-email: branding lookup failed (non-fatal):", err);
        return null;
    }
}

/**
 * Sanitizes a tenant-chosen display name for the `from:` header.
 *
 * The database CHECK on `email_sender_name` already refuses `\r`, `\n`, `<`,
 * `>`, `"` and `,`. This strips them again anyway, because the cost of being
 * wrong is SMTP header injection and the cost of being right twice is one
 * `replace`. A value that ends up empty falls back to the configured default.
 */
function sanitizeSenderName(name: string | null | undefined): string {
    const cleaned = (name ?? "").replace(/[\r\n<>",]/g, "").trim();
    return cleaned.length > 0 ? cleaned.slice(0, 64) : requireEnv("RESEND_SENDER_NAME");
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
        const { scenario, to, payload, notify, organization_id } = (await req.json()) as {
            scenario: string;
            to: string;
            payload: Record<string, string>;
            notify?: NotifyHints;
            /**
             * CG-050. Which organization's branding to render, if any.
             *
             * A TOP-LEVEL FIELD, deliberately NOT read from `notify.organizationId`.
             * `_shared/signing.email.ts` omits the whole `notify` block for
             * `signature_request_passcode`, because a live credential must not be
             * mirrored to the notification bell. Riding branding on `notify` would
             * silently turn that mirror opt-out into a branding opt-out, and the
             * passcode mail — one of the few a signer definitely opens — would be
             * the one email that lost its sender's identity.
             */
            organization_id?: string;
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

        const brand = await loadBrand(scenario as EmailScenario, organization_id);

        const html = interpolate(renderShell(config.template, brand), payload);
        // Null brand (no org, or an account email) falls back to the configured
        // product sender name — see `sanitizeSenderName`.
        const senderName = sanitizeSenderName(brand?.senderName);
        // SUBJECTS ARE NEVER BRANDED. They already name the organization where it
        // matters ("You're invited to join {{orgName}}"), and a tenant-controlled
        // subject line is a spam-filter and phishing surface for no gain.
        const subject = interpolate(config.subject, payload);

        // CG-018. Never observable in the response on the success path: the mail
        // HAS left, and surfacing a mirror failure as a non-200 would invite the
        // caller to send it a second time. `mirrorEmailToNotification` does not
        // throw; the try/catch is belt and braces for the import itself.
        //
        // The result IS returned, because the DELIVERY FAILURE path needs it —
        // whether an in-app row exists is what decides between "undelivered but
        // the recipient can still act" and a hard 502. See `deliveryFailed`.
        const mirrorNotification = async (): Promise<NotifyResult> => {
            try {
                return await mirrorEmailToNotification(scenario, to, payload, notify);
            } catch (err) {
                console.error("shared--send-email: notification mirror failed:", err);
                return { created: false, reason: "error" };
            }
        };

        // The links are logged in full and deliberately so — the console driver
        // only runs where the developer is already the intended recipient. This
        // must never happen in staging or production, where the same log line would
        // be a live signing credential in a log aggregator.
        const logToConsole = () =>
            console.log(
                `[email:console] to=${to} scenario=${scenario}\n` +
                    `  subject: ${subject}\n` +
                    Object.entries(payload)
                        .map(([key, value]) => `  ${key}: ${value}`)
                        .join("\n")
            );

        // The recovery path for a send that did NOT happen. Losing a signing mail
        // is not losing a message: the link inside it is the recipient's only way
        // into the document, and the plaintext token exists exactly once (CG-005)
        // — so once this request returns there is nothing left anywhere that can
        // reproduce it, and the only remedy is to resend the whole document and
        // revoke the link the party may already hold.
        //
        // It prints ONLY the link-bearing fields — never the passcode, never the
        // rest of the payload — and only on a delivery that failed. That is the
        // narrowest form of the trade-off `logToConsole` documents above: yes,
        // this puts a live credential in the log aggregator on the failure path,
        // which is the price of an operator who can hand the party their link.
        const logLinksOnFailure = (reason: string) => {
            const links = Object.entries(payload ?? {}).filter(([key]) => /(Link|Url)$/.test(key));
            if (links.length === 0) return;
            console.error(
                `[email:failed] ${reason} — to=${to} scenario=${scenario}; NOT delivered:\n` +
                    links.map(([key, value]) => `  ${key}: ${value}`).join("\n")
            );
        };

        /**
         * A send that did not happen, handled the way the removed EMAIL_ALLOWLIST
         * path used to handle a recipient it could not reach.
         *
         * ═══ WHY A FAILED SEND STILL MIRRORS ═══
         *
         * The bell is the SECOND delivery channel, not a receipt for the first.
         * With the shared `onboarding@resend.dev` sender — the dev default — every
         * address but the Resend account owner's is refused, so leaving the mirror
         * on the success path alone meant a 502 and NOTHING anywhere: no mail, no
         * notification, and an invitation or reminder that vanished. Mirroring here
         * puts it back in the one place the recipient can still find it.
         *
         * ═══ WHY THE STATUS CODE THEN DEPENDS ON THE MIRROR ═══
         *
         * `auth_confirmation`, `auth_recovery` and `signature_request_passcode` are
         * deliberately NOT mirrored (see `_shared/notify.ts`): they reach someone
         * who has no bell to open, or carry a live credential. For those, mail is
         * the ONLY channel, so a failed send is a real failure and must stay a 502 —
         * `auth_send-verification` surfacing "we couldn't send your verification
         * email" is correct. When a row WAS created the operation genuinely
         * half-succeeded, so it returns 200 with a distinct `status`, exactly as the
         * old allowlist path returned `filtered`.
         */
        const deliveryFailed = async (reason: string, detail: string, status: number) => {
            logLinksOnFailure(reason);
            const mirrored = await mirrorNotification();
            if (!mirrored.created) {
                return jsonResponse({ error: "Email delivery failed", details: detail }, status);
            }
            console.warn(
                `[email:undelivered] to=${to} scenario=${scenario} — ${reason}; ` +
                    `delivered in-app as notification ${mirrored.id} instead.`
            );
            return jsonResponse(
                {
                    id: `undelivered_${scenario}`,
                    status: "undelivered",
                    notification_id: mirrored.id,
                    details: detail,
                },
                200
            );
        };

        if (getEmailDriverName() === "console") {
            logToConsole();
            // Mirrored on the console path too, for the same reason the console driver
            // exists at all: without it the in-app inbox is undevelopable locally.
            await mirrorNotification();
            return jsonResponse({ id: `console_${scenario}`, status: "logged" }, 200);
        }

        // Caught here rather than left to the outer handler so the link still
        // gets logged when the provider is unreachable or a Resend env var is
        // missing — the two failures a fresh deployment actually hits, and the
        // ones where nothing was even attempted, so nothing was delivered.
        let resendRes: Response;
        try {
            resendRes = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    // CG-050: the DISPLAY NAME is the organization's, the ADDRESS
                    // never changes. That address is the domain Resend verified,
                    // and moving it breaks SPF/DKIM — which means the mail stops
                    // arriving, not just stops looking right. A per-tenant sending
                    // domain is a separate feature with its own verification flow.
                    from: `${senderName} <${requireEnv("RESEND_SENDER_EMAIL")}>`,
                    to: [to],
                    subject,
                    html,
                }),
            });
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            console.error("Resend request threw:", err);
            return await deliveryFailed(`Resend request threw (${detail})`, detail, 502);
        }

        if (!resendRes.ok) {
            const resendError = await resendRes.text();
            console.error("Resend error:", resendError);
            return await deliveryFailed(
                `Resend rejected the message (${resendRes.status})`,
                resendError,
                502
            );
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
