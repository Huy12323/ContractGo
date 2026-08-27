#!/usr/bin/env node
/**
 * seed-demo-contractgo.js — build a demo dataset by DRIVING THE REAL APP.
 *
 * WHY NOT SQL. Almost every interesting column on `signature_requests` is
 * derived, not chosen: `source_pdf_sha256` must be the true digest of the bytes
 * in storage or the signing pipeline disagrees with itself; `template_snapshot`
 * has to match the version that was pinned; signer links are hashed credentials
 * minted by `signer_token_issue`; and `signature_audit_log` is a hash CHAIN whose
 * every entry covers the previous one's `entry_hash`. Hand-written INSERTs would
 * produce rows that look right in Studio and fail the moment anything reads them.
 * So this script signs in as a real user and calls the same edge functions the
 * browser calls — the data is demo data, the path that made it is production.
 *
 * IDEMPOTENT. Every template is keyed by name inside its organization; a run that finds
 * them all present exits without writing. Safe to run twice, which is also how you
 * check it: the second run must report "nothing to do".
 *
 * PREREQUISITES — the local stack, as `pnpm dev` leaves it:
 *   - Supabase running (`pnpm sb:dev:start`) with migrations through CG-026.
 *   - Edge functions served (`pnpm dev:ef`) — this script calls eight of them.
 *   - `STORAGE_DRIVER=local`, so PDFs land in the Supabase Storage bucket `files`
 *     and no Cloudflare Worker or R2 account is needed.
 *   - Mail: the demo recipients are fictional, so under `EMAIL_DRIVER=resend`
 *     every send is a delivery FAILURE (and with the `resend.dev` test sender,
 *     a 403 for any address but the account owner's). That is harmless here —
 *     `_shared/envelopeNotify.ts` records the failure and carries on rather than
 *     throwing — so the seed completes either way; the edge-function log just
 *     fills with delivery errors. Set `EMAIL_DRIVER=console` to avoid the noise.
 *
 * Run:  node scripts/seed-demo-contractgo.js
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Passwords match `seed.sql` — one password for every local account, so there is
// one to remember rather than one per role.
const PASSWORD = "123456789";
const SENDER_EMAIL = "admin@test.com";
/** Signers need a ContractGo account on their own address: `signing_submit`
 *  matches the caller's session against `signer_email`. These two are seeded. */
const SIGNER_A = { email: "member@test.com", name: "Test Member" };
const SIGNER_B = { email: "newuser@test.com", name: "Verified No Org" };

// ============================================================
// Env
// ============================================================

const readEnvFile = (path) =>
    Object.fromEntries(
        readFileSync(path, "utf8")
            .split(/\r?\n/)
            .filter((line) => line && !line.startsWith("#") && line.includes("="))
            .map((line) => [
                line.slice(0, line.indexOf("=")).trim(),
                line.slice(line.indexOf("=") + 1).trim(),
            ])
    );

const env = readEnvFile(resolve(ROOT, "frontend/vite/.env"));
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("frontend/vite/.env is missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.");
    console.error("Run `pnpm env:apply:dev` first.");
    process.exit(1);
}

// ============================================================
// A minimal PDF writer
// ============================================================

/**
 * One page of Helvetica text, as real PDF bytes.
 *
 * Hand-rolled rather than pulled from a library because the repo has no PDF
 * fixtures and no PDF-writing dependency, and adding one to produce three pages
 * of demo text would be the tail wagging the dog. This emits the smallest
 * structure `pdf-lib` (which the burn path uses) and `pdfjs` (which the viewer
 * uses) both accept: catalog, page tree, one content stream, one base-14 font.
 *
 * The xref offsets are byte counts into the file, so the body is assembled first
 * and measured as it goes — get this wrong and the file opens nowhere.
 */
