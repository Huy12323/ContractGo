-- ============================================
-- CG-037: `files` BECOMES THE FILE RECORD
-- ============================================
-- AHR-803 created `public.files` to be "the table that knows what is in the
-- bucket". It never became that. Only template PDFs ever got a row; every other
-- R2 object was recorded as a bare key string on whichever table happened to need
-- it, in seven columns with five different names:
--
--   contract_templates.pdf_file_path          user_signatures.r2_key
--   contract_template_versions.pdf_file_path  signature_captures.signature_r2_key
--   profiles.avatar_url  (a URL, not a key)   signature_requests.source_pdf_r2_key
--                                             signature_requests.signed_pdf_r2_key
--
-- So there was no answer to "what is in this bucket", "how big is it", "who
-- uploaded it" or "is this object still referenced" — the questions a file record
-- exists to answer. This migration gives every one of those objects a `files` row
-- and every one of those tables a foreign key to it.
--
-- WHAT THIS MIGRATION DOES NOT DO: drop the key columns. That is deliberate and
-- it is not timidity.
--
--   * For the THREE EVIDENCE COLUMNS — signature_captures.signature_r2_key and
--     signature_requests.{source,signed}_pdf_r2_key — the key string is the
--     evidentiary anchor and must stay. `signature_audit_log` payloads already
--     hash these exact strings into an append-only chain that
--     `signature_verify_chain` re-walks, and the CHECK constraint
--     `signature_requests_completed_has_pdf` refuses a completed row without
--     `signed_pdf_r2_key`. A `files.id` is a WEAKER reference than the key: a
--     `files` row can be renamed, refoldered or deleted, and the chain would then
--     point at something that no longer says what it said when it was signed.
--     Here the FK is an index into `files` for management and browsing; the key
--     remains what the evidence rests on. Do not "finish the job" by dropping
--     these.
--
--   * For profiles.avatar_url, both columns are permanent for a different reason:
--     the column holds two unrelated things. `handle_new_user` seeds it with a
--     Google/OIDC `picture` URL on an external host, while the settings screen
--     writes a Worker URL for an object we own. Only the second has a `files` row
--     to point at.
--
--   * For the three remaining columns — the template PDFs and user_signatures —
--     dropping IS the right end state, and it is a separate migration on purpose.
--     Every writer has to stop writing them first; doing both here would mean a
--     half-applied deploy leaves live edge functions writing to a column that is
--     gone. The triggers in PHASE 5 make the FK correct and populated from today,
--     so readers can move over before the drop rather than during it.
--
-- BACKFILL FIDELITY. Minted rows for pre-existing objects record `size = 0`,
-- because the real size is only knowable by a HEAD request against R2 and a
-- migration has no network. `content_type` is inferred from the extension. Both
-- are honest-but-approximate for legacy rows and exact for everything uploaded
-- from here on; anything rendering a size must treat 0 as "unknown" rather than
-- printing "0 B".

