-- ============================================
-- Convert PKs from uuid to text with generate_id()
-- Bible convention: all custom tables use generate_id('prefix')
-- profiles.id stays uuid (references auth.users)
-- organizations.owner_id stays uuid (FK to profiles)
-- ============================================

-- ============================================
-- 1. DROP FUNCTIONS (parameter types changing uuid→text)
-- ============================================

-- Must drop before altering columns — functions reference old types
-- CASCADE drops dependent RLS policies automatically
drop function if exists public.is_org_member(uuid) cascade;
drop function if exists public.get_org_role(uuid) cascade;
drop function if exists public.is_admin_or_owner(uuid) cascade;
drop function if exists public.authorize(uuid, public.app_permission) cascade;
drop function if exists public.seed_org_permissions(uuid) cascade;
drop function if exists public.create_organization(text) cascade;
drop function if exists public.has_pending_invitation(uuid) cascade;
drop function if exists public.get_my_member_organizations() cascade;
drop function if exists public.get_invitation_by_token(uuid) cascade;
drop function if exists public.accept_admin_invitation(uuid) cascade;

-- Drop any remaining policies not dependent on functions
drop policy if exists "Authenticated users can create organizations" on public.organizations;
drop policy if exists "Owner can add admins" on public.org_admins;
drop policy if exists "Owner can remove admins" on public.org_admins;
drop policy if exists "Owner can view org invitations" on public.org_admin_invitations;
drop policy if exists "Owner can delete org invitations" on public.org_admin_invitations;
drop policy if exists "Invitee can view own invitations" on public.org_admin_invitations;
drop policy if exists "Invitee can update own invitations" on public.org_admin_invitations;

-- ============================================
-- 3. DROP FK CONSTRAINTS
-- ============================================

alter table public.org_admins drop constraint if exists org_admins_organization_id_fkey;
alter table public.org_employees drop constraint if exists org_employees_organization_id_fkey;
alter table public.organization_role_permissions drop constraint if exists organization_role_permissions_organization_id_fkey;
alter table public.org_admin_invitations drop constraint if exists org_admin_invitations_organization_id_fkey;

-- ============================================
-- 4. ALTER COLUMN TYPES: id columns uuid → text
-- ============================================

-- organizations.id
alter table public.organizations
  alter column id set data type text using id::text,
  alter column id set default generate_id('org');

-- org_admins.id + organization_id
alter table public.org_admins
  alter column id set data type text using id::text,
  alter column id set default generate_id('oad'),
  alter column organization_id set data type text using organization_id::text;

-- org_employees.id + organization_id
alter table public.org_employees
  alter column id set data type text using id::text,
  alter column id set default generate_id('oem'),
  alter column organization_id set data type text using organization_id::text;

-- organization_role_permissions.id + organization_id
alter table public.organization_role_permissions
  alter column id set data type text using id::text,
  alter column id set default generate_id('orp'),
  alter column organization_id set data type text using organization_id::text;

-- org_admin_invitations.id + organization_id + token
alter table public.org_admin_invitations
  alter column id set data type text using id::text,
  alter column id set default generate_id('inv'),
  alter column organization_id set data type text using organization_id::text,
  alter column token set data type text using token::text,
  alter column token set default generate_id('tok');

-- ============================================
-- 5. RECREATE FK CONSTRAINTS
-- ============================================

alter table public.org_admins
  add constraint org_admins_organization_id_fkey
  foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.org_employees
  add constraint org_employees_organization_id_fkey
  foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.organization_role_permissions
  add constraint organization_role_permissions_organization_id_fkey
  foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.org_admin_invitations
  add constraint org_admin_invitations_organization_id_fkey
  foreign key (organization_id) references public.organizations(id) on delete cascade;

-- ============================================
-- 6. RECREATE FUNCTIONS WITH text PARAMETER TYPES
-- ============================================

create or replace function public.is_org_member(org_id text)
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

create function public.get_org_role(org_id text)
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

create or replace function public.is_admin_or_owner(org_id text)
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

