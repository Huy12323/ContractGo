-- ============================================
-- CG-040: UPDATE GRANT FOR profiles.avatar_file_id
-- ============================================
-- CG-035 moved `public.profiles` onto column-wise UPDATE grants, to stop a user
-- writing their own `whitelist` flag through the `auth.uid() = id` policy. It
-- enumerated the columns that stay writable and closed with a note to whoever
-- added the next one: use `GRANT UPDATE (new_column)`, because a blanket
-- `GRANT UPDATE` would silently re-open `whitelist`.
--
-- CG-037 then added `avatar_file_id` and did not read that note. The column
-- therefore had no UPDATE grant for `authenticated`, and the settings screen
-- writing an avatar would have failed with a permission error on the first save
-- after deploy — the whole point of the column being to record the `files` row an
-- avatar upload now creates.
--
-- The trap is worth naming rather than just fixing: the failure is invisible
-- until an end user with a session tries the write. `postgres` and `service_role`
-- keep their table-level grant, so every migration, seed and psql check succeeds.
-- Only `authenticated` is short a privilege, and nothing in the schema says so.
GRANT UPDATE (avatar_file_id) ON public.profiles TO authenticated;

-- The columns deliberately NOT granted, so the omissions read as decisions:
--   whitelist  — CG-035's entire subject. A user who could write this could
--                grant themselves the product.
--   email      — has an UPDATE grant already (CG-035 carried it forward), but
--                `useM_Profile_Update` still refuses to send it: it lives on
--                `auth.users` too and changing it must re-run verification.

DO $$
BEGIN
    IF NOT has_column_privilege('authenticated', 'public.profiles', 'avatar_file_id', 'UPDATE') THEN
        RAISE EXCEPTION 'CG-040 incomplete — authenticated still cannot UPDATE profiles.avatar_file_id';
    END IF;

    -- The regression this file must never cause.
    IF has_column_privilege('authenticated', 'public.profiles', 'whitelist', 'UPDATE') THEN
        RAISE EXCEPTION 'CG-040 broke CG-035 — authenticated can now UPDATE profiles.whitelist';
    END IF;
END $$;
