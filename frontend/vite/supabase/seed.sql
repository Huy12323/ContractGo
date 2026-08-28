-- Seed data for local development.
--
-- Profiles are auto-created from `auth.users` by the `on_auth_user_created`
-- trigger, so nothing here inserts into `public.profiles` directly.
--
-- NOTE ON WHEN THIS RUNS: `supabase db reset` is BANNED in this project (see
-- CLAUDE.md and the /backup skill) because it destroys seed data that took real
-- effort to build. So this file is not the live source of the local database —
-- it is the record of how to rebuild a working login from nothing. Anything
-- added here must ALSO be applied to the running database to take effect, and
-- must be written idempotently so applying it twice is harmless.
--
-- ORDER MATTERS. The file runs in four passes, and each one needs the previous:
--   1. accounts       — auth.users + auth.identities + verified profiles
--   2. organizations  — organizations + entities, owned by those profiles
--   3. roles          — admins / members rows wiring pass 1 to pass 2
--   4. invitations    — pending, expired and rejected rows for the People page
--
-- Passes 1 and 2 used to be entangled: the account blocks attached roles inline,
-- against "every organization that exists" — and this file created none, so on a
-- fresh database they attached nothing and every seeded account landed on the
-- empty-state home page. Roles now live in their own pass, after the things they
-- reference actually exist.
--
-- WHERE THE TEMPLATES AND ENVELOPES COME FROM: `scripts/seed-demo-contractgo.js`,
-- not this file, and they cannot be moved here. Every interesting column on a
-- signature request is DERIVED — `source_pdf_sha256` must be the true digest of
-- bytes that exist in storage, `template_snapshot` must match the pinned version,
-- signer links are hashed credentials, and `signature_audit_log` is a hash chain
-- whose every entry covers the last one's `entry_hash`. SQL can fabricate rows
-- that satisfy the constraints and still fail every reader. That script signs in
-- as `admin@test.com` and drives the real edge functions instead. Run it after
-- this file:  node scripts/seed-demo-contractgo.js
-- ============================================================
-- Test admin account — admin@test.com / 123456789
-- ============================================================
-- Password matches the `seed-*@wcltest.local` accounts activated by migration
-- `20260515140000_activate_seed_accounts.sql`, so there is one password to
-- remember for local work rather than one per account.
--
-- This is the primary account: OWNER of Northwind Legal and ADMIN of Ridgeline
-- Ventures (pass 3), so owner-only and admin-only behaviour are both reachable
-- without logging out. Admin is what `is_admin_or_owner()` gates on, so it can
-- do everything a sender needs in either org — create templates, compose and
-- send envelopes, void, resend, download — while only Northwind exposes the
-- rename form and the Danger Zone.
--
-- It deliberately gets NO `members` row. Membership is for internal people who
-- are not administrators; an admin already passes `is_org_member()` through the
-- admins table, and holding two tiers at once is what CG-024 removed from
-- `create_organization` — it made the owner appear twice on the People page.
--
-- An external SIGNER needs no MEMBERSHIP — that is the whole point of
-- `signer_access_tokens`, and nothing about a signer belongs in the org tables.
-- They DO need a ContractGo account on their own address to sign or decline:
-- `signing_submit` and `signing_decline` match the caller's session against
-- `signer_email` (see `_shared/signerAuth.ts::assertSignerAccount`), while
-- opening and reading the document still needs only the link.
--
-- So to test the full flow end to end: send an envelope, create an account on
-- the recipient's email (the sign step's "Sign in to continue" leads to the
-- login page, which offers sign-up and carries the return path), then open the
-- recipient's link as the RECIPIENT: sign in on that account and use
-- `signing_link_for_me` (the notification/document row that opens the signing
-- surface), which mints their own credential from their own session. There is
-- deliberately no sender-side way to read it. The link is also printed to the
-- edge-function log when EMAIL_DRIVER=console; under EMAIL_DRIVER=resend it is
-- only in the recipient's inbox.

DO $$
DECLARE
    v_user_id UUID;
