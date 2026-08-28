// Every word on the landing page, in one file.
//
// Copy is the part of a marketing page that changes most often and by the most
// people — a founder rewording the hero, a lawyer softening a claim about
// evidence. Keeping it here makes a wording change a one-file diff that touches
// no layout, and it makes the whole product pitch readable in one sitting
// instead of reconstructed from eight components.
//
// TYPED, not free-form objects: a section that adds a bullet without a heading,
// or an icon key that no longer exists, fails the type-check rather than
// rendering an empty card in production.
//
// English only, and no i18n library — the product has none and none should be
// added for this page.

export type Landing_Item = {
    /** Lucide icon name, resolved by the section that renders it. */
    icon: string;
    title: string;
    body: string;
};

export type Landing_Step = {
    title: string;
    body: string;
};

// ═══ HERO ═══
// The promise, then the proof, then the ask. "Try it" comes before "sign up"
// deliberately: the trial IS the pitch, and a stranger who signs a document in
// their browser has already understood the product.

export const const_Landing_Hero = {
    eyebrow: "Electronic signatures with real evidence",
    heading: "Send a contract. Get it signed. Prove it.",
    subheading:
        "ContractGo turns a PDF into a signing ceremony — identity checks, a tamper-evident audit trail and a certificate of completion for every party. Try the signing experience right now, without an account.",
    primaryCta: "Try signing — no account needed",
    secondaryCta: "See how it works",
};

export const const_Landing_TrialCard = {
    heading: "Sign a document in your browser",
    body: "Drop in a PDF, place a signature and a few fields, sign it, and download the result.",
    // Said here and again on the trial page itself. `Page_Verify` established
    // that pattern for the same reason: on a confidential contract, one
    // reassurance reads as marketing and two read as a policy.
    privacyNote: "Runs entirely in your browser. Nothing is uploaded, nothing is stored.",
    cta: "Upload a PDF",
    limitNote: "PDF, up to 10MB. Sending it to someone else needs a free account.",
};

// ═══ HOW IT WORKS ═══

export const const_Landing_HowItWorks: Landing_Step[] = [
    {
        title: "Upload and prepare",
        body: "Start from a PDF or a reusable template. Drag signature, text, date and checkbox fields onto the page, and assign each one to whoever has to fill it.",
    },
    {
        title: "Add recipients and send",
        body: "Choose who signs, in what order, and how each of them proves who they are — an email code, or a full identity check. Send it, and ContractGo takes over the chasing.",
    },
    {
        title: "They sign, everyone gets the evidence",
        body: "Each recipient signs in their browser or on their phone. When the last one finishes, every party receives the sealed PDF and a certificate of completion.",
    },
];

// ═══ EVIDENCE ═══
// The section that has to earn the word "evidence". Every claim below maps to
// something the product actually does; do not add one that does not.

export const const_Landing_Evidence: Landing_Item[] = [
    {
        icon: "ShieldCheck",
        title: "Know who signed",
        body: "Each recipient can be required to enter a one-time code sent to their own mailbox, or to pass a full identity check, before the document will open for them.",
    },
    {
        icon: "Link2",
        title: "A trail that cannot be quietly edited",
        body: "Every open, view, field entry and signature is written to a hash-chained audit log. Changing an earlier entry breaks the chain, which is the point.",
    },
    {
        icon: "FileCheck2",
        title: "A certificate for every completed document",
        body: "Who signed, when, from where, and how they proved their identity — issued automatically when the last signature lands.",
    },
    {
        icon: "Stamp",
        title: "Signed to a standard, not just flattened",
        body: "Completed documents carry a PAdES digital signature, so a PDF reader can tell you whether a single byte has changed since signing.",
    },
    {
        icon: "SearchCheck",
        title: "Verifiable by anyone you send it to",
        body: "Anyone holding the file can check it against the original — no account, and the file never leaves their browser.",
    },
    {
        icon: "Clock",
        title: "Reminders and expiry, handled",
        body: "Set a deadline and a reminder schedule once. ContractGo follows up so you are not the one sending the third polite email.",
    },
];

// ═══ USE CASES ═══

export const const_Landing_UseCases: Landing_Item[] = [
    {
        icon: "Building2",
        title: "Teams",
        body: "Shared templates, member roles and per-organization branding, so every contract that leaves your company looks and behaves the same way.",
    },
    {
        icon: "User",
        title: "Individuals",
        body: "A personal workspace from the moment you sign up. No company setup, no seat to buy — send your first document minutes after registering.",
    },
    {
        icon: "Code2",
        title: "Developers",
        body: "A REST API, signed webhooks and embeddable signing, so agreements become a step in your product rather than a detour out of it.",
    },
];

// ═══ DEVELOPERS ═══

export const const_Landing_Developers = {
    heading: "Signing as an API call",
    subheading:
        "Create an envelope, drop your users into the ceremony without leaving your app, and get told the moment it completes.",
    bullets: [
        "REST endpoints for envelopes, templates and documents, authenticated with scoped API keys",
        "Signed webhooks for every lifecycle event, with retries and a replay-safe signature",
        "Embedded signing in an iframe, with short-lived single-origin tokens",
    ],
    // Static, illustrative, and deliberately short. A real snippet with a syntax
    // highlighter is a dependency and a maintenance burden for a page nobody
    // copy-pastes from.
    snippet: `curl -X POST https://hr.aiursoftware.com/api/v1/envelopes \\
  -H "Authorization: Bearer $CONTRACTGO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "template_id": "tpl_...",
    "recipients": [
      { "role_id": "rol_signer", "email": "counterparty@example.com" }
    ]
  }'`,
};

// ═══ FINAL CTA ═══
// The boundary restated as a choice rather than a wall: try it for free, or make
// an account when you need to send it to somebody.

export const const_Landing_FinalCta = {
    heading: "Try it on a real document",
    subheading:
        "Sign something in your browser in about a minute. When you need to send it to a counterparty — with identity checks, an audit trail and a certificate — create a free account.",
    primaryCta: "Try signing free",
    secondaryCta: "Create an account to send",
};
