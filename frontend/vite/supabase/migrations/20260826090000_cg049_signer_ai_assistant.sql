-- ===========================================================================
-- CG-049 — SIGNER AI DOCUMENT ASSISTANT
-- ===========================================================================
--
-- A signer opens /sign/{token}, reads a PDF they did not write, and either
-- signs or abandons. Between "I don't understand clause 7" and "email the
-- sender and wait a day" there is nothing, and that gap is the largest silent
-- drop-off between SENT and SIGNED.
--
-- This file is the database half of a reading assistant that sits beside the
-- contract, before the signature: the signer asks questions about THAT
-- document and gets answers grounded in THAT document, backed by the Gemini
-- API on its free tier.
--
-- WHAT IT IS NOT, and every decision below is shaped by it: not legal advice,
-- not an opinion on whether to sign, not a second source of truth about the
-- document. On a legal-evidence product a confidently wrong answer is worse
-- than no answer, which is why the answer path is verify-then-store rather
-- than store-then-hope — `signer_ai_messages.citations` may only ever hold
-- quotes the edge function proved are literal substrings of the cached page
-- text, so the persisted transcript CANNOT contain a fabricated one.
--
-- THE THROTTLE IS THE POINT OF THIS FILE. `_shared/signerAuth.ts` says at
-- length that a signing link is a bearer credential that leaks — forwarding,
-- mail scanners, archives. Every other public signing function spends only the
-- holder's OWN allowance when abused. This one spends a SHARED PROJECT QUOTA:
-- a leaked link firing questions consumes the free-tier RPD that every other
-- tenant's signers also draw on. Per-credential throttling, which was
-- sufficient for CG-031's passcodes ("an attacker's total reach is bounded by
-- the caps on the single token they hold"), is therefore structurally
-- insufficient here. There must be an org-daily and a project-daily cap too,
-- and PHASE 5 has both.
--
-- NO PER-IP LIMIT, consistent with the project's standing position. Mobile
-- carrier NAT puts thousands of honest signers behind one address; a per-IP cap
-- rejects real people to inconvenience an attacker who can rent addresses. The
-- IP is RECORDED on every question as evidence instead.
--
-- WHY THE CAPS ARE SQL CONSTANTS AND NOT ENV. A limit you can change without a
-- migration is a limit nobody reviews. These bound spend on a shared resource
-- and their values are an argument, not a setting — so they live where the
-- argument is written down.
--
-- NO `anon` REACHES ANY OF THIS. CG-009/010/015 assert that no RLS policy
-- targets `anon` and that no SECURITY DEFINER function is executable outside a
-- stated allowlist. All four tables below get RLS with zero policies, exactly
-- like `signer_access_tokens` (CG-005) and `verify_rate_limits` (CG-043), and
-- all three routines are service_role only. Both are re-asserted at the bottom.
--
-- ONE FILE IS SAFE HERE, and the reason must be stated because it is a rule
-- and not a coincidence. PostgreSQL forbids an enum value added in a
-- transaction from being REFERENCED in that same transaction (CG-016:49).
-- PHASE 7 adds `signer_ai_question_asked`; nothing below it — INCLUDING THE
-- PROBE BLOCK — may append a `signature_audit_log` row. CG-031 satisfied this
-- by luck rather than by rule; here it is the rule.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- PHASE 1: THE ORG KILL SWITCH
-- ---------------------------------------------------------------------------
-- Default ON. The feature is a courtesy to the signer, not a liability the
-- sender opted into, and a default-off flag on a per-org table means the
-- feature ships dark and nobody ever sees it.
--
-- A COLUMN AND NOT AN ENV VAR because the population that wants it off is a
-- SUBSET: a law firm that considers any machine explanation of its own drafting
-- unacceptable must be able to turn it off for themselves without a deploy and
-- without turning it off for everyone else. `AI_DRIVER=off` remains the
-- deployment-wide switch; this is the tenant-wide one.

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS ai_assistant_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.ai_assistant_enabled IS
    'Whether recipients of this organization''s envelopes get the AI reading '
    'assistant on the signing surface (CG-049). Default true. Read by '
    'signing_session_open (which gates the panel) AND by signer_ai_message_begin '
    '(which gates the endpoint) — the second is the authoritative one, because '
    'a client that has not reloaded still holds a page that thinks it is on.';


-- ---------------------------------------------------------------------------
-- PHASE 2: THE DOCUMENT CONTEXT CACHE
-- ---------------------------------------------------------------------------
-- One row per envelope, holding the text extracted from the source PDF once and
-- reused by every question from every signer on it.
--
-- CACHED TEXT RATHER THAN THE PDF ITSELF, and this is the decision the whole
-- feature rests on. Sending the PDF inline to the model each turn is cheaper in
-- tokens and buys nothing that matters: the model can cite a page number it
-- invented, and hidden text planted in the file goes straight into the prompt
-- unsanitized. Cached text buys the one mechanism that actually stops a
-- fabricated clause reaching a signer — every quote the model returns is
-- checked as a LITERAL SUBSTRING of the cached text of the page it claims,
-- before the signer sees it. A quote that is not in the document does not
-- survive that check. Nothing else in the design has that property.
--
-- `pages` IS THE CITATION ANCHOR, not a convenience: [{page, start, end}] of
-- character offsets into `document_text`, so a claimed page number resolves to
-- an exact slice rather than to a heuristic search. `document_text` and `pages`
-- are written together and are meaningless apart.