create or replace function public.authorize(
  org_id text,
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

create or replace function public.seed_org_permissions(org_id text)
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

create or replace function public.create_organization(org_name text)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  new_org_id text;
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

create or replace function public.has_pending_invitation(org_id text)
returns boolean
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  return exists (
    select 1 from public.org_admin_invitations
    where organization_id = org_id
      and lower(email) = lower(auth.jwt() ->> 'email')
      and status = 'pending'
  );
end;
$$;

create or replace function public.get_my_member_organizations()
returns table(id text, name text, identifier text)
language sql
stable
security definer set search_path = ''
as $$
  select o.id, o.name, o.identifier from public.organizations o
  where o.owner_id = auth.uid()
  union
  select o.id, o.name, o.identifier from public.organizations o
  inner join public.org_admins a on a.organization_id = o.id
  where a.user_id = auth.uid()
  union
  select o.id, o.name, o.identifier from public.organizations o
  inner join public.org_employees e on e.organization_id = o.id
  where e.user_id = auth.uid()
$$;

create or replace function public.get_invitation_by_token(invitation_token text)
returns json
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  result json;
begin
  select json_build_object(
    'id', i.id,
    'email', i.email,
    'status', i.status,
    'expires_at', i.expires_at,
    'created_at', i.created_at,
    'organization_name', o.name,
    'organization_id', o.id,
    'expired', i.expires_at < now()
  ) into result
  from public.org_admin_invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token = invitation_token;

  return result;
end;
$$;

create or replace function public.accept_admin_invitation(invitation_token text)
returns json
language plpgsql
security definer set search_path = ''
as $$
declare
  inv record;
  caller_id uuid;
  caller_email text;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Get caller's email
  select email into caller_email from auth.users where id = caller_id;

  -- Get invitation
  select * into inv
  from public.org_admin_invitations
  where token = invitation_token;

  if inv is null then
    raise exception 'Invitation not found';
  end if;

  if inv.status != 'pending' then
    raise exception 'Invitation already %', inv.status;
  end if;

  if inv.expires_at < now() then
    raise exception 'Invitation has expired';
  end if;

  if lower(inv.email) != lower(caller_email) then
    raise exception 'Email mismatch — this invitation was sent to a different address';
  end if;

  -- Check not already an admin
  if exists (
    select 1 from public.org_admins
    where organization_id = inv.organization_id and user_id = caller_id
  ) then
    -- Already admin — just mark invitation as accepted
    update public.org_admin_invitations
    set status = 'accepted'
    where id = inv.id;

    return json_build_object('status', 'already_admin', 'organization_id', inv.organization_id);
  end if;

  -- Insert into org_admins
  insert into public.org_admins (user_id, organization_id)
  values (caller_id, inv.organization_id);

  -- Mark invitation as accepted
  update public.org_admin_invitations
  set status = 'accepted'
  where id = inv.id;

  return json_build_object('status', 'accepted', 'organization_id', inv.organization_id);
end;
$$;

-- ============================================
-- 7. RECREATE RLS POLICIES
-- ============================================

-- organizations
create policy "Members can view their organizations"
  on public.organizations for select
  to authenticated
  using (public.is_org_member(id));

create policy "Authenticated users can create organizations"
  on public.organizations for insert
  to authenticated
  with check (true);

create policy "Only owner can update organization"
  on public.organizations for update
  to authenticated
  using (public.get_org_role(id) = 'owner')
  with check (public.get_org_role(id) = 'owner');

create policy "Only owner can delete organization"
  on public.organizations for delete
  to authenticated
  using (public.get_org_role(id) = 'owner');

create policy "Invitees can view invited organizations"
  on public.organizations for select
  to authenticated
  using (public.has_pending_invitation(id));

-- org_admins
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

-- organization_role_permissions
create policy "Members can view org permissions"
  on public.organization_role_permissions for select
  to authenticated
  using (public.is_org_member(organization_id));

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

-- org_admin_invitations
create policy "Owner can view org invitations"
  on public.org_admin_invitations for select
  to authenticated
  using (
    exists (
      select 1 from public.organizations
      where id = organization_id and owner_id = auth.uid()
    )
  );

create policy "Owner can delete org invitations"
  on public.org_admin_invitations for delete
  to authenticated
  using (
    exists (
      select 1 from public.organizations
      where id = organization_id and owner_id = auth.uid()
    )
  );

create policy "Invitee can view own invitations"
  on public.org_admin_invitations for select
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

create policy "Invitee can update own invitations"
  on public.org_admin_invitations for update
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));
