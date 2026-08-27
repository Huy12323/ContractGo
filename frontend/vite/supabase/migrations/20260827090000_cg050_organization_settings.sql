-- ===========================================================================
-- CG-050 — ORGANIZATION SETTINGS FOR OWNERS
-- ===========================================================================
--
-- Today an organization owner can do exactly two org-level things: rename the
-- organization, and delete it. Everything else an owner would expect to set up
-- is either missing or already in the database with no control anywhere:
--
--   * `ai_assistant_enabled` (CG-049) exists, defaults to true, is READ by
--     `signing_session_open`, and is WRITTEN BY NOTHING. CG-049's own header
--     says a law firm "must be able to turn off for themselves without a
--     deploy". The column shipped; the control never did.
--   * There are no branding columns, so every signing page and every email
--     looks identical regardless of who sent the document.
--   * There are no org-level envelope defaults, so an owner cannot set a house
--     policy for expiry, reminders or signer authentication.
--   * `entities.timezone` is read by nothing, and per `docs/entities.md` and
--     CG-030 that table must never grow a UI — so a timezone an owner can
--     actually set has to be a NEW column here.
--
-- This file adds those columns and then closes two holes that adding them
-- makes materially worse.
--
-- ---------------------------------------------------------------------------
-- THE LOGO IS A WORLD-READABLE OBJECT. Say it plainly, because it is a
-- deliberate reversal of the posture everything else under `orgs/` takes.
-- `cloudflare/workers/files` refuses any non-avatar key under `orgs/` without a
-- signed `?token=`. A branding logo has exactly two audiences — an ANONYMOUS
-- signer, and an EMAIL CLIENT — and neither can present a token. An email is
-- opened weeks later from an archive; the alternative, a very-long-TTL signed
-- URL, is strictly worse: a bearer credential that lives forever in a mailbox.
-- So logos get the avatar posture (unauthenticated read, unguessable key) and
-- the Worker learns `orgs/{id}/branding/{file}` as a public namespace.
--
-- THE CERTIFICATE STAYS UTC FOREVER. `timezone` below is presentation only.
-- Its first and only consumer is the deadline line in reminder/expiry mail
-- (`_shared/envelopeNotify.ts::formatUtcDate`). `_shared/certificate.text.ts`
-- states the rule this file must not be used to "fix": a bare local timestamp
-- in an evidentiary document is a timestamp nobody can reason about later.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- PHASE 1 — BRANDING
-- ===========================================================================
--
-- All three columns are NULLABLE WITH NO DEFAULT, and that is the decision.
-- NULL means "ContractGo's own look", which is what every existing row
-- silently already is. A `NOT NULL DEFAULT '#6366f1'` would make "never chose"
-- indistinguishable from "chose indigo", and the day the product palette moves
-- only the first group should move with it.

ALTER TABLE public.organizations
    ADD COLUMN logo_file_id      TEXT REFERENCES public.files(id) ON DELETE SET NULL,
    ADD COLUMN brand_color       TEXT,
    ADD COLUMN email_sender_name TEXT;

-- An FK into `files`, never a raw `r2_key` string — CG-037's rule, with
-- `profiles.avatar_file_id` as the exact precedent, `ON DELETE SET NULL` and
-- all. Deleting the file un-brands the org; it does not orphan a dead key.
CREATE INDEX idx_organizations_logo_file_id ON public.organizations (logo_file_id);

ALTER TABLE public.organizations
    ADD CONSTRAINT organizations_brand_color_check
        CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9A-Fa-f]{6}$'),

    -- This one is a SECURITY constraint, not validation. `email_sender_name`
    -- lands in the Resend `from:` header and inside email HTML, and
    -- `interpolate()` in `shared--send-email` escapes nothing. A newline
    -- injects SMTP headers; `<`, `>`, `"` and `,` break the
    -- `Name <addr@host>` grammar or the surrounding markup. The edge function
    -- escapes too, but the database is the layer that cannot be forgotten by
    -- a future caller.
    ADD CONSTRAINT organizations_email_sender_name_check
        CHECK (email_sender_name IS NULL OR (
            length(btrim(email_sender_name)) BETWEEN 1 AND 64
            AND email_sender_name !~ '[\r\n]'
            AND email_sender_name !~ '[<>",]'
        ));

