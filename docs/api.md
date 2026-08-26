# ContractGo API

The machine door. Everything the product does through a browser session — send a
document, read its state, fetch the finished PDF, withdraw it, open a signing
pane inside your own page — an API key can do too, under explicit scopes.

Three things to read before the endpoint list, because each of them is a decision
you cannot work around later:

1. **`Idempotency-Key` is required on `api_envelopes_create`.** A retried send is
   two contracts in a counterparty's inbox and two live signing links, and there
   is no un-send. See [Idempotency](#idempotency).
2. **Webhook delivery is at-least-once. Dedupe on `event_id`.** See
   [Deduplication is your job](#deduplication-is-your-job).
3. **Verify every webhook signature.** A signed webhook nobody verifies is an
   unsigned webhook. Copy-pasteable code is in
   [Verifying a signature](#verifying-a-signature).

---

## Base URL and shape

```
POST https://<project-ref>.supabase.co/functions/v1/<function-name>
```

Every endpoint is **POST with a JSON body**, including the reads. There is no
path routing and no `GET /v1/envelopes/{id}` — the surface is RPC-shaped, one
function per action. `OPTIONS` is answered for CORS; any other method is `405`.

Every request body carries `organization_id`. It is not redundant with the key:
the key is bound to one organization, and a mismatch is refused with the same
opaque `401` an unknown key gets, so the endpoint cannot be used to discover
which organizations exist.

## Authentication

```
Authorization: Bearer cgk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

Keys are minted in **Settings → Integrations → API keys** by an organization
admin or owner. The plaintext is shown **once, at creation** — only its SHA-256
is stored, so a lost key cannot be recovered and must be revoked and replaced.
The `cgk_` prefix plus the next eight characters are kept in the clear so the
settings page can tell you _which_ key without holding a credential.

A key carries the identity of the person who minted it for the purposes of
`created_by` and sender notifications, but the audit trail records the key
itself: entries created through this API have `actor.kind = "api_client"` and
name the key, so "a program did this, using so-and-so's authority" and "a person
pressed a button" are never confused in the evidence.

**A key dies with the person who minted it** (`ON DELETE CASCADE` from the user).
That is the intended revocation semantic when someone leaves — but it means a key
minted by a departing employee stops working the day their account is removed.
Mint long-lived integration keys from an account that will outlive the
integration.

### Scopes

| Scope              | Grants                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `member`           | Read: `api_envelopes_get`, `api_envelopes_document-url`, `api_templates_list`                        |
| `send_documents`   | Everything `member` grants, plus `api_envelopes_create`, `api_envelopes_void`, `api_envelopes_embed-url` |
| `manage_templates` | Reserved. No endpoint requires it yet.                                                               |

Scopes imply downward the same way the UI's permission model does: a key with
`send_documents` satisfies a `member` requirement without also listing `member`.

**`admin` is not grantable to a key, by schema.** Member management, ownership
transfer and organization deletion are never machine actions, and the value is
absent from the database enum rather than merely unchecked — so no key can carry
it and no future endpoint can accidentally accept one that does.

### Rate limits

Per key, per rolling window. Exceeding it returns `429` with a `Retry-After`
header in seconds. Unlike an authentication failure this refusal is explicit: by
then the caller has proved it holds a live credential, so telling it to wait
leaks nothing.

## Errors

Every failure is a JSON body with a human sentence and a **stable machine code**.
Branch on `code`, never on `error` — the prose gets improved, the code does not.

```json
{ "error": "This API key lacks the send_documents scope", "code": "insufficient_scope" }
```

| Status | `code`                                                             | Meaning                                                                                                     |
| ------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_request`                                                  | Malformed body, or a required field missing.                                                                  |
| 400    | `idempotency_key_required`                                         | `api_envelopes_create` without the header.                                                                    |
| 400    | `idempotency_key_invalid`                                          | Longer than 255 characters.                                                                                   |
| 401    | `invalid_api_key`                                                  | Unknown, revoked, expired, **or belonging to another organization** — one shape, four causes, deliberately.   |
| 403    | `insufficient_scope`                                               | Live key, wrong scopes. Names the scope it lacks.                                                             |
| 403    | `embed_not_enabled`                                                | The key has no registered embed origins. An empty list is not a wildcard.                                     |
| 403    | `origin_not_allowed`                                               | The requested origin is not on the key's allowlist.                                                           |
| 404    | `not_found`                                                        | No such document or recipient in this organization.                                                           |
| 404    | `certificate_not_issued`                                           | The document has no Certificate of Completion yet.                                                            |
| 405    | `method_not_allowed`                                               | Anything but `POST` or `OPTIONS`.                                                                             |
| 409    | `idempotency_conflict`                                             | Same key, different body.                                                                                     |
| 409    | `idempotency_in_flight`                                            | The first request with this key is still running.                                                             |
| 409    | `invalid_status`                                                   | The document's state forbids the action (already completed, already voided).                                  |
| 409    | `already_signed` / `already_declined` / `not_a_signer` / `not_their_turn` | Embed URL requested for a recipient who cannot sign right now.                                        |
| 429    | `rate_limited`                                                     | Carries `Retry-After`.                                                                                        |
| 500    | `internal_error`                                                   | Ours. Retry.                                                                                                  |

---

## Endpoints

### `api_templates_list` — start here

**Scope:** `member`

`api_envelopes_create` takes a `template_id`, one recipient per `role_id`, and
`prefilled_values` keyed by field id. All three are opaque identifiers that exist
only inside a pinned template version, so this is the endpoint that makes the
rest usable.

```json
{ "organization_id": "org_abc123", "include_archived": false }
```

```json
{
    "templates": [
        {
            "id": "ctp_abc123",
            "name": "Service Agreement",
            "entity_id": "ent_abc123",
            "is_archived": false,
            "sendable": true,
            "version_id": "ctv_abc123",
            "version_number": 4,
            "default_expiry_days": 14,
            "default_reminder_days": [3, 7],
            "roles": [
                { "id": "role_sender", "name": "Company", "order": 0, "is_sender": true },
                { "id": "role_client", "name": "Client", "order": 1, "is_sender": false }
            ],
            "fields": [
                {
                    "id": "fld_1",
                    "key": "full_name",
                    "label": "Full name",
                    "type": "text",
                    "role_id": "role_client",
                    "required": true,
                    "page": 1
                },
                {
                    "id": "fld_2",
                    "key": "fee",
                    "label": "Fee",
                    "type": "text",
                    "role_id": "role_sender",
                    "required": true,
                    "page": 1
                }
            ]
        }
    ]
}
```

Two things worth reading twice:

- **`is_sender` marks the role you fill, not one you send to.** Supplying a
  recipient for it is a `400`. Its fields are the ones that belong in
  `prefilled_values`.
- **`fields` are keyed by `id`, not `key`.** `key` legitimately repeats across
  roles — `full_name` for each party — and would collide. `prefilled_values` takes
  ids.

A template with no saved version is returned with `sendable: false` and a `reason`
rather than omitted, so a template you can see in the UI is never silently
missing here.

### `api_envelopes_create` — send a document

**Scope:** `send_documents` · **`Idempotency-Key` required**

The body is the same shape the composer posts. `envelope_id` is refused —
promoting a draft is an operation on a UI artifact.

```http
POST /functions/v1/api_envelopes_create
Authorization: Bearer cgk_...
Idempotency-Key: 8f14e45f-ea0f-4b2c-9f6b-3a1c2d4e5f60
Content-Type: application/json
```

```json
{
    "organization_id": "org_abc123",
    "template_id": "ctp_abc123",
    "title": "Service Agreement — Acme Ltd",
    "recipients": [
        {
            "role_id": "role_client",
            "recipient_type": "signer",
            "name": "Dana Reyes",
            "email": "dana@acme.example",
            "phone": "+15550100"
        },
        { "recipient_type": "cc", "name": "Accounts", "email": "ap@acme.example" }
    ],
    "prefilled_values": { "fld_2": "1000" },
    "expires_at": null,
    "reminder_days": [3, 7],
    "signer_auth": "email_otp",
    "require_identity_check": false
}
```

`201 Created`:

```json
{ "id": "sre_abc123", "status": "sent", "notified": ["dana@acme.example"] }
```

`207 Multi-Status` if the document was created and sent but at least one
notification email failed — the document is live and the named recipients did not
get theirs:

```json
{
    "id": "sre_abc123",
    "status": "sent_with_delivery_failures",
    "notified": ["dana@acme.example"],
    "failed": ["ap@acme.example"]
}
```

Notes that save an integration:

- `title` defaults to the template's name.
- `expires_at` / `reminder_days` omitted take the template version's defaults.
  `expires_at: null` explicitly means _no expiry_.
- `signer_auth` is `"account"` (the signer must log in) or `"email_otp"` (a code
  to their mailbox). **`email_otp` is the one that suits embedded signing** — see
  [Embedded signing](embedding.md).
- CC observers are copied when the document **completes**. There is no
  copy-on-send toggle here.
- Recipients at the same role `order` sign in parallel; different orders sign in
  sequence.

### `api_envelopes_get` — read state

**Scope:** `member`

```json
{ "organization_id": "org_abc123", "envelope_id": "sre_abc123" }
```

```json
{
    "id": "sre_abc123",
    "title": "Service Agreement — Acme Ltd",
    "status": "in_progress",
    "current_order": 1,
    "created_at": "2026-01-01T09:00:00.000Z",
    "sent_at": "2026-01-01T09:00:01.000Z",
    "completed_at": null,
    "expires_at": "2026-01-15T09:00:00.000Z",
    "reminder_days": [3, 7],
    "signer_auth": "email_otp",
    "require_identity_check": false,
    "template_id": "ctp_abc123",
    "template_version_id": "ctv_abc123",
    "source_pdf_sha256": "3b1f...",
    "signed_pdf_sha256": null,
    "certificate_sha256": null,
    "certificate_generated_at": null,
    "waiting_on": [
        { "id": "srs_abc123", "name": "Dana Reyes", "email": "dana@acme.example" }
    ],
    "recipients": [
        {
            "id": "srs_abc123",
            "type": "signer",
            "role_id": "role_client",
            "order": 1,
            "name": "Dana Reyes",
            "email": "dana@acme.example",
            "status": "notified",
            "notified_at": "2026-01-01T09:00:01.000Z",
            "viewed_at": null,
            "signed_at": null,
            "decline_reason": null,
            "changes_requested_reason": null,
            "reminder_count": 0,
            "last_reminded_at": null
        }
    ]
}
```

`waiting_on` is **derived**, not stored — it is the same fact the sender's list in
the UI shows, computed from `current_order` and recipient status so the two can
never disagree.

`recipients[].id` is what `api_envelopes_embed-url` takes as `signer_id`.

**Not returned, and never will be:** field values, R2 storage keys, token ids,
capture ids, or audit payloads. This is an authenticated endpoint for a program,
not an export.

`status` is one of `draft`, `in_progress`, `completed`, `declined`, `expired`,
`cancelled`.

### `api_envelopes_document-url` — fetch the PDF

**Scope:** `member`

Returns a **30-minute presigned URL**, not the bytes. A multi-megabyte PDF through
an edge function is wall-clock cost for no benefit, and a URL lets you hand the
download to a browser or a job runner.

```json
{ "organization_id": "org_abc123", "envelope_id": "sre_abc123", "variant": "signed" }
```

| `variant`          | Resolves to                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `signed` (default) | The signed PDF, **falling back to the source** while the document is still in progress.                                                          |
| `source`           | Always the original.                                                                                                                             |
| `certificate`      | The Certificate of Completion. `404 certificate_not_issued` until one exists — deliberately **no fallback**, because there is no substitute for it. |

```json
{ "url": "https://...", "variant": "source", "expires_in": 1800, "sha256": "3b1f..." }
```

`variant` in the response is the one that actually resolved, so you never have to
infer it. **`sha256` is always the digest of the bytes that URL serves** — never
the other variant's — so an integrity check on the downloaded file cannot fail on
an intact document.

This endpoint writes **no audit entry**. The browser's download does, because a
person taking a copy is evidence; a poller fetching one is noise.

### `api_envelopes_void` — withdraw

**Scope:** `send_documents`

```json
{
    "organization_id": "org_abc123",
    "envelope_id": "sre_abc123",
    "reason": "Superseded by rev 2"
}
```

```json
{ "id": "sre_abc123", "status": "cancelled", "revoked_links": 2 }
```

Every live signing link is revoked **before** the status flips, so there is no
window in which a voided document still has working links.

**No idempotency key**, deliberately: voiding twice is harmless, and the second
call gets a `409 invalid_status` naming the current state — more useful to a
retrying client than a replayed `200`.

### `api_envelopes_embed-url` — a signing pane in your own page

**Scope:** `send_documents` · Full guide: **[docs/embedding.md](embedding.md)**

```json
{
    "organization_id": "org_abc123",
    "envelope_id": "sre_abc123",
    "signer_email": "dana@acme.example",
    "origin": "https://app.example.com",
    "ttl_seconds": 900
}
```

```json
{
    "url": "https://sign.contractgo.example/embed/sign/AbCd...",
    "expires_at": "2026-01-01T09:15:00.000Z",
    "expires_in_seconds": 900,
    "signer_id": "srs_abc123",
    "embed_origin": "https://app.example.com"
}
```

`signer_id` or `signer_email` (either one). `origin` is **required** and must be
on the key's allowlist. TTL defaults to 900s and is clamped to `[60, 3600]`.

**Minting an embed URL does not revoke the recipient's emailed link.** The two are
different routes to the same signature and both may legitimately be live.

---

## Idempotency

`api_envelopes_create` requires an `Idempotency-Key` header — any string up to 255
characters; a UUID per logical send is the obvious choice. It is required rather
than optional because a duplicate legal document is not recoverable and a `400`
for a missing header is a five-minute fix.

The key is scoped to `(organization, endpoint, key)`, and the body is
fingerprinted with a **canonical JSON** hash: key order does not matter, so a
client that re-serializes its request on retry still replays rather than
conflicting.

| Situation                                | Result                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| First request                            | Runs. The response is recorded **before** it is returned.                  |
| Same key, same body, after completion    | The **original** response replayed byte for byte, with its original status. |
| Same key, same body, first still running | `409 idempotency_in_flight`. Retry shortly.                                |
| Same key, **different** body             | `409 idempotency_conflict`. You reused a key by mistake.                   |
| No key                                   | `400 idempotency_key_required`.                                            |

Records are pruned on a schedule. Treat a key as good for hours, not weeks.

---

## Webhooks

Register endpoints in **Settings → Integrations → Webhooks**. Each has a URL
(**`https://` only**, enforced by the database), a set of subscribed events, and a
signing secret shown once at creation.

### Events

| Event                         | Fires when                                                  |
| ----------------------------- | ----------------------------------------------------------- |
| `envelope.sent`               | The document was sent and the first recipients notified.     |
| `envelope.recipient_viewed`   | One recipient opened it.                                     |
| `envelope.recipient_signed`   | One recipient signed. Not the whole document.                |
| `envelope.recipient_declined` | One recipient declined.                                      |
| `envelope.changes_requested`  | The sender asked a recipient for changes.                    |
| `envelope.completed`          | Every signature is in. The signed PDF exists.                |
| `envelope.expired`            | It passed `expires_at` unsigned.                             |
| `envelope.voided`             | It was withdrawn.                                            |

**Three of these say `recipient_`, and the distinction is load-bearing.** A
decline currently ends the route, so `envelope.recipient_declined` and "the
document is dead" coincide today — but they are different facts, and naming the
event after the envelope would be a promise that they always will. Route on these
without having to guess whether an event is about one party or the whole document.

This vocabulary is a **mapping**, not our internal event log. Internal
transitions — credential issuance, OTP verification, identity outcomes, integrity
checks — map to nothing and are never sent to a third-party URL. Adding an event
is safe; changing what an existing one means is a breaking change, and the
database enum's comment says so.

### Payload

```json
{
    "event": "envelope.recipient_signed",
    "event_id": "sal_abc123",
    "occurred_at": "2026-01-01T10:22:31.000Z",
    "organization_id": "org_abc123",
    "envelope": {
        "id": "sre_abc123",
        "title": "Service Agreement — Acme Ltd",
        "status": "in_progress",
        "current_order": 2,
        "sent_at": "2026-01-01T09:00:01.000Z",
        "completed_at": null,
        "expires_at": "2026-01-15T09:00:00.000Z",
        "source_pdf_sha256": "3b1f...",
        "signed_pdf_sha256": null
    },
    "recipient": {
        "id": "srs_abc123",
        "name": "Dana Reyes",
        "email": "dana@acme.example",
        "order": 1,
        "type": "signer",
        "status": "signed"
    }
}
```

`recipient` is `null` on envelope-level events. **`decline_reason` is deliberately
absent** — it is evidence, it belongs in the audit trail and the certificate where
access is controlled, and this payload crosses the open internet to a third party.
Fetch it with `api_envelopes_get` if you need it.

`envelope.status` is read at the moment the event is emitted, after the row was
updated — so an `envelope.voided` payload reads `"cancelled"`, never the state it
was in a moment earlier.

### Headers

| Header                     | Value                                        |
| -------------------------- | -------------------------------------------- |
| `X-ContractGo-Signature`   | `t=<unix seconds>,v1=<hex hmac-sha256>`      |
| `X-ContractGo-Event`       | The event name, same as `payload.event`.     |
| `X-ContractGo-Event-Id`    | Same as `payload.event_id`.                  |
| `X-ContractGo-Delivery-Id` | This delivery attempt's id. Changes on retry. |
| `User-Agent`               | `ContractGo-Webhooks/1`                      |

### Responding

**Return a 2xx quickly.** Anything else — including a `3xx` — is a failure.
Redirects are deliberately **not followed**: following one would POST a signed
payload describing a legal agreement to a host the endpoint's owner never
registered. The request times out after **10 seconds**, so acknowledge first and
do your work afterwards.

### Retries and the circuit breaker

A failed delivery retries on a fixed ladder: **1m → 5m → 30m → 2h → 12h → 24h**,
then `failed`. A `4xx` is retried like anything else, because a `404` during a
deploy is the most common transient failure a consumer has.

After **10 consecutive failures** the endpoint is **disabled** and stops receiving
events entirely, with an in-app notification to the organization owner. Re-enabling
it from the settings page clears the counter. One delivery exhausting its six
retries cannot disable an endpoint on its own.

### Deduplication is your job

Delivery is **at-least-once**. The fan-out is exactly-once per endpoint per event
— but a network timeout after your server committed looks identical to a failure
from our side, so the same `event_id` can arrive twice.

**Key your processing on `event_id`.** It is the audit entry's id: stable, unique,
and present in both the payload and the headers.

### Verifying a signature

The signed string is `"<timestamp>.<raw request body>"`. Sign **the exact bytes
you received**, not a re-serialization of the parsed object — re-serializing is how
a signature comes to cover bytes that differ from the wire by a space.

Also compare in constant time, and reject a stale timestamp: the timestamp is
inside the MAC precisely so that you _can_ refuse an old one, which is what makes a
captured request non-replayable.

**Node**

```js
const crypto = require("crypto");

function verifyContractGoSignature(rawBody, header, secret, toleranceSeconds = 300) {
    const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
    const timestamp = Number(parts.t);
    if (!timestamp || !parts.v1) return false;

    if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

    const expected = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.${rawBody}`)
        .digest("hex");

    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(parts.v1, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Express: keep the RAW body. `express.json()` alone gives you a parsed object
// and the original bytes are gone.
app.post("/hooks/contractgo", express.raw({ type: "application/json" }), (req, res) => {
    const ok = verifyContractGoSignature(
        req.body.toString("utf8"),
        req.get("X-ContractGo-Signature"),
        process.env.CONTRACTGO_WEBHOOK_SECRET
    );
    if (!ok) return res.status(400).send("bad signature");

    res.sendStatus(200); // Acknowledge FIRST, then process.
    handle(JSON.parse(req.body.toString("utf8")));
});
```

**Python**

```python
import hashlib
import hmac
import time


def verify_contractgo_signature(raw_body: bytes, header: str, secret: str,
                                tolerance_seconds: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    timestamp = parts.get("t")
    received = parts.get("v1")
    if not timestamp or not received:
        return False

    if abs(time.time() - int(timestamp)) > tolerance_seconds:
        return False

    signed = f"{timestamp}.{raw_body.decode('utf-8')}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received)


# Flask: request.get_data() is the raw body. request.json is not.
@app.post("/hooks/contractgo")
def contractgo_hook():
    if not verify_contractgo_signature(
        request.get_data(),
        request.headers.get("X-ContractGo-Signature", ""),
        os.environ["CONTRACTGO_WEBHOOK_SECRET"],
    ):
        return "bad signature", 400
    ...
    return "", 200
```

#### Test vector

Both snippets above produce this. `tests/unit/edge/webhookDocs.test.ts` reads
these four values **out of this file** and asserts them against the same code that
signs real deliveries, so the documentation cannot drift from the implementation.

```
secret:    whsec_EXAMPLE_DO_NOT_USE_0123456789abcdef
timestamp: 1767225600
body:      {"event":"envelope.completed","event_id":"sal_example","occurred_at":"2026-01-01T00:00:00.000Z","organization_id":"org_example"}
signature: t=1767225600,v1=241d89b3536a63454b2a5cf1582cc5728f0fe18133c69626e2d00ae58cd86e23
```

### Testing an endpoint

**Send test** in the settings page delivers a synthetic event to one endpoint and
reports the raw status, the latency, and the exact signed string — so a signature
mismatch can be compared against what your own code computed. The secret is never
echoed.

Its `event` is **`webhook.test`**, which is deliberately _not_ a value in the event
vocabulary: a consumer switching on the enum falls through to its default branch,
which is the correct outcome for a ping. It writes no delivery record and no audit
entry, and a **disabled** endpoint is still testable — finding out whether it is
safe to switch back on is the whole point of pressing it.

---

## What this API deliberately does not do

- **No path-shaped REST facade.** One function per action, POST-only. If
  `/v1/envelopes/{id}` is ever wanted, it belongs in the Cloudflare Worker that
  already fronts the product, not in an edge function.
- **No per-request log.** `last_used_at` and `last_used_ip` on the key, plus the
  audit chain for anything that changed a document. A request log is a table that
  grows without bound and duplicates evidence that already exists.
- **No admin scope.** See [Scopes](#scopes).
- **No draft promotion.** `api_envelopes_create` composes and sends in one call.
