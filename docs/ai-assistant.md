# AI document assistant

A reading assistant that sits beside the contract on the signing surface, before
the signature is committed. The signer asks questions about *that* document and
gets answers grounded in *that* document.

It is not legal advice, not an opinion on whether to sign, and not a second
source of truth about the document. On a legal-evidence product a confidently
wrong answer is worse than no answer, and every decision below follows from that.

## The pieces

| Where | What |
|---|---|
| `supabase/migrations/…_cg049_signer_ai_assistant.sql` | Four tables, three RPCs, every cap |
| `_shared/ai.ts` + `ai.gemini.ts` + `ai.mock.ts` | The driver seam |
| `_shared/aiPrompt.ts` | **Pure.** Prompt assembly and answer verification |
| `_shared/pdfText.ts` | `unpdf` text extraction |
| `supabase/functions/signing_ai_ask/` | Orchestration; no prompts, no vendor code |
| `src/components/signing/App_SigningAssistant*` | The panel |

## The trust boundary

The only trusted strings are the ones this repository's source code wrote.

The document text, the envelope title, every field label and every entered value
were authored by whoever composed the template — which on this product is the
**sender**, who is the counterparty to the person reading the answer. Assume they
are hostile.

Untrusted blocks go into the prompt inside a fence whose id is 16 random bytes
minted **per request**, so a closing marker cannot be pre-planted in a PDF. The
rules go in the model's separate `systemInstruction` slot, never as a prefix on
the same channel as the document.

## What actually stops a fabricated clause

Prompting is a request. `verifyAnswer` is the enforcement, and there are four
layers:

1. **Verbatim quote verification.** Every citation's quote must be a literal
   substring of the identically-normalized text of the page it claims, and of a
   page that was actually sent. Non-matching citations are dropped. This is the
   mechanism that works.
2. **Grounding downgrade.** A `grounded: true` answer with no surviving citation
   is discarded and replaced by a fixed refusal. No retry — a retry is another
   free-tier request to be told the same thing.
3. **Canary check.** An answer echoing the nonce, a fence literal or a
   distinctive phrase from the system instruction is discarded entirely and
   logged loudly. That is a successful extraction attempt, not a bad answer.
4. **The disclaimer is a server constant**, returned on every response. It cannot
   be injected away or lost to a schema violation.

Plus ingest sanitization, once at extraction time: C0/C1 controls, zero-width
codepoints and bidi overrides are stripped before anything is cached. Those exist
in a PDF for one reason — text a human cannot see but a model reads normally.

Stated honestly: **this does not make prompt injection impossible.** What it makes
impossible is for an injected instruction to put a *false statement about the
contract* in front of a signer, because every factual claim must carry a quote
that exists in the document they are holding.

## Grounding: cached text, not the PDF

The source PDF is extracted once per envelope with `unpdf` and cached in
`signer_ai_document_context` as page-tagged text plus character offsets.
`source_pdf_sha256` is the invalidation key.

Sending the PDF inline each turn would be cheaper in tokens and would buy nothing
that matters: the model could cite a page number it invented, and hidden text
would go into the prompt unsanitized. Cached text is what makes quote
verification possible at all.

A scan has no text layer, so extraction records `insufficient_text` and the panel
stops appearing for that envelope. Refusing beats an ungrounded model guessing at
a contract it cannot read. (OCR via `extraction_method = 'gemini_ocr'` is
designed for and deferred; it writes the same columns and every downstream path
stays identical.)

## The caps, and why they are in SQL

Every other public signing function spends only the caller's own allowance when
abused. This one spends a **shared upstream quota** that every tenant's signers
draw on, so per-credential throttling is structurally insufficient.

| Scope | Limit |
|---|---|
| per link, cooldown | 5 s |
| per link, hourly | 15 |
| per link, lifetime | 30 |
| per envelope | 120 |
| per organization, daily | 500 |
| deployment, daily | ~60 % of upstream RPD |
| per IP | **none** — mobile NAT rejects honest signers; the IP is recorded as evidence instead |

All of them live inside `signer_ai_message_begin`, enforced within one statement
sequence — a read-then-write check in TypeScript is two round trips with a gap,
and two concurrent POSTs both walk through it. They are SQL constants, so
changing one takes a migration: a limit you can change without one is a limit
nobody reviews.

Turns are **charged before the model call** and **refunded** by
`signer_ai_message_fail` when the call produces nothing. Without the refund a
Google outage would silently burn the signer's questions and their org's daily
allowance. A safety block is *not* refunded — the call really happened.

## History lives in Postgres

Never accepted from the client. On a `verify_jwt = false` endpoint,
client-supplied history means the attacker authors the *model's own prior turns*,
which is the most reliable jailbreak there is and defeats every control above at
once. It also makes the 1000-character question cap decorative.

## Privacy: the transcript is not sender-visible

`signer_ai_messages` has RLS on with zero policies. No view, no RPC, no
certificate line reads it. The audit chain gets exactly one
`signer_ai_question_asked` entry per signing link, with no question and no answer
text.

Three reasons, the last decisive:

1. `signature_audit_append` takes `FOR UPDATE` on the request row — chatting
   would serialize the signing surface against a co-signer's submit.
2. A certificate rendering ten chat entries with a signature buried among them is
   a worse evidence artifact.
3. A signer's questions are their own words about *why they hesitate*:
   prejudicial and arguably privileged. The Certificate of Completion goes to the
   **counterparty**. A chained entry is one you can never lawfully redact without
   destroying the signature's own evidentiary value.

Do not add a policy "so support can see it" without reading PHASE 7 of the
migration first.

## Kill switches

- `AI_DRIVER=off` — deployment-wide. The endpoint 503s before touching the
  database; the panel stops being advertised.
- `organizations.ai_assistant_enabled = false` — one tenant, no deploy. Default
  `true`.

`signing_session_open` reads both to decide whether to advertise the panel;
`signer_ai_message_begin` re-checks the org flag and is the authority, because a
page that has not reloaded still thinks the feature is on.

## Local development

`AI_DRIVER=mock` needs no API key. The mock returns one citation that verifies
and one that does not, so the quote verifier is observable, and these sentinel
questions make every failure branch reachable by hand:

`__mock_429` · `__mock_500` · `__mock_timeout` · `__mock_safety` ·
`__mock_malformed` · `__mock_ungrounded`

See [deployment.md](deployment.md#ai-document-assistant-cg-049) for server
configuration and [testing.md](testing.md) for what is and is not covered.
