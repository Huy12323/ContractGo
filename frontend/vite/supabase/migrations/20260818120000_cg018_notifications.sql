-- ============================================
-- CG-018 — In-app notifications (bell + inbox)
-- ============================================
--
-- ContractGo tells people things exclusively by email. Every notification-worthy
-- event — a signature request, a decline, an expiry, a request for changes, an
-- admin invitation — leaves through `shared--send-email` and never comes back. A
-- signed-in user looking straight at the app cannot learn that one of their
-- documents was declined ten seconds ago; they go looking at a status column, or
-- they wait for the mail.
--
-- This table is the inbox. One row = one thing a signed-in user should know.
-- Rows are created ONLY by service_role: mirrored inside `shared--send-email`
-- AFTER a successful send (so an in-app row means a mail actually left), or
-- minted directly through `_shared/notify.ts` for the app-only events that were
-- never worth an email.
--
-- WHO DOES NOT GET A ROW, and why that is correct. External signers have no
-- `auth.users` row, no session and no surface in this app beyond the emailed
-- link. `createNotification` resolves the recipient by `profiles.email` and
-- returns `no_profile` for them — the normal path, not an error.
--
-- WHICH SCENARIOS ARE NOT MIRRORED. `auth_confirmation` and `auth_recovery`
-- reach someone who is not signed in yet; a notification they can only read
-- after doing the thing it asks for is noise, so they have no enum member here.

-- ---------------------------------------------------------------------------
-- PHASE 1: ENUM
-- ---------------------------------------------------------------------------
-- 1:1 with the `shared--send-email` scenario registry (minus the two auth
-- scenarios), plus the app-only events. The app-only members are why
-- `_shared/notify.ts` is a shared module rather than a private function inside
-- `shared--send-email`: nothing emails them.
CREATE TYPE public.notifications_type_enum AS ENUM (
    'admin_invitation',
    'employee_onboarding_invitation',
    'signature_request_invitation',
    'signature_request_copy',
    'signature_request_declined',
    'signature_request_reminder',
    'signature_request_expired',
    'signature_request_changes_requested',
    'envelope_completed',
    'envelope_voided',
    'envelope_signed_by_party'
);

-- ---------------------------------------------------------------------------
-- PHASE 2: TABLE
-- ---------------------------------------------------------------------------
CREATE TABLE public.notifications (
    id TEXT PRIMARY KEY DEFAULT generate_id('ntf'),

    -- The recipient. `auth.users` rather than `profiles`: profiles is a
    -- projection of auth.users that already cascades from it
    -- (20260302000000_create_profiles.sql:3), so pointing here is one hop
    -- shorter with identical delete semantics.
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- NULLABLE, deliberately. An `admin_invitation` reaches a person who is not
    -- yet a member of the organization it names — that is the whole point of an
    -- invitation — so stamping the org here would create a row whose org the
    -- recipient cannot pass `is_org_member` on. Reads are gated on `user_id`,
    -- never on the org, so a NULL costs nothing at read time; it only excludes
    -- the row from the org-scoped filter until the invite is accepted.
    organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE,

    type public.notifications_type_enum NOT NULL,

    title TEXT NOT NULL,
    body TEXT,

    -- In-app route, APP-RELATIVE (`/org_x/envelopes/req_y`). Never absolute, and
    -- never a signing link — see the CHECK below.
    link TEXT,

    -- The subject, when there is one. A typed FK rather than a generic
    -- (entity_table, entity_id) pair because there is exactly one kind of
    -- subject today, and a real FK is what keeps a notification from outliving
    -- the envelope it talks about.
    request_id TEXT REFERENCES public.signature_requests(id) ON DELETE CASCADE,

    -- Anything the UI wants that is not worth a column (signer_email,
    -- decline_reason, expires_at, outstanding). Rendered as TEXT, never as HTML.
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    read_at TIMESTAMPTZ,

    -- TRUE when this row mirrors a mail the driver accepted; FALSE for app-only
    -- rows. The mirror runs AFTER the send, so this is a record, not a claim.
    emailed BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- CG-005's core invariant, enforced by the schema rather than by reviewer
    -- memory: the plaintext signer token exists exactly once, on its way into
    -- the mail body — the database keeps only its sha256. Persisting a signing
    -- link here would turn a leak of this table into a set of live signing
    -- credentials, which is precisely what CG-005 was written to make impossible.
    CONSTRAINT notifications_link_is_not_a_signing_link
        CHECK (link IS NULL OR link NOT LIKE '%/sign/%'),

    -- A notification about an envelope must say which one; a notification about
    -- nothing in particular must not pretend to.
    CONSTRAINT notifications_envelope_types_have_request
        CHECK (
            type NOT IN (
                'signature_request_invitation',
                'signature_request_copy',
                'signature_request_declined',
                'signature_request_reminder',
                'signature_request_expired',
                'signature_request_changes_requested',
                'envelope_completed',
                'envelope_voided',
                'envelope_signed_by_party'
            )
            OR request_id IS NOT NULL
        )
);