CREATE TABLE IF NOT EXISTS public.signer_ai_document_context (
    id TEXT PRIMARY KEY DEFAULT generate_id('adc'),
    -- UNIQUE: the cache is per document, not per signer. Five recipients on one
    -- envelope extract once between them.
    request_id TEXT NOT NULL UNIQUE REFERENCES public.signature_requests(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    document_text TEXT NOT NULL DEFAULT '',
    -- [{"page": 1, "start": 0, "end": 1840}, …] — half-open character offsets
    -- into document_text. Asserted by the edge unit tests to round-trip:
    -- document_text.slice(start, end) === the page's own text.
    pages JSONB NOT NULL DEFAULT '[]'::JSONB,
    char_count INTEGER NOT NULL DEFAULT 0,
    page_count INTEGER NOT NULL DEFAULT 0,

    -- sha256 of document_text. Recorded on the audit event so the chain can say
    -- WHICH extraction the signer was answered from, without the text itself
    -- entering the chain.
    context_sha256 TEXT,

    -- THE INVALIDATION KEY, and the reason this is a column rather than a
    -- timestamp. `signature_requests.source_pdf_sha256` is what the signer is
    -- actually being shown. If it differs from what was extracted, the cache is
    -- about a document nobody is looking at, and answering from it would be
    -- worse than refusing. The edge function re-extracts on a mismatch.
    source_pdf_sha256 TEXT NOT NULL,

    -- 'pdf_text' is the only producer in v1. The column exists so the OCR
    -- fallback for scanned contracts ('gemini_ocr') slots in writing the SAME
    -- columns, and every downstream path stays byte-identical.
    extraction_method TEXT NOT NULL DEFAULT 'pdf_text',
    -- ready            usable text
    -- insufficient_text a scan, or a PDF whose text layer is decorative
    -- too_large        beyond the hard ceiling even after page selection
    -- failed           the extractor threw
    extraction_status TEXT NOT NULL DEFAULT 'ready',
    extraction_error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT signer_ai_document_context_method_check
        CHECK (extraction_method IN ('pdf_text', 'gemini_ocr')),
    CONSTRAINT signer_ai_document_context_status_check
        CHECK (extraction_status IN ('ready', 'insufficient_text', 'too_large', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_signer_ai_document_context_organization_id
    ON public.signer_ai_document_context(organization_id);

COMMENT ON TABLE public.signer_ai_document_context IS
    'Extracted text of an envelope''s source PDF, cached for the signer AI '
    'assistant (CG-049). RLS on with NO policies — reachable only through the '
    'SECURITY DEFINER routines and the service key. It holds the full text of a '
    'contract, so it is exactly as sensitive as the PDF in R2 and gets the same '
    'treatment. source_pdf_sha256 is the invalidation key: a replaced source '
    'document re-extracts rather than answering about a file nobody is shown.';

CREATE TRIGGER trigger_set_org_id_signer_ai_document_context
    BEFORE INSERT ON public.signer_ai_document_context
    FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_signature_request();

CREATE TRIGGER on_signer_ai_document_context_updated
    BEFORE UPDATE ON public.signer_ai_document_context
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.signer_ai_document_context ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies. See the table comment.


-- ---------------------------------------------------------------------------
-- PHASE 3: THE CONVERSATION
-- ---------------------------------------------------------------------------
-- ONE CONVERSATION PER CREDENTIAL, not per signer, and the UNIQUE constraint is
-- on `token_id` for a property it inherits for free: `envelopes_resend` and the
-- request-changes loop both mint a NEW token. So a signer returning to a
-- REVISED document starts a fresh thread rather than inheriting answers about a
-- superseded revision — which is the failure this feature could most easily
-- cause and the hardest one to notice.

CREATE TABLE IF NOT EXISTS public.signer_ai_sessions (
    id TEXT PRIMARY KEY DEFAULT generate_id('ais'),
    token_id TEXT NOT NULL UNIQUE REFERENCES public.signer_access_tokens(id) ON DELETE CASCADE,
    signer_id TEXT NOT NULL REFERENCES public.signature_request_signers(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- Counts exchanges that were not refunded. The lifetime cap reads it, and
    -- `signer_ai_message_fail` decrements it — see PHASE 6.
    turn_count INTEGER NOT NULL DEFAULT 0,
    last_asked_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT signer_ai_sessions_turn_count_check CHECK (turn_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_signer_ai_sessions_request_id
    ON public.signer_ai_sessions(request_id);
CREATE INDEX IF NOT EXISTS idx_signer_ai_sessions_organization_id
    ON public.signer_ai_sessions(organization_id);

COMMENT ON TABLE public.signer_ai_sessions IS
    'One AI assistant conversation per signer access token (CG-049). RLS on '
    'with no policies. Keyed to the CREDENTIAL rather than the signer so that a '
    'resend or a request-changes round — both of which mint a new token — starts '
    'a fresh thread instead of carrying answers about a superseded revision.';

CREATE TRIGGER trigger_set_org_id_signer_ai_sessions
    BEFORE INSERT ON public.signer_ai_sessions
    FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_signature_request();

CREATE TRIGGER on_signer_ai_sessions_updated
    BEFORE UPDATE ON public.signer_ai_sessions
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.signer_ai_sessions ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies. See the table comment.


-- ONE ROW PER EXCHANGE — question AND its answer — rather than one row per
-- role-message. The pair is the unit the throttle counts and the unit a refund
-- reverses; splitting it would make "how many questions has this token asked"
-- a filtered count that every caller has to get right.
--
-- THE TRANSCRIPT IS NOT SENDER-VISIBLE. No RLS policy exposes it, no view
-- selects it, and no certificate line renders it. A signer's questions are
-- their own words about WHY THEY HESITATE — prejudicial, arguably privileged,
-- and the Certificate of Completion goes to the counterparty. That decision is
-- argued in full above `signature_audit_log`'s side of it in PHASE 7.

CREATE TABLE IF NOT EXISTS public.signer_ai_messages (
    id TEXT PRIMARY KEY DEFAULT generate_id('aim'),
    session_id TEXT NOT NULL REFERENCES public.signer_ai_sessions(id) ON DELETE CASCADE,
    token_id TEXT NOT NULL REFERENCES public.signer_access_tokens(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- 1-based, assigned inside signer_ai_message_begin so two concurrent POSTs
    -- cannot both claim the same index.
    turn_index INTEGER NOT NULL,

    -- The cap is enforced HERE as well as in the edge function. The edge check
    -- is the polite one that returns a 400; this one is the one that holds when
    -- a future caller forgets, and it is what makes "30 turns" a real bound on
    -- how much text one credential can put into a prompt.
    question TEXT NOT NULL,
    answer TEXT,
    -- ONLY quotes that survived verbatim verification. A citation in this column
    -- is, by construction, a literal substring of the cached page text.
    citations JSONB NOT NULL DEFAULT '[]'::JSONB,
    grounded BOOLEAN,
    -- 'ungrounded' | 'leak' | 'safety' | 'no_context' | … — why the answer was
    -- replaced by a fixed refusal. NULL on an ordinary answer.
    refusal_reason TEXT,
    model TEXT,

    -- pending  the call is in flight
    -- answered the signer got a real answer
    -- refused  the model or the verifier declined; the turn still counts
    -- blocked  a safety filter fired; the turn still counts (it was a real call)
    -- failed   the call never produced anything; the turn is REFUNDED
    status TEXT NOT NULL DEFAULT 'pending',
    failure_reason TEXT,

    -- Evidence, not a throttle key. See the header on per-IP limiting.
    asked_ip INET,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    answered_at TIMESTAMPTZ,

    CONSTRAINT signer_ai_messages_question_length_check
        CHECK (char_length(question) BETWEEN 1 AND 1000),
    CONSTRAINT signer_ai_messages_status_check
        CHECK (status IN ('pending', 'answered', 'refused', 'blocked', 'failed')),
    CONSTRAINT signer_ai_messages_turn_index_check CHECK (turn_index >= 1),
    CONSTRAINT signer_ai_messages_session_turn_unique UNIQUE (session_id, turn_index)
);

-- The history read: "the last few answered exchanges on this session, oldest
-- first". Runs on every question.
CREATE INDEX IF NOT EXISTS idx_signer_ai_messages_session_turn
    ON public.signer_ai_messages(session_id, turn_index);
-- The per-request cap's read, and the only one that spans sessions.
CREATE INDEX IF NOT EXISTS idx_signer_ai_messages_request_id
    ON public.signer_ai_messages(request_id);
CREATE INDEX IF NOT EXISTS idx_signer_ai_messages_organization_id
    ON public.signer_ai_messages(organization_id);
-- The hourly cap's read.
CREATE INDEX IF NOT EXISTS idx_signer_ai_messages_token_created
    ON public.signer_ai_messages(token_id, created_at DESC);

COMMENT ON TABLE public.signer_ai_messages IS
    'One question-and-answer exchange with the signer AI assistant (CG-049). '
    'RLS on with NO policies — the transcript is deliberately not visible to the '
    'sender, and there is no view or certificate line that renders it. '
    'citations holds only quotes the edge function verified as literal '
    'substrings of the cached page text, so a stored citation cannot be a '
    'fabrication. status = ''failed'' marks a refunded turn and is excluded from '
    'every count.';

CREATE TRIGGER trigger_set_org_id_signer_ai_messages
    BEFORE INSERT ON public.signer_ai_messages
    FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_signature_request();

ALTER TABLE public.signer_ai_messages ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies. See the table comment.


-- ---------------------------------------------------------------------------
-- PHASE 4: THE SHARED-QUOTA LEDGER
-- ---------------------------------------------------------------------------
-- Two scopes in one table: 'org' rows bound a single tenant's daily draw, and
-- the single 'global' row bounds the whole deployment's.
--
-- DELIBERATELY NO FOREIGN KEY ON `scope_id`. The global row names no entity —
-- its scope_id is the literal '_global' — and adding an FK would force either a
-- second table or a fake organization row. The org rows' referential integrity
-- is not worth a schema that cannot express the row that matters most.
--
-- `day` IS A DATE IN UTC, not a rolling window. A rolling window needs the
-- history retained to compute it; a calendar day is one integer per bucket and
-- matches how the upstream quota itself resets.

CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    day DATE NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (scope, scope_id, day),
    CONSTRAINT ai_usage_daily_scope_check CHECK (scope IN ('org', 'global')),
    CONSTRAINT ai_usage_daily_count_check CHECK (request_count >= 0)
);

COMMENT ON TABLE public.ai_usage_daily IS
    'Daily AI request counters (CG-049), one row per (scope, scope_id, day). '
    'RLS on with no policies. The ''global''/''_global'' row is the deployment-wide '
    'cap that makes an upstream 429 a bug rather than a Tuesday — the free tier''s '
    'request-per-day allowance is a PROJECT resource, so per-credential limits '
    'alone cannot protect it. Counters are decremented by '
    'signer_ai_message_fail so an upstream outage does not burn a real '
    'allowance.';

ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies. See the table comment.


-- ---------------------------------------------------------------------------
-- PHASE 5: BEGIN — EVERY LIMIT, IN ONE PLACE, INSIDE THE WRITE
-- ---------------------------------------------------------------------------
-- THE THROTTLE IS IN HERE AND NOT IN TYPESCRIPT for exactly CG-031's reason: a
-- read-then-write check in the edge function is two round trips with a gap in
-- the middle, and two concurrent POSTs both slip through it. The daily caps in
-- particular are increment-and-check in a SINGLE statement — the INSERT … ON
-- CONFLICT DO UPDATE … WHERE … RETURNING form, where NO RETURNED ROW means the
-- cap was already reached. Reading the counter and then updating it would let
-- N concurrent callers all read N-1.
--
-- REFUSING IS A RETURN, NOT A RAISE. "You asked too soon" is an ordinary answer
-- the signing surface renders as a countdown; an exception would make the
-- caller unable to tell it apart from a database fault.
--
-- THE CAPS, and why each number is the number:
--
--   cooldown 5s     stops a script; invisible to a human who types a question.
--   15 / hour       a genuinely confused human asks maybe ten. This is the
--                   bound on a burst.
--   30 / lifetime   the leaked-link bound. Whoever holds a forwarded URL gets
--                   thirty questions in total, ever, on that credential.
--   120 / request   a five-signer envelope cannot multiply the lifetime cap by
--                   five. Spans sessions, which is why signer_ai_messages
--                   carries request_id rather than reaching through the session.
--   500 / org / day one tenant cannot starve the others.
--   150 / day       roughly 60% of the free tier's real RPD, leaving headroom
--                   so the ceiling we hit is OURS and returns a clean 503,
--                   rather than Google's, which returns a 429 mid-ceremony.
--
-- ORDER MATTERS: the cheap per-token checks run before the ledger is touched,
-- so a refused request never increments a shared counter it was not allowed to
-- spend. And the org counter increments before the global one, so a global
-- refusal leaves the org counter one high — which PHASE 6's refund path is the
-- reason we can accept: the caller refunds on every non-ok status that got past
-- the ledger. It is written that way round rather than global-then-org because
-- the global cap is the one whose exhaustion must be unambiguous.

CREATE OR REPLACE FUNCTION public.signer_ai_message_begin(
    p_token_id TEXT,
    p_question TEXT,
    p_ip TEXT DEFAULT NULL
)
RETURNS TABLE(
    status TEXT,
    session_id TEXT,
    message_id TEXT,
    turn_index INTEGER,
    turns_remaining INTEGER,
    retry_after_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    c_cooldown_seconds CONSTANT INTEGER := 5;
    c_max_per_hour     CONSTANT INTEGER := 15;
    c_max_per_token    CONSTANT INTEGER := 30;
    c_max_per_request  CONSTANT INTEGER := 120;
    c_max_per_org_day  CONSTANT INTEGER := 500;
    c_max_per_day      CONSTANT INTEGER := 150;

    v_signer_id  TEXT;
    v_request_id TEXT;
    v_org_id     TEXT;
    v_enabled    BOOLEAN;
    v_session_id TEXT;
    v_turns      INTEGER;
    v_last_at    TIMESTAMPTZ;
    v_recent     INTEGER;
    v_req_total  INTEGER;
    v_day        DATE := (now() AT TIME ZONE 'utc')::DATE;
    v_ok         BOOLEAN;
    v_message_id TEXT;
    v_next       INTEGER;
    v_ordinal    INTEGER;
BEGIN
    SELECT t.signer_id, t.request_id, t.organization_id
      INTO v_signer_id, v_request_id, v_org_id
      FROM public.signer_access_tokens t
     WHERE t.id = p_token_id
       AND t.revoked_at IS NULL
       AND t.consumed_at IS NULL
       AND t.expires_at > now();

    -- A dead credential gets no answer, reported as a status rather than an
    -- exception so the caller folds it into the same opaque 401 it gives for
    -- every other bad-token case. This must not become an oracle for probing
    -- which emailed links are still live.
    IF v_signer_id IS NULL THEN
        RETURN QUERY SELECT 'invalid_token'::TEXT, NULL::TEXT, NULL::TEXT, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER;
        RETURN;
    END IF;

    SELECT o.ai_assistant_enabled INTO v_enabled
      FROM public.organizations o WHERE o.id = v_org_id;

    IF v_enabled IS NOT TRUE THEN
        RETURN QUERY SELECT 'disabled'::TEXT, NULL::TEXT, NULL::TEXT, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER;
        RETURN;
    END IF;

    -- The session is created on first question rather than at token issue, so a
    -- signer who never opens the panel leaves no row.
    INSERT INTO public.signer_ai_sessions (token_id, signer_id, request_id)
         VALUES (p_token_id, v_signer_id, v_request_id)
    ON CONFLICT (token_id) DO UPDATE SET token_id = EXCLUDED.token_id
      RETURNING id, turn_count, last_asked_at
           INTO v_session_id, v_turns, v_last_at;

    IF v_last_at IS NOT NULL AND v_last_at > now() - make_interval(secs => c_cooldown_seconds) THEN
        RETURN QUERY SELECT
            'cooldown'::TEXT, v_session_id, NULL::TEXT, NULL::INTEGER,
            greatest(c_max_per_token - v_turns, 0),
            ceil(extract(epoch FROM (v_last_at + make_interval(secs => c_cooldown_seconds)) - now()))::INTEGER;
        RETURN;
    END IF;

    IF v_turns >= c_max_per_token THEN
        RETURN QUERY SELECT 'turn_limit'::TEXT, v_session_id, NULL::TEXT, NULL::INTEGER, 0, NULL::INTEGER;
        RETURN;
    END IF;

    -- Both counts exclude refunded turns: a Google outage must not consume the
    -- signer's allowance.
    SELECT count(*) INTO v_recent
      FROM public.signer_ai_messages m
     WHERE m.token_id = p_token_id
       AND m.status <> 'failed'
       AND m.created_at > now() - interval '1 hour';

    IF v_recent >= c_max_per_hour THEN
        RETURN QUERY SELECT 'rate_limited'::TEXT, v_session_id, NULL::TEXT, NULL::INTEGER,
            greatest(c_max_per_token - v_turns, 0), 3600::INTEGER;
        RETURN;
    END IF;

    SELECT count(*) INTO v_req_total
      FROM public.signer_ai_messages m
     WHERE m.request_id = v_request_id
       AND m.status <> 'failed';

    IF v_req_total >= c_max_per_request THEN
        RETURN QUERY SELECT 'turn_limit'::TEXT, v_session_id, NULL::TEXT, NULL::INTEGER, 0, NULL::INTEGER;
        RETURN;
    END IF;

    -- Increment-and-check, one statement. No returned row means the cap held.
    INSERT INTO public.ai_usage_daily AS u (scope, scope_id, day, request_count)
         VALUES ('org', v_org_id, v_day, 1)
    ON CONFLICT (scope, scope_id, day) DO UPDATE
            SET request_count = u.request_count + 1,
                updated_at    = now()
          WHERE u.request_count < c_max_per_org_day
      RETURNING TRUE INTO v_ok;

    IF v_ok IS NOT TRUE THEN
        RETURN QUERY SELECT 'org_quota'::TEXT, v_session_id, NULL::TEXT, NULL::INTEGER,
            greatest(c_max_per_token - v_turns, 0), NULL::INTEGER;
        RETURN;
    END IF;

    v_ok := NULL;

    INSERT INTO public.ai_usage_daily AS u (scope, scope_id, day, request_count)
         VALUES ('global', '_global', v_day, 1)
    ON CONFLICT (scope, scope_id, day) DO UPDATE
            SET request_count = u.request_count + 1,
                updated_at    = now()
          WHERE u.request_count < c_max_per_day
      RETURNING TRUE INTO v_ok;

    IF v_ok IS NOT TRUE THEN
        -- Give the org counter back before refusing: this request never reached
        -- the model, and the tenant should not pay for the deployment's ceiling.
        UPDATE public.ai_usage_daily u
           SET request_count = greatest(u.request_count - 1, 0), updated_at = now()
         WHERE u.scope = 'org' AND u.scope_id = v_org_id AND u.day = v_day;

        RETURN QUERY SELECT 'global_quota'::TEXT, v_session_id, NULL::TEXT, NULL::INTEGER,
            greatest(c_max_per_token - v_turns, 0), NULL::INTEGER;
        RETURN;
    END IF;

    v_next := v_turns + 1;

    -- TWO DIFFERENT NUMBERS, and conflating them is a bug the probe below
    -- caught. `turn_count` is what the signer is CHARGED and it goes back down
    -- on a refund. `turn_index` is the message's ORDINAL in the conversation
    -- and must never go back down — it is a unique key on the session, and a
    -- refunded exchange still occupies the row it was written to. Deriving the
    -- ordinal from the charge counter makes question N+1 collide with the
    -- failed question N every time an upstream call fails.
    SELECT COALESCE(max(m.turn_index), 0) + 1 INTO v_ordinal
      FROM public.signer_ai_messages m
     WHERE m.session_id = v_session_id;

    -- turn_count moves HERE, with the message insert, and not on completion.
    -- The counter has to bind before the model call, or two questions fired a
    -- millisecond apart both see the pre-call value. `signer_ai_message_fail`
    -- is what makes charging up front safe.
    UPDATE public.signer_ai_sessions s
       SET turn_count = v_next, last_asked_at = now()
     WHERE s.id = v_session_id;

    INSERT INTO public.signer_ai_messages
        (session_id, token_id, request_id, turn_index, question, asked_ip, status)
    VALUES
        (v_session_id, p_token_id, v_request_id, v_ordinal, p_question, p_ip::INET, 'pending')
    RETURNING id INTO v_message_id;

    RETURN QUERY SELECT
        'ok'::TEXT, v_session_id, v_message_id, v_ordinal,
        greatest(c_max_per_token - v_next, 0), NULL::INTEGER;
END;
$$;


-- ---------------------------------------------------------------------------
-- PHASE 6: COMPLETE AND FAIL
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.signer_ai_message_complete(
    p_message_id TEXT,
    p_status TEXT,
    p_answer TEXT,
    p_citations JSONB DEFAULT '[]'::JSONB,
    p_grounded BOOLEAN DEFAULT NULL,
    p_refusal_reason TEXT DEFAULT NULL,
    p_model TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_status NOT IN ('answered', 'refused', 'blocked') THEN
        RAISE EXCEPTION 'signer_ai_message_complete: bad status %', p_status;
    END IF;

    UPDATE public.signer_ai_messages m
       SET status         = p_status,
           answer         = p_answer,
           -- Only verified quotes ever reach this column; the edge function
           -- drops the rest before calling. The default is the empty array
           -- rather than NULL so a reader never has to branch.
           citations      = COALESCE(p_citations, '[]'::JSONB),
           grounded       = p_grounded,
           refusal_reason = p_refusal_reason,
           model          = p_model,
           answered_at    = now()
     WHERE m.id = p_message_id
       AND m.status = 'pending';
END;
$$;


-- THE REFUND, and it is not a nicety. Without it a Google outage silently burns
-- the signer's thirty questions and their organization's daily allowance — the
-- signer is punished for a fault on our side of the wire, and the tenant pays
-- for requests that produced nothing. Every counting query above filters
-- `status <> 'failed'`, which is what makes this reversal complete rather than
-- cosmetic.
--
-- IDEMPOTENT BY THE `status = 'pending'` GUARD: the edge function's catch-all
-- may reach here after a partial failure, and a double refund would hand back a
-- turn that was really spent.

CREATE OR REPLACE FUNCTION public.signer_ai_message_fail(
    p_message_id TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session_id TEXT;
    v_org_id     TEXT;
    v_day        DATE := (now() AT TIME ZONE 'utc')::DATE;
BEGIN
    UPDATE public.signer_ai_messages m
       SET status         = 'failed',
           failure_reason = p_reason,
           answered_at    = now()
     WHERE m.id = p_message_id
       AND m.status = 'pending'
    RETURNING m.session_id, m.organization_id INTO v_session_id, v_org_id;

    IF v_session_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.signer_ai_sessions s
       SET turn_count = greatest(s.turn_count - 1, 0)
     WHERE s.id = v_session_id;

    UPDATE public.ai_usage_daily u
       SET request_count = greatest(u.request_count - 1, 0), updated_at = now()
     WHERE u.day = v_day
       AND ((u.scope = 'org' AND u.scope_id = v_org_id)
         OR (u.scope = 'global' AND u.scope_id = '_global'));
END;
$$;


-- ---------------------------------------------------------------------------
-- PHASE 7: THE AUDIT EVENT
-- ---------------------------------------------------------------------------
-- EXACTLY ONE EVENT PER TOKEN, carrying NO question and NO answer text. The
-- edge function appends it on turn_index = 1 only — the `signer_token_redeemed`
-- first-use idiom.
--
-- WHY THE TRANSCRIPT STAYS OUT OF THE HASH CHAIN. Three reasons, the last of
-- which is decisive:
--
--   1. `signature_audit_append` takes FOR UPDATE on the request row. Chatting
--      would serialize the signing surface against a co-signer's
--      signing_submit — the same argument config.toml already makes for
--      verify_document.
--   2. A certificate rendering ten chat entries with a signature buried among
--      them is a worse evidence artifact than one that renders the ceremony.
--   3. A signer's questions are their own words about why they hesitate:
--      prejudicial and arguably privileged. The Certificate of Completion goes
--      to the COUNTERPARTY. Chaining the transcript would make it structurally
--      impossible to withhold — you cannot redact a chained entry without
--      destroying the signature's own evidentiary value. An evidence artifact
--      that can never lawfully be redacted is a defect, not rigour.
--
-- What the event DOES record is that the assistant was used at all, and which
-- extraction it answered from (`context_sha256`) — enough for a later dispute
-- to establish the fact and the document version without reproducing a word of
-- the conversation.
--
-- ⚠ NOTHING BELOW THIS LINE MAY APPEND AN AUDIT ROW. PostgreSQL forbids using
-- an enum value in the transaction that added it. The probe block in PHASE 9
-- deliberately exercises only the three routines above, none of which touch
-- signature_audit_log.

ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'signer_ai_question_asked';


-- ---------------------------------------------------------------------------
-- PHASE 8: GRANTS
-- ---------------------------------------------------------------------------
-- Supabase's default privileges grant EXECUTE to anon and authenticated on
-- every new function in `public`, so the safe state is NOT the default — a
-- migration that stays silent here creates an open SECURITY DEFINER function.
-- `signer_ai_message_begin` in particular writes a shared quota counter; open
-- to anon it would be a free unauthenticated way to exhaust the deployment.

REVOKE EXECUTE ON FUNCTION public.signer_ai_message_begin(TEXT, TEXT, TEXT)                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signer_ai_message_complete(TEXT, TEXT, TEXT, JSONB, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signer_ai_message_fail(TEXT, TEXT)                                     FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.signer_ai_message_begin(TEXT, TEXT, TEXT)                               TO service_role;
GRANT EXECUTE ON FUNCTION public.signer_ai_message_complete(TEXT, TEXT, TEXT, JSONB, BOOLEAN, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.signer_ai_message_fail(TEXT, TEXT)                                      TO service_role;

COMMENT ON FUNCTION public.signer_ai_message_begin(TEXT, TEXT, TEXT) IS
    'Opens one AI assistant exchange for a signer access token (CG-049). '
    'Enforces every limit — cooldown, hourly, per-token lifetime, per-request, '
    'per-org-daily and deployment-daily — inside the statement sequence so '
    'concurrent POSTs cannot race past them, and charges the counters BEFORE the '
    'model call. service_role only.';

COMMENT ON FUNCTION public.signer_ai_message_fail(TEXT, TEXT) IS
    'Refunds an exchange whose model call produced nothing (CG-049): marks it '
    'failed and gives back the session turn and both daily counters. Idempotent. '
    'Without it an upstream outage would burn a real allowance. service_role only.';


-- ---------------------------------------------------------------------------
-- PHASE 9: VERIFY
-- ---------------------------------------------------------------------------
-- The caps live inside statements where they cannot be checked by reading the
-- call site, and the refund reverses three counters at once. CG-015 set the
-- precedent for proving that here rather than trusting the prose above.

DO $$
DECLARE
    v_signer   TEXT;
    v_request  TEXT;
    v_org      TEXT;
    v_token    TEXT := '_cg049_probe_' || repeat('a', 52);
    v_token_id TEXT;
    v_r        RECORD;
    v_first    TEXT;
    v_day      DATE := (now() AT TIME ZONE 'utc')::DATE;
    v_org_before INTEGER;
    v_glob_before INTEGER;
    v_failed   TEXT[] := ARRAY[]::TEXT[];
    i          INTEGER;
BEGIN
    SELECT s.id, s.request_id, s.organization_id
      INTO v_signer, v_request, v_org
      FROM public.signature_request_signers s
     LIMIT 1;

    IF v_signer IS NULL THEN
        RAISE NOTICE 'CG-049: no signer rows to probe against; behavioural checks skipped.';
        RETURN;
    END IF;

    INSERT INTO public.signer_access_tokens
        (token_hash, signer_id, request_id, organization_id, purpose, expires_at, max_uses)
    VALUES
        (v_token, v_signer, v_request, v_org, 'sign', now() + interval '1 hour', 100)
    RETURNING id INTO v_token_id;

    SELECT COALESCE(max(u.request_count) FILTER (WHERE u.scope = 'org'), 0),
           COALESCE(max(u.request_count) FILTER (WHERE u.scope = 'global'), 0)
      INTO v_org_before, v_glob_before
      FROM public.ai_usage_daily u
     WHERE u.day = v_day
       AND ((u.scope = 'org' AND u.scope_id = v_org) OR (u.scope = 'global' AND u.scope_id = '_global'));

    SELECT * INTO v_r FROM public.signer_ai_message_begin(v_token_id, 'What is the term?', NULL);
    IF v_r.status IS DISTINCT FROM 'ok' THEN
        v_failed := v_failed || format('first question reported %s, expected ok', v_r.status);
    END IF;
    IF v_r.turn_index IS DISTINCT FROM 1 THEN
        v_failed := v_failed || format('first question got turn_index %s, expected 1', v_r.turn_index);
    END IF;
    v_first := v_r.message_id;

    -- The cooldown must bite on the very next call, or the endpoint is a
    -- scriptable way to spend a shared quota.
    SELECT * INTO v_r FROM public.signer_ai_message_begin(v_token_id, 'And the fee?', NULL);
    IF v_r.status IS DISTINCT FROM 'cooldown' THEN
        v_failed := v_failed || format('immediate second question reported %s, expected cooldown', v_r.status);
    END IF;
    IF COALESCE(v_r.retry_after_seconds, 0) <= 0 THEN
        v_failed := v_failed || 'cooldown did not report retry_after_seconds';
    END IF;

    -- Both ledgers moved by exactly one, and only one.
    IF (SELECT u.request_count FROM public.ai_usage_daily u
         WHERE u.scope = 'org' AND u.scope_id = v_org AND u.day = v_day) IS DISTINCT FROM v_org_before + 1 THEN
        v_failed := v_failed || 'one question did not move the org counter by exactly 1';
    END IF;
    IF (SELECT u.request_count FROM public.ai_usage_daily u
         WHERE u.scope = 'global' AND u.scope_id = '_global' AND u.day = v_day) IS DISTINCT FROM v_glob_before + 1 THEN
        v_failed := v_failed || 'one question did not move the global counter by exactly 1';
    END IF;

    -- The refund must restore all three counters exactly, and must be idempotent.
    PERFORM public.signer_ai_message_fail(v_first, 'probe');
    PERFORM public.signer_ai_message_fail(v_first, 'probe again');

    IF (SELECT s.turn_count FROM public.signer_ai_sessions s WHERE s.token_id = v_token_id) <> 0 THEN
        v_failed := v_failed || 'the refund did not restore turn_count';
    END IF;
    IF (SELECT u.request_count FROM public.ai_usage_daily u
         WHERE u.scope = 'org' AND u.scope_id = v_org AND u.day = v_day) IS DISTINCT FROM v_org_before THEN
        v_failed := v_failed || 'the refund did not restore the org counter (or refunded twice)';
    END IF;
    IF (SELECT u.request_count FROM public.ai_usage_daily u
         WHERE u.scope = 'global' AND u.scope_id = '_global' AND u.day = v_day) IS DISTINCT FROM v_glob_before THEN
        v_failed := v_failed || 'the refund did not restore the global counter (or refunded twice)';
    END IF;

    -- THE REGRESSION THIS PROBE EXISTS FOR: a refunded exchange still occupies
    -- its turn_index, so the next question must get the NEXT ordinal even though
    -- the charge counter went back to zero. Deriving one from the other makes
    -- every question after a failed one collide.
    UPDATE public.signer_ai_sessions s SET last_asked_at = now() - interval '1 minute'
     WHERE s.token_id = v_token_id;
    SELECT * INTO v_r FROM public.signer_ai_message_begin(v_token_id, 'after a refund', NULL);
    IF v_r.status IS DISTINCT FROM 'ok' THEN
        v_failed := v_failed || format('the question after a refund reported %s, expected ok', v_r.status);
    ELSIF v_r.turn_index IS DISTINCT FROM 2 THEN
        v_failed := v_failed || format('the question after a refund got turn_index %s, expected 2', v_r.turn_index);
    ELSE
        PERFORM public.signer_ai_message_fail(v_r.message_id, 'probe cleanup');
    END IF;

    -- The lifetime cap. Thirty answered turns, then a refusal — and the cooldown
    -- is stepped over rather than waited out, which is also a check that
    -- last_asked_at is what the cooldown reads.
    FOR i IN 1..30 LOOP
        UPDATE public.signer_ai_sessions s SET last_asked_at = now() - interval '1 minute'
         WHERE s.token_id = v_token_id;
        UPDATE public.signer_ai_messages m SET created_at = created_at - interval '2 hours'
         WHERE m.token_id = v_token_id;

        SELECT * INTO v_r FROM public.signer_ai_message_begin(v_token_id, 'probe ' || i, NULL);
        IF v_r.status IS DISTINCT FROM 'ok' THEN
            v_failed := v_failed || format('question %s reported %s, expected ok', i, v_r.status);
            EXIT;
        END IF;
        PERFORM public.signer_ai_message_complete(v_r.message_id, 'answered', 'probe answer');
    END LOOP;

    UPDATE public.signer_ai_sessions s SET last_asked_at = now() - interval '1 minute'
     WHERE s.token_id = v_token_id;

    SELECT * INTO v_r FROM public.signer_ai_message_begin(v_token_id, 'one too many', NULL);
    IF v_r.status IS DISTINCT FROM 'turn_limit' THEN
        v_failed := v_failed || format('the 31st question reported %s, expected turn_limit', v_r.status);
    END IF;
    IF COALESCE(v_r.turns_remaining, -1) <> 0 THEN
        v_failed := v_failed || 'turn_limit did not report zero turns remaining';
    END IF;

    -- A refused request must not have spent shared quota.
    IF (SELECT u.request_count FROM public.ai_usage_daily u
         WHERE u.scope = 'global' AND u.scope_id = '_global' AND u.day = v_day)
       IS DISTINCT FROM v_glob_before + 30 THEN
        v_failed := v_failed || 'the global counter does not match the 30 accepted questions';
    END IF;

    -- The disabled switch must refuse at the ENDPOINT, not merely hide the panel.
    UPDATE public.organizations o SET ai_assistant_enabled = false WHERE o.id = v_org;
    SELECT * INTO v_r FROM public.signer_ai_message_begin(v_token_id, 'still there?', NULL);
    IF v_r.status IS DISTINCT FROM 'disabled' THEN
        v_failed := v_failed || format('a disabled org reported %s, expected disabled', v_r.status);
    END IF;
    UPDATE public.organizations o SET ai_assistant_enabled = true WHERE o.id = v_org;

    -- A dead credential is refused, and indistinguishably from any other.
    UPDATE public.signer_access_tokens t SET revoked_at = now() WHERE t.id = v_token_id;
    SELECT * INTO v_r FROM public.signer_ai_message_begin(v_token_id, 'after revocation', NULL);
    IF v_r.status IS DISTINCT FROM 'invalid_token' THEN
        v_failed := v_failed || format('a revoked token reported %s, expected invalid_token', v_r.status);
    END IF;

    -- The question length cap is a CHECK, not a convention.
    BEGIN
        INSERT INTO public.signer_ai_messages
            (session_id, token_id, request_id, turn_index, question)
        SELECT s.id, v_token_id, v_request, 9999, repeat('x', 1001)
          FROM public.signer_ai_sessions s WHERE s.token_id = v_token_id;
        v_failed := v_failed || 'a 1001-character question was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    DELETE FROM public.signer_ai_messages WHERE token_id = v_token_id;
    DELETE FROM public.signer_ai_sessions WHERE token_id = v_token_id;
    DELETE FROM public.signer_access_tokens WHERE id = v_token_id;
    UPDATE public.ai_usage_daily u
       SET request_count = CASE WHEN u.scope = 'org' THEN v_org_before ELSE v_glob_before END
     WHERE u.day = v_day
       AND ((u.scope = 'org' AND u.scope_id = v_org) OR (u.scope = 'global' AND u.scope_id = '_global'));

    IF array_length(v_failed, 1) > 0 THEN
        RAISE EXCEPTION 'CG-049: the assistant throttle is wrong — %',
            array_to_string(v_failed, '; ');
    END IF;

    RAISE NOTICE 'CG-049: assistant throttle, refund and kill switch behave as the edge function assumes.';
END $$;


-- The grant check, SCOPED TO THE THREE FUNCTIONS THIS FILE CREATES. The
-- whole-schema sweep stays in CG-010, as a single maintained list rather than a
-- copy in every file that adds a function — see CG-031's note on why the
-- inline-allowlist pattern rotted.
DO $$
DECLARE
    v_leaks TEXT;
BEGIN
    SELECT string_agg(
               p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
               E'\n  ')
      INTO v_leaks
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.proname IN (
           'signer_ai_message_begin',
           'signer_ai_message_complete',
           'signer_ai_message_fail'
       )
       AND (
             has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
       );

    IF v_leaks IS NOT NULL THEN
        RAISE EXCEPTION E'CG-049: assistant function(s) reachable by anon/authenticated:\n  %', v_leaks;
    END IF;

    RAISE NOTICE 'CG-049: assistant functions are service_role only.';
END $$;

DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'signer_ai_document_context',
        'signer_ai_sessions',
        'signer_ai_messages',
        'ai_usage_daily'
    ] LOOP
        IF EXISTS (
            SELECT 1 FROM pg_policies
             WHERE schemaname = 'public' AND tablename = v_table
        ) THEN
            RAISE EXCEPTION
                'CG-049: % must have NO RLS policies; it holds contract text and transcripts.', v_table;
        END IF;

        IF NOT (
            SELECT c.relrowsecurity FROM pg_class c
             WHERE c.oid = ('public.' || v_table)::regclass
        ) THEN
            RAISE EXCEPTION 'CG-049: RLS is not enabled on %.', v_table;
        END IF;
    END LOOP;

    RAISE NOTICE 'CG-049: assistant tables verified — RLS on, zero policies.';
END $$;

DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT count(*) INTO v_count
      FROM pg_policies
     WHERE schemaname = 'public' AND 'anon' = ANY(roles);
    IF v_count > 0 THEN
        RAISE EXCEPTION 'CG-049: % RLS policy/policies target anon; expected 0.', v_count;
    END IF;
END $$;
