/**
 * The embed bridge — CG-047, v1.4.0 Phase E.
 *
 * PURE, and imports nothing, so the whole of it is pinned by a unit test. It is
 * the piece of this feature a third party writes code against, and it is also
 * the piece where a mistake is a disclosure rather than a bug.
 *
 * ═══ THE ONE RULE ═══
 *
 *   `targetOrigin` IS NEVER `'*'`, AND AN ABSENT ORIGIN IS SILENCE.
 *
 * `postMessage(msg, '*')` delivers to whatever page happens to be framing this
 * one. On the signing surface that means the document's title and the signer's
 * progress through a legal ceremony, handed to an origin nobody registered. So
 * the bridge takes its target from the CREDENTIAL — stamped there at mint time
 * by `api_envelopes_embed-url`, chosen from the API key's allowlist — and when
 * the credential does not carry one it emits nothing at all. That is the case
 * for every emailed link, which is the overwhelming majority of ceremonies:
 * `/sign/{token}` in an ordinary tab has no parent to talk to and now says
 * nothing to anyone.
 *
 * The existing precedent in this codebase is `src/configs/auth/oauthTab.ts`,
 * which already pins `window.location.origin` rather than reaching for `'*'`.
 *
 * ═══ THE ENVELOPE SHAPE IS A PUBLIC CONTRACT ═══
 *
 * Every message carries `source: 'contractgo'` and `version: 1`. The source tag
 * is not decoration: a host page's `message` listener receives events from every
 * frame it hosts, from browser extensions, and from anything that can reach
 * `window.postMessage` — so `docs/embedding.md` tells integrators to check BOTH
 * `event.origin` and this tag before trusting a payload, and the tag is what
 * makes that instruction possible. The version is what lets a second shape exist
 * later without breaking the first.
 */

/**
 * The events a host page can receive.
 *
 *   ready      the signing surface has mounted — the host can hide its spinner
 *   loaded     the document and its fields resolved; the ceremony is usable
 *   completed  this signer signed. `completed_all` says whether that was the
 *              LAST signature the document needed, because a host that closes
 *              the frame on the first signature of a three-party contract has
 *              closed it two signatures early
 *   declined   this signer refused. Terminal for the document
 *   error      the session could not be opened or the ceremony failed
 *
 * `error` deliberately carries no server message. The host page belongs to the
 * integrator, not to the signer, and a refusal reason on the signing surface can
 * name a mailbox, a passcode state, or an identity-check verdict — none of which
 * is the framing site's business. The signer reads the reason inside the frame,
 * where the token already entitles them to it.
 */
export type Embed_EventType = "ready" | "loaded" | "completed" | "declined" | "error";

export type Embed_Message = {
    source: "contractgo";
    version: 1;
    type: Embed_EventType;
    /** Present from `loaded` onwards; absent on `ready`, which fires before the session resolves. */
    envelope_id?: string;
    signer_id?: string;
    /** `completed` only — whether this signature finished the whole document. */
    completed_all?: boolean;
};

export const EMBED_MESSAGE_SOURCE = "contractgo";
export const EMBED_MESSAGE_VERSION = 1;

/**
 * Build one message, or `null` when it must not be sent.
 *
 * Returning `null` rather than throwing is deliberate: the caller is a render
 * path in the middle of a signing ceremony, and a bridge that threw on a missing
 * origin would turn "this session is not embedded" — the normal case — into a
 * crashed signing page.
 */
export function utils_Embed_BuildMessage(
    type: Embed_EventType,
    details?: { envelopeId?: string | null; signerId?: string | null; completedAll?: boolean }
): Embed_Message {
    const message: Embed_Message = {
        source: EMBED_MESSAGE_SOURCE,
        version: EMBED_MESSAGE_VERSION,
        type,
    };
    if (details?.envelopeId) message.envelope_id = details.envelopeId;
    if (details?.signerId) message.signer_id = details.signerId;
    // Only on `completed`, and only when the caller actually knows. `undefined`
    // is dropped rather than sent as `false`: a host reading `completed_all:
    // false` would conclude more signatures are outstanding, which is a
    // different claim from "we did not determine this".
    if (type === "completed" && typeof details?.completedAll === "boolean") {
        message.completed_all = details.completedAll;
    }
    return message;
}

/**
 * Whether this page should emit at all.
 *
 * Three conditions, and all three are required:
 *   - the session carries an origin (it is an embed credential, not an emailed one)
 *   - that origin is a bare `scheme://host[:port]` — the shape
 *     `api_key_issue` stores and `_shared/embedOrigin.ts` compares
 *   - the page is actually framed
 *
 * The last one is not a security check — it is what stops a signer who opened an
 * embed URL directly in a tab from posting messages to their own window.
 */
export function utils_Embed_ShouldEmit(
    embedOrigin: string | null | undefined,
    isFramed: boolean
): boolean {
    if (!isFramed) return false;
    if (typeof embedOrigin !== "string") return false;
    const trimmed = embedOrigin.trim();
    if (!trimmed) return false;
    // `'*'` is refused EXPLICITLY, and not merely by failing the pattern below.
    // If a wildcard ever reached this column by some route nobody has thought of
    // yet, the failure must be silence rather than a broadcast.
    if (trimmed === "*") return false;
    return /^https?:\/\/[A-Za-z0-9._-]+(:[0-9]{1,5})?$/i.test(trimmed);
}

/**
 * Emit one event to the host page.
 *
 * A no-op — returning `false` — whenever `utils_Embed_ShouldEmit` says so, and a
 * no-op again if the browser refuses the send. `postMessage` throws when the
 * target origin is unparseable, and a signing ceremony must not die because a
 * host page's registration was odd.
 */
export function utils_Embed_Post(
    target: { postMessage: (message: unknown, targetOrigin: string) => void } | null,
    embedOrigin: string | null | undefined,
    isFramed: boolean,
    type: Embed_EventType,
    details?: { envelopeId?: string | null; signerId?: string | null; completedAll?: boolean }
): boolean {
    if (!target) return false;
    if (!utils_Embed_ShouldEmit(embedOrigin, isFramed)) return false;

    try {
        target.postMessage(utils_Embed_BuildMessage(type, details), (embedOrigin as string).trim());
        return true;
    } catch (err) {
        console.error("Embed bridge could not post to the host page:", err);
        return false;
    }
}
