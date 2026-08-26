# Embedded signing

Render the ContractGo signing ceremony inside your own page, in an iframe, and
find out what happened through `postMessage`.

The whole flow is four steps:

1. Register the origins your pages are served from, on the API key.
2. Send a document with `api_envelopes_create`.
3. Call `api_envelopes_embed-url` for one recipient. You get back a short-lived
   URL.
4. Frame it, and listen for messages.

Everything below is the detail of those four. The endpoint reference lives in
[docs/api.md](api.md).

---

## 1. Register your origins

Embedded signing is **off by default on every key**. On the key — in
**Settings → Integrations → API keys** — add every origin your host pages are
served from:

```
https://app.example.com
https://staging.example.com
http://localhost:5173
```

An origin is a scheme, a host, and a port. **Nothing else.** A path, a query, a
fragment, credentials, a wildcard (`https://*.example.com`) or any scheme but
`http`/`https` is refused at entry rather than quietly trimmed — silently
rewriting `https://app.example.com/embed` into `https://app.example.com` would
widen what you asked for without telling you.

Case does not matter and a default port is the same origin without it:
`HTTPS://App.Example.COM:443` and `https://app.example.com` are one entry.

**An empty list is not a wildcard.** A key with no registered origins gets
`403 embed_not_enabled` for every embed URL request, and the check happens before
the document is even looked up.

Why the key rather than the request: if your key leaks, the holder still cannot
aim signing events at an origin you never registered.

## 2 & 3. Mint the URL

```http
POST /functions/v1/api_envelopes_embed-url
Authorization: Bearer cgk_...
Content-Type: application/json
```

```json
{
    "organization_id": "org_abc123",
    "envelope_id": "sre_abc123",
    "signer_email": "dana@acme.example",
    "origin": "https://app.example.com",
    "ttl_seconds": 900
}
```

`201`:

```json
{
    "url": "https://sign.contractgo.example/embed/sign/AbCd...",
    "expires_at": "2026-01-01T09:15:00.000Z",
    "expires_in_seconds": 900,
    "signer_id": "srs_abc123",
    "embed_origin": "https://app.example.com"
}
```

- `signer_id` **or** `signer_email` identifies the recipient. Email matching is
  case-insensitive. `signer_id` comes from `api_envelopes_get`.
- `origin` is **required**, and is the origin the framed page will report to. It
  must be one you registered on this key.
- `ttl_seconds` defaults to **900** and is clamped to **`[60, 3600]`** — a request
  for a week comes back as an hour, not an error.
- The credential is good for **three uses**, so a reload during the ceremony is
  fine and a fourth attempt is not.

**Mint it when the page is about to be shown, not in advance.** Fifteen minutes
is a session, not a link you store.

### Refusals worth handling

| Code                | Meaning                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `embed_not_enabled` | The key has no registered origins. Step 1.                             |
| `origin_not_allowed`| This origin is not on that list.                                       |
| `not_a_signer`      | That recipient is a CC observer. Observers have nothing to sign.        |
| `not_their_turn`    | The document is at an earlier routing order. Wait for the event.        |
| `already_signed` / `already_declined` | They are done. Nothing to embed.                     |
| `invalid_status`    | The document is completed, expired or voided.                          |

Each of these would otherwise have produced a working URL to a dead end inside
your iframe, which is a far worse failure than a `409` your code can branch on.

### It does not disturb the emailed link

Minting an embed URL **does not revoke** the recipient's emailed signing link.
They are two routes to the same signature and both may legitimately be live — a
counterparty who opens their email mid-flow finds it still works, and nobody has
to explain why it stopped. (`envelopes_resend` behaves differently, on purpose:
_that_ one replaces a link.)

The cost of that choice is that repeated calls accumulate live credentials, which
is why the TTL and use count are clamped in the database rather than only in the
client.

## 4. Frame it and listen

```html
<iframe
    id="cg-frame"
    src="https://sign.contractgo.example/embed/sign/AbCd..."
    style="width: 100%; height: 800px; border: 0"
    allow="camera"
></iframe>

<script>
    window.addEventListener("message", (event) => {
        // 1. ALWAYS check the origin. Any page can post to your window.
        if (event.origin !== "https://sign.contractgo.example") return;

        const msg = event.data;
        if (!msg || msg.source !== "contractgo" || msg.version !== 1) return;

        switch (msg.type) {
            case "ready":
                break; // The frame is alive and its session opened.
            case "loaded":
                console.log("signing", msg.envelope_id, msg.signer_id);
                break;
            case "completed":
                if (msg.completed_all) {
                    // Every party has now signed. The signed PDF exists.
                } else {
                    // This party is done; others are still outstanding.
                }
                break;
            case "declined":
                break;
            case "error":
                // The session could not be opened or continued. No reason is
                // carried — see below.
                break;
        }
    });
</script>
```

The `allow="camera"` attribute is only needed if the document requires an
identity check, which uses the device camera. Without it the browser blocks the
camera inside the frame and the signer cannot get past that step.