BEGIN
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'admin@test.com';

    IF v_user_id IS NULL THEN
        v_user_id := gen_random_uuid();

        -- Every string token column is '' and never NULL. GoTrue scans these
        -- with Go's `string` rather than `*string`, so a NULL makes sign-in fail
        -- with "converting NULL to string is unsupported" — the same trap
        -- documented in the activate_seed_accounts migration.
        INSERT INTO auth.users (
            id, instance_id, aud, role, email,
            encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data,
            confirmation_token, recovery_token,
            email_change_token_new, email_change_token_current,
            reauthentication_token, phone_change_token,
            email_change, phone_change,
            created_at, updated_at
        )
        VALUES (
            v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'admin@test.com',
            crypt('123456789', gen_salt('bf', 10)), now(),
            '{"provider": "email", "providers": ["email"]}'::jsonb,
            jsonb_build_object(
                'sub', v_user_id::text,
                'email', 'admin@test.com',
                'full_name', 'Test Admin',
                'email_verified', true,
                'phone_verified', false
            ),
            '', '', '', '', '', '', '', '',
            now(), now()
        );
    END IF;

    -- Identity row. Without it GoTrue accepts the password but reports the
    -- account as having no linked provider, so it is part of creating the user,
    -- not an optional extra.
    INSERT INTO auth.identities (
        id, user_id, provider_id, provider, identity_data,
        last_sign_in_at, created_at, updated_at
    )
    SELECT
        gen_random_uuid(), v_user_id, v_user_id::text, 'email',
        jsonb_build_object(
            'sub', v_user_id::text,
            'email', 'admin@test.com',
            'email_verified', true,
            'phone_verified', false
        ),
        now(), now(), now()
    WHERE NOT EXISTS (
        SELECT 1 FROM auth.identities
        WHERE user_id = v_user_id AND provider = 'email'
    );

    -- The trigger fills `full_name` from metadata on INSERT only, so set it
    -- explicitly for the case where the user already existed.
    --
    -- `email_verified` is this project's OWN flag, not GoTrue's. Supabase runs
    -- with enable_confirmations=false and verification is self-managed through
    -- `auth_tokens` + the `auth_verify-token` edge function, so setting
    -- `auth.users.email_confirmed_at` above is NOT enough: `_protected/route.tsx`
    -- reads `profiles.email_verified` and bounces the session to /verify-email
    -- while it is false. A seeded account must have both.
    UPDATE public.profiles
       SET full_name = COALESCE(NULLIF(full_name, ''), 'Test Admin'),
           email_verified = true
     WHERE id = v_user_id;

    -- Roles are attached in pass 3, once the organizations exist.
    RAISE NOTICE 'Seeded account admin@test.com (%).', v_user_id;
END $$;

-- ============================================================
-- Additional pre-verified accounts — <email> / 123456789
-- ============================================================
-- Accounts that can sign in and land straight in the app, with no email
-- confirmation step. "Verified" here means all four of:
--   1. `auth.users.email_confirmed_at` set          (GoTrue lets the session start)
--   2. an `auth.identities` row for the email provider (GoTrue links the password)
--   3. `profiles.email_verified = true`             (this app's own gate — see the
--      note in the admin@test.com block above; without it `_protected/route.tsx`
--      redirects to /verify-email no matter what GoTrue thinks)
--   4. every `auth.users` string token column '' and never NULL
--
-- This block only CREATES the accounts. What each one ends up being is decided
-- in pass 3:
--
--   admin2@test.com  — owner of Ridgeline Ventures, admin of Northwind Legal.
--                      The mirror image of admin@test.com, so admin-vs-admin and
--                      owner-vs-admin behaviour are both testable from two live
--                      sessions without either account being privileged in both.
--   member@test.com   — `members` row in each org's oldest entity. Internal person
--                      who is NOT an administrator: passes `is_org_member()`,
--                      fails `is_admin_or_owner()`. This is the account to use
--                      when checking that a sender-only UI is properly gated.
--   newuser@test.com  — verified but belongs to NO organization. Exercises the
--                      empty-state / "create or join an org" path, which a
--                      freshly verified real signup also hits.
--
-- No external SIGNER account is seeded here — see the note above; signers
-- authenticate through `signer_access_tokens`, not through auth.users.

DO $$
DECLARE
    v_account   RECORD;
    v_user_id   UUID;
