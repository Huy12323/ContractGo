---
name: ext-supabase-rls-policies
description: Project-specific RLS policy templates using is_admin_or_owner helper — overrides the organization_members IN (...) pattern in the base skill
base: bible-supabase-rls-policies
---

# Supabase RLS Policies — Project Extensions

> Base skill: **bible-supabase-rls-policies** — read it first for the denormalized `organization_id` strategy, `BEFORE INSERT` triggers, and the `(SELECT auth.uid())` performance rule.

## CRITICAL: This project does NOT use `organization_members IN (...)`

The base skill's Standard RLS Policy Pattern template uses `organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = (SELECT auth.uid()))`. **That subquery is invalid in this project** — `organization_members` was dropped in `supabase/migrations/20260402000000_redesign_org_membership.sql`. Policies written against it will fail at migration time or return empty result sets.

Use the `is_admin_or_owner` / `is_org_member` helpers instead. They are defined in `supabase/migrations/20260406211234_rename_org_membership_tables.sql` and encode the owner-OR-admin-OR-employee check once.

## Helper Function Signatures

```sql
public.is_org_member(org_id text) RETURNS boolean       -- owner OR admin OR employee
public.is_admin_or_owner(org_id text) RETURNS boolean   -- owner OR admin (HR-write gate)
```

Both are `SECURITY DEFINER` and read `auth.uid()` internally. Call them from `USING` and `WITH CHECK` clauses directly — no subquery wrapping needed, and no need to pass the user id.

## Policy Templates (Project Canonical)

Three shapes cover ~95% of the project's tables.

### Shape 1 — Admin-or-Owner CRUD (HR-managed data)

For tables HR manages: entities, departments, contract templates, employee columns, onboarding invitations, etc. The whole team can read, only HR writes.

```sql
ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_owner_can_view_my_table"
    ON public.my_table FOR SELECT TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_insert_my_table"
    ON public.my_table FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_my_table"
    ON public.my_table FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_my_table"
    ON public.my_table FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id));
```

**Canonical example:** `supabase/migrations/20260409120100_create_onboarding_invitations.sql:32-47`

### Shape 2 — Admin-or-Self SELECT (user-visible records)

For tables where HR sees everything but each employee can also see their own rows. Examples: `contracts` (employee sees their own signed contracts), employee profile records.

```sql
CREATE POLICY "admin_or_self_can_view_my_table"
    ON public.my_table FOR SELECT TO authenticated
    USING (
        public.is_admin_or_owner(organization_id)
        OR employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

-- Writes typically still go through admin_or_owner — employees don't self-insert these
CREATE POLICY "admin_or_owner_can_insert_my_table"
    ON public.my_table FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));
```

When a row is created before the `employees` row exists (e.g., pre-approval contracts from onboarding), add an `OR signed_by = (SELECT auth.uid())` branch so the creator can still see it:

```sql
CREATE POLICY "admin_or_self_can_view_contracts"
    ON public.contracts FOR SELECT TO authenticated
    USING (
        public.is_admin_or_owner(organization_id)
        OR employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
        OR signed_by = (SELECT auth.uid())
    );
```

**Canonical example:** `supabase/migrations/20260410045123_ahr496_employee_contract_submit.sql:16-25`

### Shape 3 — Invitee Email-Match SELECT (invitation-style tables)

For invitation tables where the invited person is not yet a member but needs to read their own invitation. Uses the JWT email claim — no database roundtrip.

```sql
CREATE POLICY "invitee_can_view_own_my_invitations"
    ON public.my_invitations FOR SELECT TO authenticated
    USING (
        status = 'sent'
        AND lower(invitee_email) = lower(auth.jwt() ->> 'email')
    );
```

This is **additive** to the admin_or_owner SELECT policy — both coexist. HR sees all invitations in their org via `is_admin_or_owner`, the invitee sees their own via email match.

**Canonical examples:**
- `supabase/migrations/20260410045123_ahr496_employee_contract_submit.sql:28-34` — `invitee_can_view_own_onboarding_invitations`
- `supabase/migrations/20260402010000_org_admin_invitations.sql:59-63` — `Invitee can view own invitations` (admin_invitations, the original pattern)

For junction tables that live under an invitation (e.g., `rel__department__invitation`), the email-match SELECT policy uses a subquery through the parent:

```sql
CREATE POLICY "invitee_can_view_rel__department__invitation"
    ON public.rel__department__invitation FOR SELECT TO authenticated
    USING (
        invitation_id IN (
            SELECT id FROM public.onboarding_invitations
            WHERE status = 'sent'
              AND lower(employee_email) = lower(auth.jwt() ->> 'email')
        )
    );
```

## Policy Naming Convention

Project-specific — deviates from the base skill's `org_members_can_{verb}_{table}` because this project does not have an `org_members` role.

| Role gate | Prefix | Example |
|---|---|---|
| Owner OR admin | `admin_or_owner_can_{verb}_{table}` | `admin_or_owner_can_view_contract_templates` |
| Admin OR the employee themselves | `admin_or_self_can_{verb}_{table}` | `admin_or_self_can_view_contracts` |
| Invitee email match | `invitee_can_{verb}_own_{table}` | `invitee_can_view_own_onboarding_invitations` |
| Org-files storage bucket | `org_admin_can_{verb}_org_files` / `org_members_can_select_org_files` | See `20260409110238_create_org_files_storage_bucket.sql` |

The `is_admin_or_owner` helper is a function call, not a subquery join — so the base skill's warning about recursive RLS expansion does not apply to these policies. The helper is `SECURITY DEFINER` and evaluates once per row.

## Things NOT To Do (Project-Specific)

| Wrong | Correct |
|---|---|
| `SELECT organization_id FROM public.organization_members WHERE user_id = (SELECT auth.uid())` | `public.is_admin_or_owner(organization_id)` or `public.is_org_member(organization_id)` |
| `CREATE POLICY "org_members_can_..."` naming | `CREATE POLICY "admin_or_owner_can_..."` or the role-matching prefix |
| Re-implementing owner+admin+employee checks inline in a policy | Call `is_org_member()` — it's the canonical implementation |
| Checking `auth.users` table directly | Use `auth.jwt() ->> 'email'` for email claims, or `(SELECT auth.uid())` for user id |
| Forgetting the `invitee_can_view_...` SELECT policy when creating a new invitation-style table | All invitation tables need both the admin-or-owner policies (for HR) and the invitee email-match policy (for the invited person) |