const buildPdf = (title, paragraphs) => {
    const escape = (text) => text.replace(/([\\()])/g, "\\$1");

    const lines = [
        "BT",
        "/F1 18 Tf",
        "72 770 Td",
        `(${escape(title)}) Tj`,
        "/F1 11 Tf",
        "0 -34 Td",
    ];
    for (const paragraph of paragraphs) {
        lines.push(`(${escape(paragraph)}) Tj`, "0 -18 Td");
    }
    lines.push("ET");
    const content = lines.join("\n");

    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
            "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ];

    let pdf = "%PDF-1.4\n";
    const offsets = [];
    objects.forEach((body, index) => {
        offsets.push(pdf.length);
        pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    pdf +=
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(pdf, "latin1");
};

/** A 1x1 transparent PNG. The burn path only needs decodable image bytes; what
 *  the signature LOOKS like is not what this dataset is demonstrating. */
const SIGNATURE_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ============================================================
// Template definitions
// ============================================================

const ROLE_SENDER = { id: "rol_sender", name: "Sender", order: 0, color: "#6366f1" };

const TEMPLATES = [
    {
        name: "Mutual NDA",
        title: "MUTUAL NON-DISCLOSURE AGREEMENT",
        paragraphs: [
            "This Agreement is entered into between the parties named below and governs",
            "the exchange of confidential information for the purpose of evaluating a",
            "potential business relationship.",
            "",
            "1. Each party shall keep the other's Confidential Information in confidence.",
            "2. This obligation survives termination for a period of three (3) years.",
            "3. Neither party acquires any licence under the other's intellectual property.",
        ],
        roles: [
            ROLE_SENDER,
            { id: "rol_counterparty", name: "Counterparty", order: 1, color: "#2d7a4f" },
        ],
        fields: [
            f("tfd_nda_company", "company", "Disclosing company", "text", "rol_sender", 0.1, 0.42),
            f(
                "tfd_nda_name",
                "counterparty_name",
                "Your full name",
                "text",
                "rol_counterparty",
                0.1,
                0.55
            ),
            f("tfd_nda_date", "signed_on", "Date", "date", "rol_counterparty", 0.55, 0.55),
            sig("tfd_nda_sig", "counterparty_sig", "Signature", "rol_counterparty", 0.1, 0.66),
        ],
    },
    {
        name: "Services Agreement",
        title: "PROFESSIONAL SERVICES AGREEMENT",
        paragraphs: [
            "The Supplier agrees to provide the Services described in the attached",
            "Statement of Work, and the Client agrees to pay the fees set out below.",
            "",
            "1. Fees are invoiced monthly and payable within thirty (30) days.",
            "2. Either party may terminate on sixty (60) days' written notice.",
            "3. The Supplier retains ownership of pre-existing materials.",
        ],
        roles: [
            ROLE_SENDER,
            { id: "rol_client", name: "Client", order: 1, color: "#2d7a4f" },
            { id: "rol_supplier", name: "Supplier", order: 2, color: "#b45309" },
        ],
        fields: [
            f("tfd_sa_fee", "monthly_fee", "Monthly fee", "text", "rol_sender", 0.1, 0.42),
            f("tfd_sa_client", "client_name", "Client name", "text", "rol_client", 0.1, 0.55),
            sig("tfd_sa_client_sig", "client_sig", "Client signature", "rol_client", 0.1, 0.63),
            f(
                "tfd_sa_supplier",
                "supplier_name",
                "Supplier name",
                "text",
                "rol_supplier",
                0.55,
                0.55
            ),
            sig(
                "tfd_sa_supplier_sig",
                "supplier_sig",
                "Supplier signature",
                "rol_supplier",
                0.55,
                0.63
            ),
        ],
    },
    {
        name: "Offer Letter",
        title: "OFFER OF EMPLOYMENT",
        paragraphs: [
            "We are pleased to offer you the position described below. This offer is",
            "conditional on satisfactory references and proof of right to work.",
            "",
            "Please sign and return this letter to accept.",
        ],
        roles: [
            ROLE_SENDER,
            { id: "rol_candidate", name: "Candidate", order: 1, color: "#2d7a4f" },
        ],
        fields: [
            f("tfd_ol_role", "role_title", "Position", "text", "rol_sender", 0.1, 0.42),
            f("tfd_ol_start", "start_date", "Start date", "date", "rol_sender", 0.55, 0.42),
            f(
                "tfd_ol_name",
                "candidate_name",
                "Your full name",
                "text",
                "rol_candidate",
                0.1,
                0.58
            ),
            sig("tfd_ol_sig", "candidate_sig", "Signature", "rol_candidate", 0.1, 0.68),
        ],
    },
];

/** Positioned field. Percentages are fractions of the page, matching `TemplateField`. */
function f(id, key, label, type, role_id, x_pct, y_pct) {
    return {
        id,
        key,
        label,
        type,
        role_id,
        required: true,
        page: 1,
        x_pct,
        y_pct,
        w_pct: 0.3,
        h_pct: 0.04,
    };
}
function sig(id, key, label, role_id, x_pct, y_pct) {
    return {
        id,
        key,
        label,
        type: "signature",
        role_id,
        required: true,
        page: 1,
        x_pct,
        y_pct,
        w_pct: 0.25,
        h_pct: 0.08,
    };
}

// ============================================================
// Helpers
// ============================================================

const client = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const signIn = async (email) => {
    const sb = client();
    const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
    return sb;
};

/** Edge-function errors keep their body on `context`; without unwrapping, every
 *  failure reads as a bare "Edge Function returned a non-2xx status code". */
const invoke = async (sb, name, body, headers) => {
    const { data, error } = await sb.functions.invoke(name, headers ? { body, headers } : { body });
    if (!error) return data;
    let detail = error.message;
    try {
        const parsed = await error.context?.json?.();
        if (parsed?.error) detail = parsed.error;
    } catch {
        /* keep the generic message */
    }
    throw new Error(`${name}: ${detail}`);
};

const log = (message) => console.log(message);

// ============================================================
// The burn font
// ============================================================

/**
 * Put `_shared/pdfBurn.ts`'s font in the bucket if it is not already there.
 *
 * WITHOUT THIS NO DOCUMENT CAN EVER COMPLETE, and it fails invisibly. The burn
 * embeds `_system/fonts/NotoSerif-Regular.ttf` (PDF's built-in fonts are Latin-1
 * only and a signer's name may not be), `finalizeRequest` catches everything it
 * throws, and `signing_submit` answers a perfectly ordinary `{status:"signed",
 * completed:false}` — so the last signer signs, the request quietly stays
 * `in_progress`, and the only trace is a line in the edge-function log.
 *
 * Nothing else in the repo provisions this object: the key appears in exactly one
 * file and no migration, script or doc puts bytes behind it. Presumably it was
 * uploaded to the real R2 bucket by hand once. That works until someone runs the
 * stack locally, where the `local` driver's bucket starts empty.
 *
 * Uses the service-role key rather than the sender's session: `_system/` is
 * outside every `orgs/{id}/…` prefix the storage policies are written around, and
 * it is infrastructure rather than anyone's document.
 */
const ensureBurnFont = async () => {
    const FONT_KEY = "_system/fonts/NotoSerif-Regular.ttf";
    const BUCKET = "files";

    const serviceKey = readEnvFile(
        resolve(ROOT, "frontend/vite/supabase/functions/.env")
    ).SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
        log("  ! skipping font check: no SUPABASE_SERVICE_ROLE_KEY in functions/.env");
        return;
    }
    const admin = createClient(SUPABASE_URL, serviceKey);

    const { data: found } = await admin.storage
        .from(BUCKET)
        .list("_system/fonts", { search: "NotoSerif-Regular.ttf" });
    if (found?.length) return;

    const bytes = readFileSync(resolve(ROOT, "scripts/assets/NotoSerif-Regular.ttf"));
    const { error } = await admin.storage
        .from(BUCKET)
        .upload(FONT_KEY, bytes, { contentType: "font/ttf", upsert: true });
    if (error) throw new Error(`upload burn font: ${error.message}`);
    log(`  uploaded ${FONT_KEY} (${bytes.length} bytes) — required by the PDF burn`);
};

// ============================================================
// Template creation
// ============================================================

const createTemplate = async (sb, { organizationId, userId }, spec) => {
    const pdf = buildPdf(spec.title, spec.paragraphs);

    // The row first: `files_r2_upload-start` resolves the organization from the
    // template and keys the object under `orgs/{org}/contract-templates/{id}/…`.
    //
    // `organization_id` and NOT `entity_id`, since CG-030: the entity is filled in
    // by a BEFORE INSERT trigger and is not something a client names. Naming one
    // here would still work — the trigger keeps that direction for SQL written
    // entity-first — but it would be this script demonstrating a path the app no
    // longer has.
    const { data: template, error: insertError } = await sb
        .from("contract_templates")
        .insert({
            organization_id: organizationId,
            name: spec.name,
            type: "pdf",
            layout: [],
            signer_roles: spec.roles,
        })
        .select("id")
        .single();
    if (insertError) throw new Error(`create template "${spec.name}": ${insertError.message}`);

    const presigned = await invoke(sb, "files_r2_upload-start", {
        resource_type: "contract_template_pdf",
        contract_template_id: template.id,
        file_name: `${spec.name.toLowerCase().replace(/\s+/g, "-")}.pdf`,
        content_type: "application/pdf",
        size: pdf.length,
    });

    const put = await fetch(presigned.uploadUrl, {
        method: "PUT",
        body: pdf,
        headers: { "Content-Type": "application/pdf" },
    });
    if (!put.ok) throw new Error(`upload "${spec.name}": HTTP ${put.status} ${await put.text()}`);

    const { error: fileError } = await sb.from("files").insert({
        r2_key: presigned.r2Key,
        name: `${spec.name}.pdf`,
        content_type: "application/pdf",
        size: pdf.length,
        uploaded_by: userId,
        organization_id: organizationId,
    });
    if (fileError) throw new Error(`files row "${spec.name}": ${fileError.message}`);

    // ONE update, therefore ONE version — the versioning trigger hashes layout,
    // roles, PDF path and the schedule defaults together, so splitting this would
    // mint versions for states nobody ever saw.
    const { error: updateError } = await sb
        .from("contract_templates")
        .update({
            layout: spec.fields,
            signer_roles: spec.roles,
            pdf_file_path: presigned.r2Key,
            default_expiry_days: 30,
            default_reminder_days: [3, 7],
        })
        .eq("id", template.id);
    if (updateError) throw new Error(`save layout "${spec.name}": ${updateError.message}`);

    log(`  created template "${spec.name}" (${template.id})`);
    return { id: template.id, spec };
};

// ============================================================
// Envelopes
// ============================================================

/** The sender's own fields, keyed by field id — the shape `prefilled_values` wants. */
const senderValues = (spec, values) => {
    const out = {};
    for (const field of spec.fields) {
        if (field.role_id !== "rol_sender") continue;
        out[field.id] = values[field.key] ?? "To be confirmed";
    }
    return out;
};

const recipientsFor = (spec, people) =>
    spec.roles
        .filter((role) => role.order !== 0)
        .map((role, index) => ({
            recipient_type: "signer",
            role_id: role.id,
            name: people[index % people.length].name,
            email: people[index % people.length].email,
        }));

/** Fill every field this signer owns, then sign or decline. */
const actAsSigner = async (envelopeId, signer, action) => {
    // The signer mints their OWN link, from their own session — there is no
    // sender-side way to obtain it, and that is the point: a credential that
    // speaks as the signer must never reach the sender. `signing_link_for_me`
    // checks the caller holds a session on the address the document names, which
    // is a stricter test than the emailed link makes.
    const sb = await signIn(signer.email);
    const auth = await sb.auth.getSession();
    const headers = { Authorization: `Bearer ${auth.data.session.access_token}` };

    const link = await invoke(sb, "signing_link_for_me", { request_id: envelopeId }, headers);
    // `in_app` means this party has nothing left to do (already signed, declined,
    // or the document closed) and no token is minted. Reaching it here would mean
    // the script is acting twice for one signer, so it is a bug, not a branch.
    if (link.mode !== "sign_link") {
        throw new Error(`signing_link_for_me returned ${link.mode} for ${signer.email}`);
    }
    const accessToken = new URL(link.url).pathname.split("/").pop();

    const session = await invoke(
        sb,
        "signing_session_open",
        { access_token: accessToken },
        headers
    );

    if (action === "decline") {
        await invoke(
            sb,
            "signing_decline",
            {
                access_token: accessToken,
                reason: "Our legal team has asked for changes to clause 3 before we can sign.",
            },
            headers
        );
        return "declined";
    }

    const fieldValues = {};
    for (const field of session.fields ?? []) {
        if (field.type === "signature" || field.type === "initials") continue;
        fieldValues[field.id] =
            field.type === "date" ? new Date().toISOString().slice(0, 10) : signer.name;
    }

    const result = await invoke(
        sb,
        "signing_submit",
        {
            access_token: accessToken,
            field_values: fieldValues,
            signature_base64: SIGNATURE_PNG,
            capture_method: "drawn",
            consent_accepted: true,
        },
        headers
    );

    return result.completed ? "completed" : "signed";
};

// ============================================================
// Main
// ============================================================

const main = async () => {
    log(`Connecting to ${SUPABASE_URL}`);
    const sender = await signIn(SENDER_EMAIL);
    const { data: auth } = await sender.auth.getUser();
    const userId = auth.user.id;

    const { data: orgs, error: orgError } = await sender.rpc("get_my_member_organizations");
    if (orgError) throw new Error(`get_my_member_organizations: ${orgError.message}`);

    const org = orgs.find((o) => o.name === "Northwind Legal") ?? orgs[0];
    if (!org) throw new Error(`${SENDER_EMAIL} belongs to no organization — apply seed.sql first.`);

    // No entity lookup. CG-030 made the entity something Postgres fills in from
    // the organization, so there is nothing here to resolve or to carry.
    const ctx = { organizationId: org.id, userId };
    log(`Organization: ${org.name} (${org.id})`);

    // Before anything is sent: a document that reaches its last signature without
    // this cannot burn, and reports the failure as an ordinary "signed".
    await ensureBurnFont();

    // --- Templates, skipping any that already exist -------------------------
    const { data: existing, error: existingError } = await sender
        .from("contract_templates")
        .select("id, name")
        .eq("organization_id", ctx.organizationId)
        .eq("is_ad_hoc", false)
        .eq("is_archived", false);
    if (existingError) throw new Error(`list templates: ${existingError.message}`);

    // Resolved rather than skipped: a template that already exists is REUSED, so a
    // re-run can still fill in an envelope that is missing. Skipping the whole run
    // on "templates present" would make this script useless the moment one of its
    // envelopes needed rebuilding.
    const resolved = [];
    for (const spec of TEMPLATES) {
        const found = existing.find((row) => row.name === spec.name);
        if (found) {
            log(`  template "${spec.name}" already exists (${found.id})`);
            resolved.push({ id: found.id, spec });
        } else {
            resolved.push(await createTemplate(sender, ctx, spec));
        }
    }

    const byName = (name) => resolved.find((t) => t.spec.name === name);

    // Envelopes are keyed by title for the same reason.
    const { data: existingEnvelopes, error: envelopeError } = await sender
        .from("signature_requests")
        .select("title")
        .eq("organization_id", ctx.organizationId);
    if (envelopeError) throw new Error(`list envelopes: ${envelopeError.message}`);
    const envelopeExists = (title) => existingEnvelopes.some((row) => row.title === title);

    // --- Envelopes ----------------------------------------------------------
    log("Creating envelopes…");

    /** Build one envelope unless an envelope of that title is already there. */
    const ensureEnvelope = async ({ title, template, people, values, schedule, then }) => {
        if (!template) return;
        if (envelopeExists(title)) {
            log(`  "${title}" already exists — left alone`);
            return;
        }
        const body = {
            organization_id: ctx.organizationId,
            template_id: template.id,
            title,
            recipients: recipientsFor(template.spec, people),
            prefilled_values: senderValues(template.spec, values),
            expires_at: schedule?.expiresInDays
                ? new Date(Date.now() + schedule.expiresInDays * 864e5).toISOString()
                : null,
            reminder_days: schedule?.reminderDays ?? [],
        };

        if (then === "draft") {
            await invoke(sender, "envelopes_draft_create", body);
            log(`  draft: ${title}`);
            return;
        }

        const sent = await invoke(sender, "envelopes_send", body);
        if (!then) {
            log(`  in progress: ${title} (${sent.id})`);
            return;
        }
        const outcome = await actAsSigner(sent.id, then.by, then.action);
        log(`  ${outcome}: ${title} (${sent.id})`);
    };

    const nda = byName("Mutual NDA");
    const services = byName("Services Agreement");
    const offer = byName("Offer Letter");
    const northwind = { company: "Northwind Legal" };

    // Saved, never sent.
    await ensureEnvelope({
        title: "Mutual NDA — Acme Corp (draft)",
        template: nda,
        people: [SIGNER_A],
        values: northwind,
        then: "draft",
    });

    // Sent, waiting on its signer.
    await ensureEnvelope({
        title: "Mutual NDA — Vantage Partners",
        template: nda,
        people: [SIGNER_A],
        values: northwind,
        schedule: { expiresInDays: 30, reminderDays: [3, 7] },
    });

    // Sent, then signed by its only signer — so it burns and completes.
    await ensureEnvelope({
        title: "Mutual NDA — Harbourline Ltd",
        template: nda,
        people: [SIGNER_A],
        values: northwind,
        then: { by: SIGNER_A, action: "sign" },
    });

    // Two signers in sequence: signed by the first, still waiting on the second.
    await ensureEnvelope({
        title: "Services Agreement — Kestrel Systems",
        template: services,
        people: [SIGNER_A, SIGNER_B],
        values: { monthly_fee: "$4,500" },
        schedule: { expiresInDays: 45, reminderDays: [7] },
        then: { by: SIGNER_A, action: "sign" },
    });

    // Refused.
    await ensureEnvelope({
        title: "Offer of Employment — R. Alvarez",
        template: offer,
        people: [SIGNER_B],
        values: { role_title: "Senior Counsel", start_date: "2026-10-01" },
        then: { by: SIGNER_B, action: "decline" },
    });

    log("\nDone. Sign in as admin@test.com / 123456789 to see the dataset.");
};

main().catch((err) => {
    console.error(`\nFAILED: ${err.message}`);
    process.exit(1);
});