BEGIN
    FOR v_account IN
        SELECT * FROM (VALUES
            ('admin2@test.com',  'Second Admin'   ),
            ('member@test.com',  'Test Member'    ),
            ('newuser@test.com', 'Verified No Org')
        ) AS t(email, full_name)
    LOOP
        -- SELECT INTO leaves v_user_id NULL when the account does not exist yet,
        -- which is also what resets it between iterations.
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_account.email;

        IF v_user_id IS NULL THEN
            v_user_id := gen_random_uuid();

            INSERT INTO auth.users (
                id, instance_id, aud, role, email,
                encrypted_password, email_confirmed_at,
                raw_app_meta_data, raw_user_meta_data,
                confirmation_token, recovery_token,
                email_change_token_new, email_change_token_current,
                reauthentication_token, phone_change_token,
                email_change, phone_change,
                created_at, updated_at
            )
            VALUES (
                v_user_id, '00000000-0000-0000-0000-000000000000',
                'authenticated', 'authenticated',
                v_account.email,
                crypt('123456789', gen_salt('bf', 10)), now(),
                '{"provider": "email", "providers": ["email"]}'::jsonb,
                jsonb_build_object(
                    'sub', v_user_id::text,
                    'email', v_account.email,
                    'full_name', v_account.full_name,
                    'email_verified', true,
                    'phone_verified', false
                ),
                '', '', '', '', '', '', '', '',
                now(), now()
            );
        END IF;

        INSERT INTO auth.identities (
            id, user_id, provider_id, provider, identity_data,
            last_sign_in_at, created_at, updated_at
        )
        SELECT
            gen_random_uuid(), v_user_id, v_user_id::text, 'email',
            jsonb_build_object(
                'sub', v_user_id::text,
                'email', v_account.email,
                'email_verified', true,
                'phone_verified', false
            ),
            now(), now(), now()
        WHERE NOT EXISTS (
            SELECT 1 FROM auth.identities
            WHERE user_id = v_user_id AND provider = 'email'
        );

        UPDATE public.profiles
           SET full_name = COALESCE(NULLIF(full_name, ''), v_account.full_name),
               email_verified = true
         WHERE id = v_user_id;

        RAISE NOTICE 'Seeded account % (%).', v_account.email, v_user_id;
    END LOOP;
END $$;


-- ============================================================
-- PASS 2 — Organizations and entities
-- ============================================================
-- Two organizations with DIFFERENT owners. One org would have been enough to
-- browse, but not to test anything: `organizations.owner_id` is a single column,
-- so with one org there is no account that is an admin without also being the
-- owner, and every owner-gated surface (rename, Danger Zone, transfer, remove)
-- looks identical to an admin-gated one.
--
--   Northwind Legal      owner admin@test.com   admin admin2@test.com
--   Ridgeline Ventures   owner admin2@test.com  admin admin@test.com
--
-- Ids are written out rather than left to `generate_id()`, in the same
-- `prefix_` + 16 base62 characters shape the function produces. They are the URL
-- segment (`/$organizationId/...`), so a fixed id means bookmarks and notes
-- survive a re-seed — and it is what makes this block idempotent without needing
-- a lookup by name.
--
-- Each organization gets exactly ONE entity, named after it — the same shape
-- `create_organization` produces (CG-026). CG-030 finished demoting the entity to
-- plumbing no client ever names, so a second one would only be a row nothing can
-- reach: the selector that used to make Northwind's two a visible choice is gone,
-- and `contract_templates.entity_id` is now filled by a trigger from the
-- organization. The seed writes the row by hand only because pass 2 inserts
-- organizations directly rather than through the RPC — CG-026 explains why an
-- AFTER INSERT trigger on `organizations` was rejected.
--
-- Timezone and locale stay distinct across the two orgs deliberately. They are
-- the entity's only remaining product purpose — formatting the dates burned onto
-- documents (CG-003) — and an all-UTC seed would never exercise them.
INSERT INTO public.organizations (id, name, owner_id)
SELECT v.id, v.name, p.id
  FROM (VALUES
    ('org_SeedNorthwind001', 'Northwind Legal',    'admin@test.com' ),
    ('org_SeedRidgeline001', 'Ridgeline Ventures', 'admin2@test.com')
  ) AS v(id, name, owner_email)
  JOIN public.profiles p ON p.email = v.owner_email
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.entities (id, organization_id, name, timezone, locale)
VALUES
    ('ent_SeedNorthwindHQ0', 'org_SeedNorthwind001', 'Northwind Legal',    'Asia/Ho_Chi_Minh', 'vi-VN'),
    ('ent_SeedRidgelineNY0', 'org_SeedRidgeline001', 'Ridgeline Ventures', 'America/New_York', 'en-US')
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- PASS 3 — Roles
-- ============================================================
-- The single place that decides who is what. Owners are NOT written here:
-- `organizations.owner_id` already is the owner's membership, and CG-024 removed
-- the second tier row `create_organization` used to add on top of it because it
-- made the owner appear twice on the People page. The `owner_id <> user_id`
-- guard below is what keeps this file from reintroducing exactly that.
INSERT INTO public.admins (user_id, organization_id)
SELECT p.id, o.id
  FROM (VALUES
    ('admin@test.com',  'org_SeedRidgeline001'),
    ('admin2@test.com', 'org_SeedNorthwind001')
  ) AS v(email, organization_id)
  JOIN public.profiles      p ON p.email = v.email
  JOIN public.organizations o ON o.id    = v.organization_id
 WHERE o.owner_id <> p.id
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- One membership per organization. CG-030 dropped `members.entity_id`, so the
-- organization is written directly and `trigger_set_org_id_members` now only
-- validates that it is there. The HR-era `birthday` NOT NULL is left to its
-- column default, for the same reason `set_organization_role` leaves it alone
-- (CG-023).
--
-- Idempotency is a NOT EXISTS rather than ON CONFLICT: dropping `entity_id` took
-- `employees_entity_id_user_id_key` with it, and CG-030 deliberately did not
-- replace it (see docs/entities.md), so this table has no arbiter to conflict on.
INSERT INTO public.members (user_id, organization_id, email, first_name, last_name)
SELECT p.id, o.id, p.email, 'Test', 'Member'
  FROM public.profiles p
  CROSS JOIN public.organizations o
 WHERE p.email = 'member@test.com'
   AND NOT EXISTS (
       SELECT 1 FROM public.members m
        WHERE m.organization_id = o.id AND m.user_id = p.id
   );