-- The list query: newest first, for one user.
CREATE INDEX idx_notifications_user_id_created_at
    ON public.notifications(user_id, created_at DESC);

-- The badge query. PARTIAL, because the unread set is the small one and this is
-- the query that runs on every page in the app.
CREATE INDEX idx_notifications_user_id_unread
    ON public.notifications(user_id) WHERE read_at IS NULL;

CREATE INDEX idx_notifications_organization_id ON public.notifications(organization_id);
CREATE INDEX idx_notifications_request_id ON public.notifications(request_id);

-- No `updated_at` / `handle_updated_at` trigger: the only mutable column is
-- `read_at`, which already carries its own timestamp.

COMMENT ON TABLE public.notifications IS
    'In-app notification inbox, one row per recipient. INSERTed only by service_role '
    '(mirrored in shared--send-email, or minted by _shared/notify.ts). Users may '
    'SELECT and UPDATE their own rows; the UPDATE is narrowed to read_at by '
    'notifications_guard_user_update().';

COMMENT ON COLUMN public.notifications.organization_id IS
    'NULL when the notification predates membership — admin_invitation arrives before '
    'the recipient is in the org. Reads are keyed on user_id, so a NULL is never a '
    'visibility problem; it only excludes the row from org-scoped filters.';

COMMENT ON COLUMN public.notifications.link IS
    'App-relative route. NEVER a /sign/<token> URL — see '
    'notifications_link_is_not_a_signing_link and CG-005.';

COMMENT ON COLUMN public.notifications.emailed IS
    'TRUE only when this row mirrors a mail the driver accepted. The mirror runs '
    'AFTER the send, so this is a record, not a claim.';

-- ---------------------------------------------------------------------------
-- PHASE 3: RLS — own rows only
-- ---------------------------------------------------------------------------
-- Not `is_org_member`, and deliberately not `is_admin_or_owner`. An owner reading
-- an admin's inbox is a surveillance feature nobody asked for, and this table
-- holds decline reasons and counterparty names verbatim. The recipient is the
-- only reader.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_can_view_own_notifications"
    ON public.notifications FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

-- The only legitimate client write is marking read/unread. USING stops you
-- touching someone else's row; WITH CHECK stops you reassigning your own row to
-- someone else; the guard trigger below stops you rewriting its CONTENT.
CREATE POLICY "user_can_update_own_notifications"
    ON public.notifications FOR UPDATE
    TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

-- No INSERT and no DELETE policy — RLS default-denies, and service_role bypasses
-- RLS entirely. Same posture as `realtime_table_events` (AHR-846): from the
-- client's side the inbox is append-only and written by nobody.