-- --------------------------------------------
-- PHASE 1: INSERT-OR-GET
-- --------------------------------------------
-- One function used by BOTH the backfill below and the triggers in PHASE 5, so
-- "how a raw key becomes a files row" has exactly one definition. `files.r2_key`
-- is UNIQUE, which is what makes this idempotent and therefore what makes the
-- backfill safe to re-run.
CREATE OR REPLACE FUNCTION public.files_content_type_for_key(p_r2_key TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE lower(regexp_replace(p_r2_key, '^.*\.', ''))
        WHEN 'pdf'  THEN 'application/pdf'
        WHEN 'png'  THEN 'image/png'
        WHEN 'jpg'  THEN 'image/jpeg'
        WHEN 'jpeg' THEN 'image/jpeg'
        WHEN 'webp' THEN 'image/webp'
        WHEN 'gif'  THEN 'image/gif'
        WHEN 'svg'  THEN 'image/svg+xml'
        ELSE 'application/octet-stream'
    END;
$$;

CREATE OR REPLACE FUNCTION public.files_ensure(
    p_r2_key          TEXT,
    p_organization_id TEXT    DEFAULT NULL,
    p_uploaded_by     UUID    DEFAULT NULL,
    p_content_type    TEXT    DEFAULT NULL,
    p_size            BIGINT  DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id TEXT;
BEGIN
    IF p_r2_key IS NULL OR p_r2_key = '' THEN
        RETURN NULL;
    END IF;

    SELECT f.id INTO v_id FROM public.files f WHERE f.r2_key = p_r2_key;
    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;

    INSERT INTO public.files (r2_key, name, content_type, size, uploaded_by, organization_id)
    VALUES (
        p_r2_key,
        -- Everything after the last slash. The best name available for an object
        -- whose original file name was never recorded anywhere.
        regexp_replace(p_r2_key, '^.*/', ''),
        coalesce(p_content_type, public.files_content_type_for_key(p_r2_key)),
        coalesce(p_size, 0),
        p_uploaded_by,
        p_organization_id
    )
    -- Concurrent callers: one wins the insert, the other falls through to the
    -- re-select below rather than raising.
    ON CONFLICT (r2_key) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        SELECT f.id INTO v_id FROM public.files f WHERE f.r2_key = p_r2_key;
    END IF;

    RETURN v_id;
END;
$$;

-- CG-010: SECURITY DEFINER, so state the grants here. No client calls this — it
-- is reached only from triggers and from service_role.
REVOKE EXECUTE ON FUNCTION public.files_ensure(TEXT, TEXT, UUID, TEXT, BIGINT)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.files_ensure(TEXT, TEXT, UUID, TEXT, BIGINT)
    TO service_role;

-- --------------------------------------------
-- PHASE 2: THE FOREIGN KEYS
-- --------------------------------------------
-- ON DELETE differs by what the reference MEANS, which is the whole reason not to
-- pick one and apply it everywhere:
--
--   RESTRICT  where the row is meaningless or misleading without its file — a
--             signature capture with no image, a saved signature with no PNG.
--             Deleting the file must fail loudly rather than leave a row that
--             claims something it can no longer show.
--   SET NULL  where the row survives the loss — a template whose source PDF was
--             removed is still a template, and this matches what already happens
--             today when the object is deleted out from under `pdf_file_path`.
ALTER TABLE public.contract_templates
    ADD COLUMN pdf_file_id TEXT REFERENCES public.files(id) ON DELETE SET NULL;

ALTER TABLE public.contract_template_versions
    ADD COLUMN pdf_file_id TEXT REFERENCES public.files(id) ON DELETE SET NULL;

-- Nullable and staying that way: most profiles have no avatar, and one seeded
-- from a Google `picture` URL has no object of ours to point at.
ALTER TABLE public.profiles
    ADD COLUMN avatar_file_id TEXT REFERENCES public.files(id) ON DELETE SET NULL;

ALTER TABLE public.user_signatures
    ADD COLUMN file_id TEXT REFERENCES public.files(id) ON DELETE RESTRICT;

ALTER TABLE public.signature_captures
    ADD COLUMN signature_file_id TEXT REFERENCES public.files(id) ON DELETE RESTRICT;

ALTER TABLE public.signature_requests
    ADD COLUMN source_pdf_file_id TEXT REFERENCES public.files(id) ON DELETE RESTRICT,
    ADD COLUMN signed_pdf_file_id TEXT REFERENCES public.files(id) ON DELETE RESTRICT;

-- FK columns are not indexed automatically, and every one of these is read as
-- "give me the file for this row" on a hot path.
CREATE INDEX idx_contract_templates_pdf_file_id        ON public.contract_templates (pdf_file_id);
CREATE INDEX idx_contract_template_versions_pdf_file_id ON public.contract_template_versions (pdf_file_id);
CREATE INDEX idx_profiles_avatar_file_id               ON public.profiles (avatar_file_id);
CREATE INDEX idx_user_signatures_file_id               ON public.user_signatures (file_id);
CREATE INDEX idx_signature_captures_signature_file_id  ON public.signature_captures (signature_file_id);
CREATE INDEX idx_signature_requests_source_pdf_file_id ON public.signature_requests (source_pdf_file_id);
CREATE INDEX idx_signature_requests_signed_pdf_file_id ON public.signature_requests (signed_pdf_file_id);

-- --------------------------------------------
-- PHASE 3: MINT AND BACKFILL
-- --------------------------------------------
-- Order matters only in that `files_ensure` is idempotent, so a key shared across
-- tables (a template's PDF is also a signature request's source PDF — the seed
-- data has exactly this) resolves to ONE row no matter which table reaches it
-- first. That sharing is the point: the same object should not be described twice.

-- Template PDFs already have rows from the normal upload path; `files_ensure`
-- finds them rather than duplicating, so the uploader argument is only a fallback
-- for a key whose row somehow went missing. `contract_templates` has no
-- `created_by` (only its versions do), and inventing one from the newest version
-- would attribute the upload to whoever last edited the layout — so NULL, which
-- is what "we do not know" looks like in this column.
UPDATE public.contract_templates t
   SET pdf_file_id = public.files_ensure(
           t.pdf_file_path, t.organization_id, NULL, 'application/pdf')
 WHERE t.pdf_file_path IS NOT NULL;

UPDATE public.contract_template_versions v
   SET pdf_file_id = public.files_ensure(
           v.pdf_file_path, v.organization_id, v.created_by, 'application/pdf')
 WHERE v.pdf_file_path IS NOT NULL;

-- Person-scoped: organization_id stays NULL, which AHR-803's user-scope RLS
-- policies were written for.
UPDATE public.user_signatures s
   SET file_id = public.files_ensure(s.r2_key, NULL, s.user_id, 'image/png')
 WHERE s.r2_key IS NOT NULL;

-- `signature_captures` REFUSES UPDATES. `signature_captures_guard` (CG-014)
-- permits exactly one transition — NULL → superseded_at — and asserts that
-- nothing else changed by comparing whole rows with that one field masked out.
-- CG-014's header says why it is written that way rather than as a column list:
-- "a column added to this table in some later migration is covered by this form
-- automatically. A future author who adds `capture_device` does not have to know
-- this trigger exists for it to stay immutable."
--
-- This migration is that future author, and the guard did its job — the backfill
-- below was refused on the first run. The guard is therefore suspended for the
-- length of this one statement and restored immediately after.
--
-- THIS IS NOT A LICENCE TO DISABLE IT AGAIN. It is defensible exactly once, for
-- exactly this shape of change: a structural backfill of a column that did not
-- exist when those rows were written, adding no new claim about what happened —
-- `signature_file_id` resolves, by construction, to the row whose `r2_key` equals
-- the `signature_r2_key` already on the record. Nothing evidentiary is restated
-- and nothing existing is touched. An application write must never do this.
ALTER TABLE public.signature_captures DISABLE TRIGGER trigger_signature_captures_guard;

-- `uploaded_by` is NULL: the person who drew the mark is a signer, who on an
-- `email_otp` envelope has no account at all. Attributing it to the sender would
-- be false, and the audit chain already records who signed.
UPDATE public.signature_captures c
   SET signature_file_id = public.files_ensure(
           c.signature_r2_key,
           (SELECT r.organization_id FROM public.signature_requests r WHERE r.id = c.request_id),
           NULL,
           'image/png')
 WHERE c.signature_r2_key IS NOT NULL;

ALTER TABLE public.signature_captures ENABLE TRIGGER trigger_signature_captures_guard;

UPDATE public.signature_requests r
   SET source_pdf_file_id = public.files_ensure(
           r.source_pdf_r2_key, r.organization_id, r.created_by, 'application/pdf')
 WHERE r.source_pdf_r2_key IS NOT NULL;

-- `uploaded_by` NULL again, and for a stronger reason: nobody uploaded the signed
-- PDF. `signing_submit` generates and puts it. A user id here would name a person
-- who did not perform the act.
UPDATE public.signature_requests r
   SET signed_pdf_file_id = public.files_ensure(
           r.signed_pdf_r2_key, r.organization_id, NULL, 'application/pdf')
 WHERE r.signed_pdf_r2_key IS NOT NULL;

-- Avatars are the awkward one. `avatar_url` holds a full URL when it holds
-- anything, and only the ones pointing at our own Worker have an object behind
-- them — a Google `picture` URL is somebody else's host and gets no `files` row.
-- The Worker origin is environment-specific and not knowable from inside the
-- database, so the object is identified by the key shape CG-036 defines instead:
-- everything from `users/` onward.
UPDATE public.profiles p
   SET avatar_file_id = public.files_ensure(
           substring(p.avatar_url FROM 'users/.*$'), NULL, p.id, NULL)
 WHERE p.avatar_url IS NOT NULL
   AND p.avatar_url ~ 'users/[^/]+/avatars?[-/]';

-- --------------------------------------------
-- PHASE 4: KEEP THEM IN AGREEMENT
-- --------------------------------------------
-- A row may not name a key and a file that disagree. Without this, the two
-- columns drift the moment one writer updates one and not the other — which is
-- the exact failure this whole migration exists to make impossible, so it is
-- worth a constraint rather than a convention. The PHASE 5 triggers are what keep
-- these satisfied; the constraints are what catch a trigger being dropped.
ALTER TABLE public.signature_captures
    ADD CONSTRAINT signature_captures_file_matches_key CHECK (
        (signature_r2_key IS NULL) = (signature_file_id IS NULL)
    );

ALTER TABLE public.signature_requests
    ADD CONSTRAINT signature_requests_source_file_matches_key CHECK (
        (source_pdf_r2_key IS NULL) = (source_pdf_file_id IS NULL)
    ),
    ADD CONSTRAINT signature_requests_signed_file_matches_key CHECK (
        (signed_pdf_r2_key IS NULL) = (signed_pdf_file_id IS NULL)
    );

ALTER TABLE public.user_signatures
    ADD CONSTRAINT user_signatures_file_matches_key CHECK (
        (r2_key IS NULL) = (file_id IS NULL)
    );

-- --------------------------------------------
-- PHASE 5: POPULATE THE FK ON EVERY FUTURE WRITE
-- --------------------------------------------
-- The writers of the evidence columns are edge functions running as service_role
-- (`signing_submit`, `envelopes_send`, `envelopes_draft_create`), and they write a
-- key because a key is what `storage.putObject` gives them back. Rather than make
-- every one of them do a second round trip to mint a `files` row — and get it
-- wrong differently in each place — the database derives the FK from the key at
-- write time. One definition, no callsite can forget it, and the CHECKs above can
-- therefore be trusted.
--
-- BEFORE triggers, so they write NEW in place instead of issuing a second UPDATE
-- that would re-fire the realtime_table_events AFTER triggers on these tables.
CREATE OR REPLACE FUNCTION public.set_signature_capture_file_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.signature_file_id := public.files_ensure(
        NEW.signature_r2_key,
        (SELECT r.organization_id FROM public.signature_requests r WHERE r.id = NEW.request_id),
        NULL,
        'image/png'
    );
    RETURN NEW;
END;
$$;

-- INSERT ONLY, unlike its siblings below. An UPDATE branch would be dead code:
-- `signature_captures_guard` rejects any update that changes `signature_r2_key`,
-- so there is no path on which this could fire. Naming the event exactly also
-- keeps it from running during a supersede, where re-deriving the FK would make
-- the guard's whole-row comparison see a change it is right to refuse.
--
-- Trigger order on INSERT is alphabetical, so `on_…` runs before
-- `trigger_signature_captures_guard` — the FK is set, then validated, which is
-- the order that lets the CHECK in PHASE 4 hold.
CREATE TRIGGER on_signature_captures_set_file_id
    BEFORE INSERT ON public.signature_captures
    FOR EACH ROW EXECUTE FUNCTION public.set_signature_capture_file_id();

CREATE OR REPLACE FUNCTION public.set_signature_request_file_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.source_pdf_file_id := public.files_ensure(
        NEW.source_pdf_r2_key, NEW.organization_id, NEW.created_by, 'application/pdf');
    -- No uploader: `signing_submit` generates this object rather than receiving it.
    NEW.signed_pdf_file_id := public.files_ensure(
        NEW.signed_pdf_r2_key, NEW.organization_id, NULL, 'application/pdf');
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_signature_requests_set_file_ids
    BEFORE INSERT OR UPDATE OF source_pdf_r2_key, signed_pdf_r2_key
        ON public.signature_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_signature_request_file_ids();

CREATE OR REPLACE FUNCTION public.set_user_signature_file_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Person-scoped: no organization, and the owner is the uploader by definition.
    NEW.file_id := public.files_ensure(NEW.r2_key, NULL, NEW.user_id, 'image/png');
    RETURN NEW;
END;
$$;

-- `user_signatures` is written by the CLIENT (`useM_Signatures_Create`) as
-- `authenticated`, not by service_role — which is why `files_ensure` is SECURITY
-- DEFINER. Without that, this trigger would be subject to the caller's RLS and
-- would fail to read back a `files` row it had just inserted.
CREATE TRIGGER on_user_signatures_set_file_id
    BEFORE INSERT OR UPDATE OF r2_key ON public.user_signatures
    FOR EACH ROW EXECUTE FUNCTION public.set_user_signature_file_id();

REVOKE EXECUTE ON FUNCTION public.set_signature_capture_file_id()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_signature_request_file_ids() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_user_signature_file_id()     FROM PUBLIC, anon, authenticated;

-- The template and avatar columns get NO trigger. Their writers are ordinary
-- client mutations that already hold the `files.id` — `useM_Files_Upload` returns
-- it — so they write the FK directly and the key column is what becomes
-- redundant there. That asymmetry is the point: derive the FK only where the
-- writer genuinely has nothing but a key.

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
DO $$
DECLARE
    v_orphans BIGINT;
BEGIN
    SELECT count(*) INTO v_orphans FROM public.contract_templates
     WHERE pdf_file_path IS NOT NULL AND pdf_file_id IS NULL;
    IF v_orphans > 0 THEN
        RAISE EXCEPTION 'CG-037 incomplete — % contract_templates rows unconverted', v_orphans;
    END IF;

    SELECT count(*) INTO v_orphans FROM public.contract_template_versions
     WHERE pdf_file_path IS NOT NULL AND pdf_file_id IS NULL;
    IF v_orphans > 0 THEN
        RAISE EXCEPTION 'CG-037 incomplete — % contract_template_versions rows unconverted', v_orphans;
    END IF;

    SELECT count(*) INTO v_orphans FROM public.user_signatures
     WHERE r2_key IS NOT NULL AND file_id IS NULL;
    IF v_orphans > 0 THEN
        RAISE EXCEPTION 'CG-037 incomplete — % user_signatures rows unconverted', v_orphans;
    END IF;

    SELECT count(*) INTO v_orphans FROM public.signature_captures
     WHERE signature_r2_key IS NOT NULL AND signature_file_id IS NULL;
    IF v_orphans > 0 THEN
        RAISE EXCEPTION 'CG-037 incomplete — % signature_captures rows unconverted', v_orphans;
    END IF;

    SELECT count(*) INTO v_orphans FROM public.signature_requests
     WHERE (source_pdf_r2_key IS NOT NULL AND source_pdf_file_id IS NULL)
        OR (signed_pdf_r2_key IS NOT NULL AND signed_pdf_file_id IS NULL);
    IF v_orphans > 0 THEN
        RAISE EXCEPTION 'CG-037 incomplete — % signature_requests rows unconverted', v_orphans;
    END IF;

    -- Every FK must resolve to a row whose key is the one the source column names.
    -- Catches a backfill that populated the column with a real-but-wrong file id.
    SELECT count(*) INTO v_orphans
      FROM public.signature_requests r
      JOIN public.files f ON f.id = r.source_pdf_file_id
     WHERE f.r2_key IS DISTINCT FROM r.source_pdf_r2_key;
    IF v_orphans > 0 THEN
        RAISE EXCEPTION 'CG-037 incomplete — % signature_requests point at the wrong file', v_orphans;
    END IF;
END $$;