-- ============================================================
-- PASS 4 — Invitations
-- ============================================================
-- The People page renders pending rows from `invitations`, and derives `expired`
-- from `expires_at < now()` rather than from a status value — so an expired row
-- has to be seeded with a PAST timestamp, not with a status of 'expired' (which
-- the CHECK constraint would reject anyway; the only statuses are pending,
-- accepted and rejected).
--
-- All four addresses are deliberately accounts that do NOT exist. An invitation
-- to an existing member is what the send-invitation edge function's duplicate
-- guard rejects, so seeding one would be seeding an invalid state. To accept one
-- of these, sign up on that address and open /invitation?token=<token>.
--
-- `(organization_id, email)` is UNIQUE, hence a distinct address per row.
INSERT INTO public.invitations (id, organization_id, email, token, status, role, invited_by, expires_at, created_at)
SELECT v.id, v.organization_id, v.email, v.token, v.status, v.role, p.id, v.expires_at, v.created_at
  FROM (VALUES
    -- Pending, both tiers — the ordinary case.
    ('inv_SeedPendAdmin01', 'org_SeedNorthwind001', 'pending-admin@test.com',  'tok_SeedPendAdmin01', 'pending',  'admin',  'admin@test.com',  now() + interval '6 days',  now() - interval '1 day'),
    ('inv_SeedPendMember1', 'org_SeedNorthwind001', 'pending-member@test.com', 'tok_SeedPendMember1', 'pending',  'member', 'admin@test.com',  now() + interval '13 days', now() - interval '1 day'),
    -- Expired: still status 'pending', but past its expiry.
    ('inv_SeedExpired0001', 'org_SeedNorthwind001', 'expired-invite@test.com', 'tok_SeedExpired0001', 'pending',  'member', 'admin2@test.com', now() - interval '2 days',  now() - interval '16 days'),
    -- Declined, in the other org, so Ridgeline is not empty either.
    ('inv_SeedRejected001', 'org_SeedRidgeline001', 'declined-invite@test.com','tok_SeedRejected001', 'rejected', 'admin',  'admin2@test.com', now() + interval '3 days',  now() - interval '4 days')
  ) AS v(id, organization_id, email, token, status, role, inviter_email, expires_at, created_at)
  JOIN public.profiles p ON p.email = v.inviter_email
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- PASS 5 — Account whitelist (CG-027)
-- ============================================================
-- Without a row here, `_protected/route.tsx` sends the account to
-- /pending-access and no seeded organization, envelope or template is
-- reachable — so every seeded sign-in account needs one, or the whole seed is
-- inert. These are the same four addresses created in passes 1 and 2.
--
-- Deliberately NOT whitelisted:
--   - the four `invitations` addresses (pending-admin@, pending-member@,
--     expired-invite@, declined-invite@). Accepting an invitation does not
--     grant product access; signing up on one of those and getting stopped at
--     /pending-access is the blocked path, ready to test without setup.
--   - external signers, who never had accounts to begin with.
--
-- Production is managed by hand — nothing seeds it:
--   INSERT INTO public.whitelist (pattern, value, note)
--        VALUES ('exact', 'someone@example.com', 'why');
--
-- CG-034 replaced the single `email` column with (pattern, value) and moved
-- uniqueness onto the pair; this block still wrote to `email` and had been
-- failing the seed with `column "email" of relation "whitelist" does not exist`
-- since that migration landed, which took the whole seed down with it.
INSERT INTO public.whitelist (pattern, value, note)
VALUES
    ('exact', 'admin@test.com',   'Seed: owner of Northwind Legal'),
    ('exact', 'admin2@test.com',  'Seed: owner of Ridgeline Ventures'),
    ('exact', 'member@test.com',  'Seed: non-admin member'),
    ('exact', 'newuser@test.com', 'Seed: verified, no organization')
ON CONFLICT (pattern, value) DO NOTHING;