-- ---------------------------------------------------------------------------
-- PHASE 4: Content-immutability guard
-- ---------------------------------------------------------------------------
-- Without this, `user_can_update_own_notifications` lets a user rewrite their own
-- `title`, `body` or `link`. `link` is rendered as an anchor and navigated to, so
-- a self-writable link column is a stored-redirect primitive.
--
-- SECURITY INVOKER (the default), NOT DEFINER. The function needs no elevated
-- privilege — it compares OLD to NEW — and every SECURITY DEFINER function in
-- this schema is born with EXECUTE granted to anon and authenticated by
-- Supabase's default ACL, the trap CG-010 exists to document. Not being DEFINER
-- means there is no grant surface to lock down.
CREATE OR REPLACE FUNCTION public.notifications_guard_user_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- service_role (and the migration/superuser paths) have no `auth.uid()`.
    -- They are the writers; only a real session is narrowed.
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF (NEW.id, NEW.user_id, NEW.organization_id, NEW.type, NEW.title, NEW.body,
        NEW.link, NEW.request_id, NEW.metadata, NEW.emailed, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.user_id, OLD.organization_id, OLD.type, OLD.title, OLD.body,
        OLD.link, OLD.request_id, OLD.metadata, OLD.emailed, OLD.created_at)
    THEN
        RAISE EXCEPTION 'notifications: only read_at may be changed by its recipient';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notifications_guard_user_update
    BEFORE UPDATE ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.notifications_guard_user_update();

-- ---------------------------------------------------------------------------
-- PHASE 5: mark-all-read RPC
-- ---------------------------------------------------------------------------
-- Marking ONE row read and counting the unread ones need no function: a plain
-- `update({read_at})` and a `head: true` count both work under the policies
-- above. Marking ALL read does need one — a client-side bulk UPDATE returns no
-- count, and org-scoping it would mean trusting a filter the client supplies.
CREATE OR REPLACE FUNCTION public.notifications_mark_all_read(
    p_organization_id TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user  UUID := auth.uid();
    v_count INTEGER;
BEGIN
    -- SECURITY DEFINER bypasses RLS, so this line IS the authorization. The user
    -- id is never a parameter: a caller who could name the user could clear
    -- anyone's inbox — the same discipline that keeps `signature_mark_viewed`
    -- separate from its service_role-only `_by_signer` variant (CG-005).
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'notifications_mark_all_read: no authenticated caller';
    END IF;

    UPDATE public.notifications
       SET read_at = now()
     WHERE user_id = v_user
       AND read_at IS NULL
       AND (p_organization_id IS NULL OR organization_id = p_organization_id);

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Explicit by role, never a bare `FROM PUBLIC`. Supabase's default ACL on this
-- schema grants EXECUTE to anon and authenticated on every newly created
-- function, and revoking PUBLIC removes only the implicit world grant — the
-- exact no-op CG-010 was written to correct.
REVOKE EXECUTE ON FUNCTION public.notifications_mark_all_read(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notifications_mark_all_read(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.notifications_mark_all_read(TEXT) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.notifications_mark_all_read(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- PHASE 6: Realtime
-- ---------------------------------------------------------------------------
-- THIS TABLE IS DELIBERATELY OFF THE ORG EVENT BUS. No trigger calling
-- `notify_organization_of_table_change()` is added here, the same kind of
-- deliberate omission as `signature_audit_log` and `signature_captures` in
-- AHR-2100's realtime migration — written down so nobody wires it up next
-- quarter "for consistency". Three reasons:
--
--   1. It structurally cannot carry the admin-invitation case. That row's
--      `organization_id` is NULL, so `get_organization_id_for_change()` returns
--      NULL and `notify_organization_of_table_change()` RAISEs a WARNING and
--      returns without emitting. The one notification whose recipient is most
--      likely staring at the screen is the one the org path cannot deliver.
--   2. `realtime_table_events` is readable by ANY org member (AHR-846). Content
--      would stay protected by the user-scoped SELECT policy above, but the
--      existence, timing, volume and row ids of everyone's notifications would
--      stream to the whole organization. For a table holding decline reasons,
--      that is a metadata channel we should not have to defend later.
--   3. Fan-out: every notification would wake every member for a refetch that
--      returns them nothing new.
--
-- Instead the table is published directly and the client subscribes with a
-- server-side `filter: user_id=eq.<uid>` on top of RLS, making the fan-out
-- exactly one. See `useSupabaseRealtimeSync.ts`.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- So that UPDATE (mark read) and DELETE still carry `user_id` and therefore still
-- match the subscription filter — by default the replica identity is the primary
-- key alone, and the filter is evaluated against the old record for DELETE. Rows
-- here are small and low-volume; the extra WAL is cheap next to a mark-read that
-- silently never arrives.
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