### Message shapes

Every message is exactly:

```ts
{
    source: "contractgo",
    version: 1,
    type: "ready" | "loaded" | "completed" | "declined" | "error",
    envelope_id?: string,
    signer_id?: string,
    completed_all?: boolean,   // "completed" only
}
```

| `type`      | When                                        | Carries                                        |
| ----------- | ------------------------------------------- | ---------------------------------------------- |
| `ready`     | The session resolved. See the timing note.  | Nothing else.                                   |
| `loaded`    | Immediately after `ready`.                  | `envelope_id`, `signer_id`.                     |
| `completed` | The signer finished.                        | `envelope_id`, `signer_id`, `completed_all`.    |
| `declined`  | The signer declined.                        | `envelope_id`, `signer_id`.                     |
| `error`     | The session could not be opened or continued. | Nothing else — deliberately.                  |

**`completed_all` is the difference between "this party signed" and "the document
is done".** A host that closes the frame on the first signature of a three-party
contract has closed it two signatures early. When the value is not knowable it is
**omitted** rather than sent as `false`, because `false` is the positive claim
that signatures are still outstanding — so check `msg.completed_all === true`,
not its falsiness.

**`error` carries no reason, on purpose.** Your host page belongs to you, not to
the signer, and this surface's refusals can name a mailbox, a passcode state or an
identity verdict. The signer reads the reason **inside the frame**, where the
token already entitles them to it.

### ⚠ `ready` fires when the session resolves, not on mount

The page learns which origin it may speak to **from the credential**, by opening
the session. Before that it has nowhere to send anything, so a mount-time `ready`
would be dropped — provably and silently.

The consequence: **`ready` means "the frame is alive _and_ its session opened".**
A token that was already expired never produces one. Arrange your own timeout —
a few seconds — and treat its expiry as a failure to open, the same way you would
treat `error`.

### Nothing is broadcast

The bridge posts to **one origin**: the one stamped on the credential at mint
time. `targetOrigin` is never `'*'`, and `'*'` is refused by name rather than
merely failing a shape check.

So a page that frames the ceremony from an origin you never registered receives
**silence** — not a wildcard broadcast it could read. That property, together with
the short single-use-ish token, is the actual defence here; see
[Framing policy](#framing-policy).

## Choose `email_otp`, not `account`

Send embedded documents with `"signer_auth": "email_otp"`. The signer gets a code
in their mailbox and enters it in the frame — no login, no cookies, and it works
in a cross-origin iframe.

`"signer_auth": "account"` requires the signer to be logged into ContractGo, and
that **cannot complete inside a frame**, for two independent reasons either of
which is sufficient:

- Browsers partition storage by top-level site, so a ContractGo session on our own
  origin is generally invisible to our page when framed by yours.
- A login flow inside a 600px box leaves the signer looking at a login page with
  the ceremony gone.

Rather than fail confusingly, the embedded page detects this and shows a short
explanation with a link that **opens the ceremony in a new tab**. The signature
still happens; it just does not happen in your frame, and your `completed` message
never arrives. Use `email_otp` and this never comes up.

## Framing policy

`https://<app>/embed/*` is the **only** path that may be framed. Everything else
in the application sends `X-Frame-Options: DENY` and
`Content-Security-Policy: frame-ancestors 'none'`.

**`frame-ancestors` on `/embed/*` cannot be per-tenant.** It is a static header
file served by a CDN; it cannot know which key minted the token in the URL, so it
cannot narrow the ancestors to the origins that key registered. The value is `*`,
and the honest statement of what protects that path is:

- the credential lives fifteen minutes by default and one hour at most;
- it is capped at three uses;
- it was **never emailed**, so it has no mailbox to leak from;
- it names one origin, and the page posts to that origin and no other.

What someone gains by framing `/embed/sign/{token}` is exactly what they already
had by opening that URL: they must possess the token. Framing adds no capability.

If per-tenant ancestors are ever wanted, they belong in a dynamic response — the
Cloudflare Worker that already fronts this product — not in a looser static value.

## Sizing

The embed route is chrome-free — no brand bar, no navigation — and sizes to
**100% of its container** rather than to the viewport height. Give the iframe a
real height; `800px` is a comfortable default for a one-page contract, and the
content scrolls within it.

## Checklist

- [ ] Origins registered on the key, including your local dev origin.
- [ ] Documents sent with `signer_auth: "email_otp"`.
- [ ] Embed URL minted at display time, not stored.
- [ ] `event.origin` checked in your listener.
- [ ] `msg.source === "contractgo"` and `msg.version === 1` checked.
- [ ] `completed_all === true` distinguished from a single party finishing.
- [ ] A timeout covering "`ready` never arrived".
- [ ] `allow="camera"` if identity checks are enabled.
- [ ] Webhooks subscribed as the authoritative record — `postMessage` tells you what
      happened in **this frame**; the webhook tells you what happened to the
      **document**, including when a party signs from their email instead.
