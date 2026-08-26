/**
 * The signing provider seam.
 *
 * Mirrors `_shared/storage.ts`: a type-only interface, env read lazily *inside*
 * each factory, and a dynamic `import()` so a deployment running the mock never
 * pulls a vendor SDK it has no credentials for.
 *
 * FOUR INDEPENDENT DRIVERS, NOT ONE. During development you want mock signing
 * with real OTP; in production the eKYC vendor is frequently a different company
 * from the certificate authority, and the timestamp authority is a third. One
 * monolithic `SigningProvider` would force all four to move together.
 *
 *     getSignatureDriver()   "mock" | "ceca_remote" | "hsm_local"
 *     getIdentityDriver()    "mock" | "ekyc_vendor"
 *     getOtpDriver()         "mock" | "email" | "sms_vendor"
 *     getTimestampDriver()   "mock" | "rfc3161"
 *
 * WHAT DRIVERS DO NOT DO, and this is the important part: they never touch the
 * database, never read the service-role key, and are idempotent per call. They
 * receive an already-burned, flattened PDF and return bytes plus metadata. Field
 * overlay stays in `_shared/pdfBurn.ts`; the PAdES byte manipulation stays in
 * `_shared/pades.ts`. Vendors differ only in WHO COMPUTES THE CMS, which is why
 * adding one should never mean touching PDF internals.
 *
 * Only the `mock` implementations exist today. v1.5.0 swaps in a real CeCA/TSA
 * provider behind these same signatures — the point of writing the interface now
 * is that `signing_submit` calls the seam rather than growing vendor code later.
 */

import type { PadesLevel } from "./pades.ts";

// ============================================================
// Shared shapes
// ============================================================

export type SignatureDriverName = "mock" | "ceca_remote" | "hsm_local";
export type IdentityDriverName = "mock" | "ekyc_vendor";
export type OtpDriverName = "mock" | "email" | "sms_vendor";
export type TimestampDriverName = "mock" | "rfc3161";

export type SignerIdentity = {
    name: string;
    email: string;
    /** For the reader's signature panel; never a claim about verified identity. */
    reason?: string;
    location?: string;
};

export type SignPdfArgs = {
    /**
     * Already burned and flattened. The driver signs bytes it is given and never
     * decides what the document says — that separation is what lets the same
     * signature be verified against the same digest the audit chain recorded.
     */
    pdfBytes: Uint8Array;
    signer: SignerIdentity;
    /** Best-effort target. `achievedLevel` reports what was actually produced. */
    requestedLevel?: PadesLevel;
};

export type SignPdfResult = {
    signedPdfBytes: Uint8Array;
    /** sha256 of `signedPdfBytes` — what goes on the request row and the chain. */
    signedDocumentHash: string;
    byteRange: [number, number, number, number];
    cmsDer: Uint8Array;
    certificate: {
        subject: string;
        issuer: string;
        serialNumber: string;
        notBefore: string;
        notAfter: string;
        /** True for the mock's self-signed certificate. Surfaced in the UI. */
        selfSigned: boolean;
    };
    tsa?: {
        url: string;
        genTime: string;
    };
    /** What was actually achieved, which may be below `requestedLevel`. */
    achievedLevel: PadesLevel;
    ltvStatus: "none" | "partial" | "complete";
    /** Recorded verbatim on `signatures.provider` so a mock-signed document can
     *  never be mistaken for a real one (plan risk 6). */
    provider: SignatureDriverName;
};

export type SignatureDriver = {
    name: SignatureDriverName;
    /** True when this driver produces a legally meaningful signature. */
    legallyBinding: boolean;
    signPdf(args: SignPdfArgs): Promise<SignPdfResult>;
};

export type IdentityDriver = {
    name: IdentityDriverName;
    startSession(args: {
        signerId: string;
        redirectUrl: string;
    }): Promise<{ providerSessionId: string; redirectUrl: string }>;
    /** Verdict only — never raw document images or ID numbers (plan risk 7). */
    getVerdict(providerSessionId: string): Promise<{
        status: "pending" | "approved" | "rejected";
        score?: number;
        rejectionReason?: string;
    }>;
};

export type OtpDriver = {
    name: OtpDriverName;
    /** Sends a code the CALLER generated. The driver never mints or stores one:
     *  the hash and the attempt counter belong to the database.
     *
     *  `signerName`, `organizationName` and `expiresInMinutes` were added with the
     *  first real driver (CG-031). They are on the seam rather than in the email
     *  driver's own options because a passcode has to identify itself in EVERY
     *  channel — an SMS reading "your code is 123456" with no sender and no
     *  expiry is indistinguishable from a scam, which is the one thing a
     *  passcode message cannot afford to be. */
    send(args: {
        destination: string;
        code: string;
        documentTitle: string;
        signerName: string;
        organizationName: string;
        expiresInMinutes: number;
    }): Promise<void>;
};

