-- ============================================
-- Redesign Organization Membership
-- AHR-136: Replace unified organization_members table with
-- owner_id column + org_admins + org_employees tables.
-- Drop app_role enum — role is implicit from table membership.
-- ============================================

-- ============================================
-- 1. ADD OWNER_ID TO ORGANIZATIONS
-- ============================================

alter table public.organizations
  add column owner_id uuid references public.profiles(id);

-- ============================================
-- 2. CREATE NEW MEMBERSHIP TABLES
-- ============================================

create table public.org_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  created_at timestamptz default now() not null,

  unique(organization_id, user_id)
);

create index idx_org_admins_user_id on public.org_admins(user_id);
create index idx_org_admins_org_id on public.org_admins(organization_id);

create table public.org_employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  created_at timestamptz default now() not null,

  unique(organization_id, user_id)
);

create index idx_org_employees_user_id on public.org_employees(user_id);
create index idx_org_employees_org_id on public.org_employees(organization_id);

-- ============================================
-- 3. MIGRATE DATA
-- ============================================

-- Set owner_id from organization_members where role = 'owner'
update public.organizations o
set owner_id = (
  select user_id from public.organization_members
  where organization_id = o.id and role = 'owner'
  limit 1
)
where exists (
  select 1 from public.organization_members
  where organization_id = o.id and role = 'owner'
);

-- Copy admins
insert into public.org_admins (user_id, organization_id)
select user_id, organization_id
from public.organization_members
where role = 'admin';

-- Copy employees
insert into public.org_employees (user_id, organization_id)
select user_id, organization_id
from public.organization_members
where role = 'employee';

-- ============================================
-- 4. MAKE OWNER_ID NOT NULL
-- ============================================

-- Delete orgs with no owner (orphaned data)
delete from public.organizations where owner_id is null;

alter table public.organizations
  alter column owner_id set not null;

-- ============================================
-- 5. REWRITE FUNCTIONS (signatures unchanged)
-- ============================================

-- is_org_member: check owner_id, org_admins, org_employees
create or replace function public.is_org_member(org_id uuid)
returns boolean
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  caller_id uuid;
begin
  caller_id := auth.uid();

  return exists (
    select 1 from public.organizations
    where id = org_id and owner_id = caller_id
  )
  or exists (
    select 1 from public.org_admins
    where organization_id = org_id and user_id = caller_id
  )
  or exists (
    select 1 from public.org_employees
    where organization_id = org_id and user_id = caller_id
  );
end;
$$;

-- is_admin_or_owner: check owner_id or org_admins
create or replace function public.is_admin_or_owner(org_id uuid)
returns boolean
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  caller_id uuid;
begin
  caller_id := auth.uid();

  return exists (
    select 1 from public.organizations
    where id = org_id and owner_id = caller_id
  )
  or exists (
    select 1 from public.org_admins
    where organization_id = org_id and user_id = caller_id
  );
end;
$$;

-- authorize: owner → all perms; else lookup by role text
create or replace function public.authorize(
  org_id uuid,
  requested_permission public.app_permission
)
returns boolean
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  caller_id uuid;
  user_role text;
begin
  caller_id := auth.uid();

  -- Owner has all permissions
  if exists (
    select 1 from public.organizations
    where id = org_id and owner_id = caller_id
  ) then
    return true;
  end if;

  -- Determine role from membership tables
  if exists (
    select 1 from public.org_admins
    where organization_id = org_id and user_id = caller_id
  ) then
    user_role := 'admin';
  elsif exists (
    select 1 from public.org_employees
    where organization_id = org_id and user_id = caller_id
  ) then
    user_role := 'employee';
  else
    return false;
  end if;

  -- Check permission matrix
  return exists (
    select 1 from public.organization_role_permissions
    where organization_id = org_id
      and role = user_role
      and permission = requested_permission
  );
end;
$$;

