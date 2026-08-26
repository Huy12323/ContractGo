/**
 * Mock implementations of the three PDF-producing signing drivers: signature,
 * timestamp and passcode. [ekyc] The IDENTITY driver lives alone in
 * `signing.identity.mock.ts` — it shares none of this file's machinery (a
 * verdict is a string and a number, not bytes), and keeping it out means it can
 * be unit-tested without aliasing node-forge, @signpdf/* and pdf-lib, and
 * removed with an `rm` rather than a careful edit inside a working file.
 *
 * A SEPARATE MODULE so `signing.ts` can `import()` it lazily — a top-level
 * import would pull node-forge into every function that merely mentions the
 * seam, including the public signing surface where startup latency is a signer
 * staring at a spinner.
 *
 * WHAT THE MOCK SIGNATURE DRIVER ACTUALLY PRODUCES: a structurally valid
 * PAdES-B_B signature over a self-signed certificate. Adobe Reader opens it,
 * shows a signature panel, and reports "the signer's identity is unknown" —
 * which is correct and desirable. The bytes are real, the ByteRange is real, the
 * CMS is real; only the trust anchor is worthless. That is exactly the right
 * failure mode for development: everything downstream of the signature (hashes,
 * storage, verification plumbing, the reader's own parsing) is exercised for
 * real, and nobody can mistake the result for a binding signature.
 *
 * `legallyBinding: false` is carried through to `signatures.provider` and the
 * audit chain so the UI can say so out loud (plan risk 6).
 */

import { Buffer } from "node:buffer";
import forge from "node-forge";
import { sha256Bytes } from "./http.ts";
import { addSignaturePlaceholder, prepareForSigning, spliceCms } from "./pades.ts";
import type {
    OtpDriver,
    SignatureDriver,
    SignPdfArgs,
    SignPdfResult,
    TimestampDriver,
} from "./signing.ts";

// ============================================================
// Self-signed credential
// ============================================================

/**
 * Generated ONCE per isolate and reused.
 *
 * RSA-2048 keygen costs hundreds of milliseconds; doing it per signature would
 * put that on the signer's submit. It also means every document signed by one
 * warm isolate shares a certificate, which is *more* honest than a fresh
 * identity per signature — a real credential belongs to a person, not to a
 * request.
 *
 * The key never leaves memory and never persists. A restart produces a new one,
 * and that is fine: nothing verifies these signatures against a trust store.
 */
let cachedCredential: {
    privateKey: forge.pki.rsa.PrivateKey;
    certificate: forge.pki.Certificate;
} | null = null;

/** Says what this is in the field a reader displays most prominently. */
const MOCK_CERT_COMMON_NAME = "ContractGo Development (NOT FOR LEGAL USE)";

function getMockCredential() {
    if (cachedCredential) return cachedCredential;

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

    // Someone opening a mock-signed PDF should learn the truth from the
    // signature panel itself, not from our UI.
    const attrs = [
        { name: "commonName", value: MOCK_CERT_COMMON_NAME },
        { name: "organizationName", value: "ContractGo" },
        { shortName: "OU", value: "Mock Signing Driver" },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());

    cachedCredential = { privateKey: keys.privateKey, certificate: cert };
    return cachedCredential;
}

// ============================================================
// Signature driver
// ============================================================

export function createMockSignatureDriver(): SignatureDriver {
    return {
        name: "mock",
        legallyBinding: false,

        async signPdf(args: SignPdfArgs): Promise<SignPdfResult> {
            const { privateKey, certificate } = getMockCredential();

            // 1 — reserve the /Sig dictionary and a zero-filled /Contents window.
            const withPlaceholder = addSignaturePlaceholder({
                pdfBytes: args.pdfBytes,
                appearance: {
                    name: args.signer.name,
                    reason: args.signer.reason ?? "Signed via ContractGo",
                    location: args.signer.location ?? "",
                    contactInfo: args.signer.email,
                },
            });

            // 2 — resolve the real ByteRange and the exact bytes to digest.
            const preparation = prepareForSigning(withPlaceholder);

            // 3 — detached CMS SignedData over that payload. `detached: true` is
            //     what makes it a PAdES signature rather than an enveloping one:
            //     the content lives in the PDF, not inside the CMS.
            const p7 = forge.pkcs7.createSignedData();
            p7.content = forge.util.createBuffer(
                Buffer.from(preparation.signablePayload).toString("latin1")
            );
            p7.addCertificate(certificate);
            p7.addSigner({
                key: privateKey,
                certificate,
                digestAlgorithm: forge.pki.oids.sha256,
                authenticatedAttributes: [
                    { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
                    { type: forge.pki.oids.messageDigest },
                    { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
                ],
            });
            p7.sign({ detached: true });

            const cmsDer = new Uint8Array(
                Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "latin1")
            );

            // 4 — write the DER into the reserved window.
            const signedPdfBytes = spliceCms({
                pdfWithPlaceholder: withPlaceholder,
                cmsDer,
                preparation,
            });

            return {
                signedPdfBytes,
                signedDocumentHash: await sha256Bytes(signedPdfBytes),
                byteRange: preparation.byteRange,
                cmsDer,
                certificate: {
                    subject: MOCK_CERT_COMMON_NAME,
                    // Identical to the subject — that is what self-signed means,
                    // and it is the first thing a verifier notices.
                    issuer: MOCK_CERT_COMMON_NAME,
                    serialNumber: certificate.serialNumber,
                    notBefore: certificate.validity.notBefore.toISOString(),
                    notAfter: certificate.validity.notAfter.toISOString(),
                    selfSigned: true,
                },
                // B-B, not B-T: a timestamp from an authority nobody trusts adds
                // no evidential value, so the mock does not claim a level it has
                // not earned. `getTimestampDriver()` is a separate seam precisely
                // so a real TSA can be introduced without a real CA.
                achievedLevel: "B-B",
                ltvStatus: "none",
                provider: "mock",
            };
        },
    };
}

// ============================================================
// Timestamp driver
// ============================================================

export function createMockTimestampDriver(): TimestampDriver {
    return {
        name: "mock",
        async stamp({ digest }) {
            // Deliberately NOT an RFC 3161 token — returning something that
            // parses as one would invite it being embedded and trusted. The
            // whole point of a timestamp is that a third party's clock said so,
            // and this is our clock.
            return await Promise.resolve({
                token: digest,
                genTime: new Date().toISOString(),
                url: "mock://timestamp",
            });
        },
    };
}

// ============================================================
// OTP driver
// ============================================================

export function createMockOtpDriver(): OtpDriver {
    return {
        name: "mock",
        async send({
            destination,
            code,
            documentTitle,
            signerName,
            organizationName,
            expiresInMinutes,
        }) {
            // Logged in full, like EMAIL_DRIVER=console: this driver only runs
            // where the developer is the intended recipient. It must never be
            // selected outside dev.
            console.log(
                `[otp:mock] to=${destination} (${signerName}) org="${organizationName}" ` +
                    `document="${documentTitle}" code=${code} expires_in=${expiresInMinutes}m`
            );
            await Promise.resolve();
        },
    };
}