export type TimestampDriver = {
    name: TimestampDriverName;
    /** RFC 3161 token over a digest. `genTime` is the authority's clock, which is
     *  why `signed_at` prefers it over anything this server generates. */
    stamp(args: {
        digest: Uint8Array;
    }): Promise<{ token: Uint8Array; genTime: string; url: string }>;
};

// ============================================================
// Selection
// ============================================================
// Every driver defaults to `mock`, so a fresh deployment runs end to end with no
// vendor account — the same reasoning as STORAGE_DRIVER=local and
// EMAIL_DRIVER=console. Production must set these explicitly, and the UI shows
// which one produced any given signature.

export function getSignatureDriverName(): SignatureDriverName {
    const value = Deno.env.get("SIGNING_DRIVER");
    return value === "ceca_remote" || value === "hsm_local" ? value : "mock";
}

export function getIdentityDriverName(): IdentityDriverName {
    return Deno.env.get("IDENTITY_DRIVER") === "ekyc_vendor" ? "ekyc_vendor" : "mock";
}

/**
 * THE ONE DRIVER THAT DOES NOT DEFAULT TO `mock`, and the exception is
 * deliberate enough to be worth the asymmetry with its three neighbours.
 *
 * The rule above — "every driver defaults to mock, so a fresh deployment runs
 * end to end with no vendor account" — exists because signing, eKYC and
 * timestamping all need a vendor relationship before they can do anything. The
 * passcode driver needs none: it sends through `shared--send-email`, which has
 * its own no-vendor path (`EMAIL_DRIVER=console`) and its own allowlist. So the
 * reason for the mock default simply does not apply here.
 *
 * What DOES apply is the failure mode. `createMockOtpDriver` logs the code to
 * the server and reports success, so a deployment that left this defaulted would
 * tell every recipient "we've emailed you a code", email nobody, and refuse
 * every signature — an outage that looks like a lie, on the one mechanism whose
 * whole job is proving identity. A mock authenticator that silently passes is
 * not a safe default in the way a mock signature driver is.
 *
 * `OTP_DRIVER=mock` is still available and is what local development uses when
 * it wants the code in the console rather than in a mailbox.
 */
export function getOtpDriverName(): OtpDriverName {
    const value = Deno.env.get("OTP_DRIVER");
    if (value === "mock" || value === "sms_vendor") return value;
    return "email";
}

export function getTimestampDriverName(): TimestampDriverName {
    return Deno.env.get("TIMESTAMP_DRIVER") === "rfc3161" ? "rfc3161" : "mock";
}

/**
 * Dynamic import so the mock path never loads node-forge or a vendor SDK. The
 * driver modules are separate files for exactly this reason — a top-level import
 * would pull the crypto dependency into every function that touches this seam.
 */
export async function getSignatureDriver(): Promise<SignatureDriver> {
    const name = getSignatureDriverName();
    if (name === "mock") {
        const { createMockSignatureDriver } = await import("./signing.mock.ts");
        return createMockSignatureDriver();
    }
    throw new Error(
        `Signature driver "${name}" is not implemented yet. It lands in v1.5.0; ` +
            `unset SIGNING_DRIVER to fall back to the mock.`
    );
}

export async function getTimestampDriver(): Promise<TimestampDriver> {
    const name = getTimestampDriverName();
    if (name === "mock") {
        const { createMockTimestampDriver } = await import("./signing.mock.ts");
        return createMockTimestampDriver();
    }
    throw new Error(`Timestamp driver "${name}" is not implemented yet.`);
}

export async function getIdentityDriver(): Promise<IdentityDriver> {
    const name = getIdentityDriverName();
    if (name === "mock") {
        // [ekyc] Its own module, not `signing.mock.ts` — see that file's header.
        const { createMockIdentityDriver } = await import("./signing.identity.mock.ts");
        return createMockIdentityDriver();
    }
    // CG-033 wired the seam and the mock; the real vendor is v1.5.0, along with
    // the jurisdiction decision that has to precede choosing one.
    throw new Error(
        `Identity driver "${name}" is not implemented yet. It lands in v1.5.0; ` +
            `unset IDENTITY_DRIVER to fall back to the mock.`
    );
}

export async function getOtpDriver(): Promise<OtpDriver> {
    const name = getOtpDriverName();
    if (name === "mock") {
        const { createMockOtpDriver } = await import("./signing.mock.ts");
        return createMockOtpDriver();
    }
    // CG-031. Its own module rather than a branch in `signing.mock.ts`, for the
    // reason stated above `getSignatureDriver`: the dynamic import is what keeps
    // the mock path from loading dependencies it does not use.
    if (name === "email") {
        const { createEmailOtpDriver } = await import("./signing.email.ts");
        return createEmailOtpDriver();
    }
    throw new Error(`OTP driver "${name}" is not implemented yet. It lands in v1.2.0.`);
}