COMMENT ON COLUMN public.organizations.logo_file_id IS
    'files row holding the org logo, uploaded to the PUBLIC namespace '
    'orgs/{id}/branding/{file}. World-readable by design: the audiences are an '
    'anonymous signer and an email client, neither of which can present a '
    'signed token. NULL = ContractGo default mark.';

COMMENT ON COLUMN public.organizations.brand_color IS
    'Accent colour as #RRGGBB, applied to the signing ceremony and outbound '
    'email. A PRESENTATION HINT ONLY — it must never gate behaviour. NULL = '
    'product default.';

COMMENT ON COLUMN public.organizations.email_sender_name IS
    'Display name in the outbound `from:` header. The ADDRESS never changes — '
    'it is the domain Resend verified, and moving it breaks SPF/DKIM. The '
    'CHECK on this column is a header-injection guard, not cosmetic validation.';


-- ===========================================================================
-- PHASE 2 — GENERAL
-- ===========================================================================
--
-- Reuses the dormant `public.iana_timezone` enum (AHR-644, 554 values) rather
-- than minting a twin — CG-032 set that precedent and said why. It also gives
-- the frontend `Supabase_Enums<"iana_timezone">` for free, so a value added in
-- SQL breaks the build rather than drifting.
--
-- `create_organization` and `ensure_personal_organization` are deliberately
-- NOT touched: both take the column default with zero edits, and reopening
-- them would mean restating the CG-010 REVOKE/GRANT allow-list for no gain.
--
-- `entities.timezone` is NOT backfilled from and NOT written to. It is 'UTC'
-- everywhere and read by nothing; copying it would imply a sync relationship
-- `docs/entities.md` spends a page denying. `entities` stays untouched.
--
-- No `locale` column: nothing in the app reads one and there is no i18n
-- library. Shipping the picker would recreate the exact defect this file
-- exists to fix.

ALTER TABLE public.organizations
    ADD COLUMN timezone public.iana_timezone NOT NULL DEFAULT 'UTC';

COMMENT ON COLUMN public.organizations.timezone IS
    'Presentation timezone for human-facing dates in outbound email. NOT used '
    'by the completion certificate, which stays UTC — see certificate.text.ts.';


-- ===========================================================================
-- PHASE 3 — DOCUMENT DEFAULTS
-- ===========================================================================
--
-- Names and types MIRROR `contract_templates` exactly (CG-013) so the fallback
-- at compose time is `a ?? b` and not a shape conversion.
--
-- The template columns carry no CHECK because every write to them passes
-- through `resolveSchedule`. These are written by PostgREST straight from the
-- settings screen with no edge function in the path, so the constraint has to
-- live in the database.

ALTER TABLE public.organizations
    ADD COLUMN default_expiry_days   INTEGER,
    ADD COLUMN default_reminder_days INTEGER[] NOT NULL DEFAULT '{}',
    ADD COLUMN default_signer_auth   public.signature_requests_signer_auth_enum
        NOT NULL DEFAULT 'account';

ALTER TABLE public.organizations
    -- 365 duplicates MAX_EXPIRY_DAYS in `_shared/envelopeCompose.ts`. The
    -- duplication is deliberate — the constraint must hold without the edge
    -- function — but if that constant moves, this moves with it.
    ADD CONSTRAINT organizations_default_expiry_days_check
        CHECK (default_expiry_days IS NULL
               OR (default_expiry_days > 0 AND default_expiry_days <= 365)),

    ADD CONSTRAINT organizations_default_reminder_days_check
        CHECK (cardinality(default_reminder_days) <= 10
               AND 0 < ALL (default_reminder_days)
               AND 365 >= ALL (default_reminder_days));

COMMENT ON COLUMN public.organizations.default_expiry_days IS
    'House default for envelope expiry. Precedence: explicit request body '
    '(including null = never) > template version > this > never expires.';

