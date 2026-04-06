-- ============================================
-- Drop organizations.identifier column + generate_identifier() function
-- The id column (via generate_id('org')) already serves as URL identifier
-- ============================================

-- PHASE 1: DROP + recreate get_my_member_organizations() without identifier
drop function if exists public.get_my_member_organizations() cascade;

create or replace function public.get_my_member_organizations()
returns table(id text, name text)
language sql
stable
security definer set search_path = ''
as $$
  select o.id, o.name from public.organizations o
  where o.owner_id = auth.uid()
  union
  select o.id, o.name from public.organizations o
  inner join public.org_admins a on a.organization_id = o.id
  where a.user_id = auth.uid()
  union
  select o.id, o.name from public.organizations o
  inner join public.org_employees e on e.organization_id = o.id
  where e.user_id = auth.uid()
$$;

-- PHASE 2: DROP identifier column (CASCADE removes unique constraint + index + default)
alter table public.organizations drop column identifier;

-- PHASE 3: DROP generate_identifier() function (no longer referenced)
drop function if exists public.generate_identifier(text, int);
