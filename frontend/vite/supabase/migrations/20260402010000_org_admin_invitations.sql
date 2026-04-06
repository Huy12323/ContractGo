-- ============================================
-- Admin Invitation Schema
-- AHR-143: org_admin_invitations table + RPCs
-- ============================================

-- ============================================
-- 1. TABLE
-- ============================================

create table public.org_admin_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  email text not null,
  token uuid unique not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  invited_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz default now() not null,

  unique(organization_id, email)
);

-- ============================================
-- 2. INDEXES
-- ============================================

create index idx_org_admin_invitations_org_email on public.org_admin_invitations(organization_id, email);
create index idx_org_admin_invitations_token on public.org_admin_invitations(token);
create index idx_org_admin_invitations_email on public.org_admin_invitations(email);

-- ============================================
-- 3. RLS
-- ============================================

alter table public.org_admin_invitations enable row level security;

-- Owner can read invitations for their org
create policy "Owner can view org invitations"
  on public.org_admin_invitations for select
  to authenticated
  using (
    exists (
      select 1 from public.organizations
      where id = organization_id and owner_id = auth.uid()
    )
  );

-- Owner can delete (cancel) invitations
create policy "Owner can delete org invitations"
  on public.org_admin_invitations for delete
  to authenticated
  using (
    exists (
      select 1 from public.organizations
      where id = organization_id and owner_id = auth.uid()
    )
  );

-- Authenticated user can read invitations matching their email (use JWT claim, not auth.users query)
create policy "Invitee can view own invitations"
  on public.org_admin_invitations for select
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- Helper: check if user has a pending invitation for an org (security definer to avoid circular RLS)
create or replace function public.has_pending_invitation(org_id uuid)
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

-- Invitees can view organizations they're invited to (for the join in myInvitations query)
create policy "Invitees can view invited organizations"
  on public.organizations for select
  to authenticated
  using (public.has_pending_invitation(id));

-- Invitee can update own invitations (to reject)
create policy "Invitee can update own invitations"
  on public.org_admin_invitations for update
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));

-- ============================================
-- 3b. IDENTIFIER SYSTEM
-- ============================================

-- Reusable short ID generator: org-a1b2c3d4, emp-x9y8z7w6, dep-m3n4o5p6
create or replace function public.generate_identifier(prefix text, length int default 8)
returns text
language plpgsql
as $$
declare
  chars text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  result text := '';
  i int;
begin
  for i in 1..length loop
    result := result || substr(chars, floor(random() * 36 + 1)::int, 1);
  end loop;
  return prefix || '-' || result;
end;
$$;

alter table public.organizations
  add column identifier text unique not null default public.generate_identifier('org');

create index idx_organizations_identifier on public.organizations(identifier);

-- ============================================
-- 4. RPCs
-- ============================================

-- Returns only orgs where user is a member (owner/admin/employee), not just invited
create or replace function public.get_my_member_organizations()
returns table(id uuid, name text, identifier text)
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

-- Public-facing: get invitation details by token (no auth required for invitation page)
create or replace function public.get_invitation_by_token(invitation_token uuid)
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

-- Accept invitation: validates token/email/expiry, inserts into org_admins
create or replace function public.accept_admin_invitation(invitation_token uuid)
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
-- 5. REALTIME
-- ============================================

alter publication supabase_realtime add table public.org_admin_invitations;