-- seed_org_permissions: only admin and employee roles
create or replace function public.seed_org_permissions(org_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.organization_role_permissions (organization_id, role, permission) values
    -- admin permissions
    (org_id, 'admin', 'manage_members'),
    (org_id, 'admin', 'manage_roles'),
    (org_id, 'admin', 'view_all_employees'),
    (org_id, 'admin', 'manage_employees'),
    (org_id, 'admin', 'view_department_employees'),
    (org_id, 'admin', 'manage_departments'),
    (org_id, 'admin', 'view_own_profile'),
    (org_id, 'admin', 'edit_own_profile'),
    -- employee permissions
    (org_id, 'employee', 'view_own_profile'),
    (org_id, 'employee', 'edit_own_profile')
  on conflict (organization_id, role, permission) do nothing;
end;
$$;

-- create_organization: set owner_id, no organization_members insert
create or replace function public.create_organization(org_name text)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  new_org_id uuid;
  caller_id uuid;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Create organization with caller as owner
  insert into public.organizations (name, owner_id)
  values (org_name, caller_id)
  returning id into new_org_id;

  -- Seed default permissions
  perform public.seed_org_permissions(new_org_id);

  return new_org_id;
end;
$$;

-- ============================================
-- 6. DROP OLD ORGANIZATION_MEMBERS
-- ============================================

-- Drop RLS policies first
drop policy if exists "Members can view org members" on public.organization_members;
drop policy if exists "Admin/owner can add members" on public.organization_members;
drop policy if exists "Admin/owner can update members (not own row)" on public.organization_members;
drop policy if exists "Only owner can remove members" on public.organization_members;

-- Remove from realtime
alter publication supabase_realtime drop table public.organization_members;

-- Drop the table (indexes dropped automatically)
drop table public.organization_members;

-- ============================================
-- 7. CONVERT ROLE COLUMN & DROP ENUM
-- ============================================

-- Delete owner/manager permission rows (no longer needed)
delete from public.organization_role_permissions
where role in ('owner', 'manager');

-- Convert role column from app_role enum to text
alter table public.organization_role_permissions
  alter column role type text;

-- Add check constraint
alter table public.organization_role_permissions
  add constraint org_role_perms_role_check check (role in ('admin', 'employee'));

-- Drop policies that depend on get_org_role before dropping it
drop policy if exists "Only owner can update organization" on public.organizations;
drop policy if exists "Owner can manage org permissions" on public.organization_role_permissions;
drop policy if exists "Owner can update org permissions" on public.organization_role_permissions;
drop policy if exists "Owner can delete org permissions" on public.organization_role_permissions;

-- Drop get_org_role (return type changes from app_role to text)
drop function if exists public.get_org_role(uuid);

-- Now safe to drop the enum
drop type public.app_role;

-- ============================================
-- 8. RECREATE GET_ORG_ROLE WITH TEXT RETURN
-- ============================================

create function public.get_org_role(org_id uuid)
returns text
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  caller_id uuid;
begin
  caller_id := auth.uid();

  if exists (
    select 1 from public.organizations
    where id = org_id and owner_id = caller_id
  ) then
    return 'owner';
  end if;

  if exists (
    select 1 from public.org_admins
    where organization_id = org_id and user_id = caller_id
  ) then
    return 'admin';
  end if;

  if exists (
    select 1 from public.org_employees
    where organization_id = org_id and user_id = caller_id
  ) then
    return 'employee';
  end if;

  return null;
end;
$$;

-- ============================================
-- 9. RECREATE DROPPED POLICIES (depend on get_org_role)
-- ============================================

create policy "Only owner can update organization"
  on public.organizations for update
  to authenticated
  using (public.get_org_role(id) = 'owner')
  with check (public.get_org_role(id) = 'owner');

create policy "Only owner can delete organization"
  on public.organizations for delete
  to authenticated
  using (public.get_org_role(id) = 'owner');

create policy "Owner can manage org permissions"
  on public.organization_role_permissions for insert
  to authenticated
  with check (public.get_org_role(organization_id) = 'owner');

create policy "Owner can update org permissions"
  on public.organization_role_permissions for update
  to authenticated
  using (public.get_org_role(organization_id) = 'owner');

create policy "Owner can delete org permissions"
  on public.organization_role_permissions for delete
  to authenticated
  using (public.get_org_role(organization_id) = 'owner');

-- ============================================
-- 10. RLS ON NEW TABLES
-- ============================================

-- org_admins
alter table public.org_admins enable row level security;

create policy "Members can view org admins"
  on public.org_admins for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "Owner can add admins"
  on public.org_admins for insert
  to authenticated
  with check (
    exists (
      select 1 from public.organizations
      where id = organization_id and owner_id = auth.uid()
    )
  );

create policy "Owner can remove admins"
  on public.org_admins for delete
  to authenticated
  using (
    exists (
      select 1 from public.organizations
      where id = organization_id and owner_id = auth.uid()
    )
  );

-- org_employees
alter table public.org_employees enable row level security;

create policy "Members can view org employees"
  on public.org_employees for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "Admin or owner can add employees"
  on public.org_employees for insert
  to authenticated
  with check (public.is_admin_or_owner(organization_id));

create policy "Admin or owner can remove employees"
  on public.org_employees for delete
  to authenticated
  using (public.is_admin_or_owner(organization_id));

-- ============================================
-- 10. REALTIME FOR NEW TABLES
-- ============================================

alter publication supabase_realtime add table public.org_admins;
alter publication supabase_realtime add table public.org_employees;