COMMENT ON COLUMN public.organizations.default_reminder_days IS
    'House default reminder cadence. Precedence: explicit request body '
    '(including [] = none) > template version if non-empty > this > {}.';

COMMENT ON COLUMN public.organizations.default_signer_auth IS
    'House default signer authentication, applied at all four compose call '
    'sites INCLUDING the public API — see docs/api.md. Precedence: explicit '
    'request body > this > account.';


-- ===========================================================================
-- PHASE 4 — ai_assistant_enabled
-- ===========================================================================
--
-- No DDL: CG-049 already added the column. The only thing this phase does is
-- name it in the PHASE 5 grant list below. Omit it there and the AI kill
-- switch silently stops being writable — which is the state it has been in
-- since CG-049 shipped.


-- ===========================================================================
-- PHASE 5a — CLOSE THE COLUMN-UNRESTRICTED UPDATE
-- ===========================================================================
--
-- "Only owner can update organization" is a row-level policy with no column
-- restriction, so an owner can PATCH ANY column of their own org — including
-- `owner_id` and `is_personal`. Adding nine writable columns above is the
-- moment to fix that, because the settings screen is the first client that
-- legitimately writes this table from the browser at all.
--
-- COLUMN PRIVILEGES, NOT A `BEFORE UPDATE` TRIGGER. CG-035 Phase 4 argued this
-- case verbatim for `profiles.whitelist`: a trigger makes an unauthorized
-- write succeed silently, a privilege makes it FAIL LOUDLY — and column
-- privileges are checked BEFORE RLS, so they hold regardless of any policy
-- added later.
--
-- ORDER IS THE WHOLE TRICK. Supabase's `GRANT ALL ON ALL TABLES` (re-applied
-- by CG-025) confers UPDATE at TABLE level, and a table-level grant subsumes
-- every column. A bare `REVOKE UPDATE (owner_id)` against it is a SILENT
-- NO-OP. The table grant must go first, then the columns come back one by one.

REVOKE UPDATE ON public.organizations FROM anon, authenticated;

GRANT UPDATE (
    name,
    updated_at,
    logo_file_id,
    brand_color,
    email_sender_name,
    timezone,
    default_expiry_days,
    default_reminder_days,
    default_signer_auth,
    ai_assistant_enabled
) ON public.organizations TO authenticated;

-- The columns deliberately NOT granted, so the omissions read as decisions:
--   id, created_at — identity and provenance.
--   is_personal    — CG-048. A user who could set this could occupy their own
--                    `idx_organizations_personal_owner` slot and permanently
--                    break `ensure_personal_organization`'s ON CONFLICT.
--   owner_id       — CG-023. `transfer_organization_ownership` enforces "the
--                    new owner is already in this organization"; a direct
--                    PATCH skips that rule entirely.
--
-- This breaks no server-side path: the creation and transfer RPCs are all
-- SECURITY DEFINER owned by the migration role, so privilege checks run
-- against the owner, and `service_role`/`postgres` keep their table grant.
-- THAT IS EXACTLY WHY THE VERIFY BLOCK BELOW MATTERS — a mistake here is
-- invisible to every migration, seed and psql check, and surfaces only when a
-- real user with a session presses Save.

COMMENT ON TABLE public.organizations IS
    'Tenant root. UPDATE for `authenticated` is COLUMN-WISE (CG-050 Phase 5a): '
    'the table-level grant is revoked and settable columns are granted one by '
    'one. Adding a column that the settings UI must write means adding a '
    'GRANT UPDATE (col) — a blanket GRANT UPDATE would silently re-open '
    'owner_id and is_personal.';


-- ===========================================================================
-- PHASE 5b — CLOSE THE INSERT HOLE
-- ===========================================================================
--
-- "Authenticated users can create organizations" has `WITH CHECK (true)`. It
-- dates from 20260401000000 and was never dropped — it references no function,
-- so the CG-010 CASCADE that swept the rest of that era missed it. Any session
-- can therefore POST an `organizations` row with an arbitrary `owner_id` and
-- `is_personal = true`.
--
-- Two real consequences, not theoretical ones:
--   1. Such an org gets NO ENTITY, because entity seeding lives inside
--      `create_organization` (CG-026). Per that file, an entity-less org is a
--      permanently dead Create button with no error message.
--   2. An `is_personal = true` row pre-empts the partial unique index that
--      `ensure_personal_organization`'s ON CONFLICT DO NOTHING depends on.
--
-- Safe to close: there is no `.from("organizations").insert()` anywhere in
-- `src/`, both creation paths are SECURITY DEFINER RPCs, and `seed.sql` runs
-- as `postgres`.

DROP POLICY IF EXISTS "Authenticated users can create organizations" ON public.organizations;
REVOKE INSERT ON public.organizations FROM anon, authenticated;


-- ===========================================================================
-- VERIFY
-- ===========================================================================

DO $$
BEGIN
    -- Phase 1-3: the columns exist with the shapes the frontend types assume.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'organizations'
          AND column_name = 'logo_file_id'
    ) THEN
        RAISE EXCEPTION 'CG-050 incomplete — organizations.logo_file_id missing';
    END IF;

    IF (
        SELECT udt_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'organizations'
          AND column_name = 'timezone'
    ) IS DISTINCT FROM 'iana_timezone' THEN
        RAISE EXCEPTION
            'CG-050 incomplete — organizations.timezone is not public.iana_timezone';
    END IF;

    IF (
        SELECT udt_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'organizations'
          AND column_name = 'default_signer_auth'
    ) IS DISTINCT FROM 'signature_requests_signer_auth_enum' THEN
        RAISE EXCEPTION
            'CG-050 incomplete — default_signer_auth is not the shared signer-auth enum';
    END IF;

    -- Phase 5a, both directions. Assert what MUST be writable...
    IF NOT has_column_privilege('authenticated', 'public.organizations', 'name', 'UPDATE') THEN
        RAISE EXCEPTION 'CG-050 broke renaming — authenticated cannot UPDATE organizations.name';
    END IF;

    IF NOT has_column_privilege('authenticated', 'public.organizations', 'ai_assistant_enabled', 'UPDATE') THEN
        RAISE EXCEPTION
            'CG-050 incomplete — authenticated still cannot UPDATE organizations.ai_assistant_enabled '
            '(the CG-049 kill switch stays unwritable — see PHASE 4)';
    END IF;

    IF NOT has_column_privilege('authenticated', 'public.organizations', 'brand_color', 'UPDATE') THEN
        RAISE EXCEPTION 'CG-050 incomplete — authenticated cannot UPDATE organizations.brand_color';
    END IF;

    -- ...and what MUST NOT be. These two are the whole point of PHASE 5a; if
    -- they pass, the REVOKE above was a no-op and the grant order is wrong.
    IF has_column_privilege('authenticated', 'public.organizations', 'owner_id', 'UPDATE') THEN
        RAISE EXCEPTION
            'CG-050 PHASE 5a failed — authenticated can still UPDATE organizations.owner_id. '
            'The table-level REVOKE must precede the column GRANTs.';
    END IF;

    IF has_column_privilege('authenticated', 'public.organizations', 'is_personal', 'UPDATE') THEN
        RAISE EXCEPTION
            'CG-050 PHASE 5a failed — authenticated can still UPDATE organizations.is_personal (CG-048)';
    END IF;

    -- Phase 5b.
    IF has_table_privilege('authenticated', 'public.organizations', 'INSERT') THEN
        RAISE EXCEPTION
            'CG-050 PHASE 5b failed — authenticated can still INSERT into organizations';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'organizations'
          AND cmd = 'INSERT'
    ) THEN
        RAISE EXCEPTION
            'CG-050 PHASE 5b failed — an INSERT policy still exists on organizations';
    END IF;

    -- Server-side paths must be unaffected.
    IF NOT has_column_privilege('service_role', 'public.organizations', 'owner_id', 'UPDATE') THEN
        RAISE EXCEPTION 'CG-050 over-reached — service_role lost UPDATE on organizations.owner_id';
    END IF;
END $$;
