-- ============================================
-- RBAC + Organizations Foundation
-- AHR-81: Role schema and database foundation
-- ============================================

-- ============================================
-- ENUMS
-- ============================================

create type public.app_role as enum ('owner', 'admin', 'manager', 'employee');

create type public.app_permission as enum (
  'manage_organization',
  'manage_members',
  'manage_roles',
  'view_all_employees',
  'manage_employees',
  'view_department_employees',
  'manage_departments',
  'view_own_profile',
  'edit_own_profile'
);

-- ============================================
-- TABLES
-- ============================================

-- Organizations (bare minimum — timezone, locale, billing_cycle added by AHR-17)
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Organization members — role per org (not global)
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  role public.app_role not null default 'employee',
  created_at timestamptz default now() not null,

  unique(organization_id, user_id)
);

-- Per-org role permissions — what authorize() checks
-- Default permissions seeded by seed_org_permissions() on org creation
create table public.organization_role_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  role public.app_role not null,
  permission public.app_permission not null,
  created_at timestamptz default now() not null,

  unique(organization_id, role, permission)
);

-- ============================================
-- INDEXES
-- ============================================

create index idx_organization_members_user_id on public.organization_members(user_id);
create index idx_organization_members_org_id on public.organization_members(organization_id);
create index idx_org_role_perms_org_role on public.organization_role_permissions(organization_id, role);

-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================

create trigger on_organization_updated
  before update on public.organizations
  for each row execute function public.handle_updated_at();

-- ============================================
-- SEED FUNCTION — default permissions for new orgs
-- ============================================
-- Permission Matrix (defaults):
--
--   Permission                 │ Owner │ Admin │ Manager │ Employee
--   ───────────────────────────┼───────┼───────┼─────────┼─────────
--   manage_organization        │  ✓    │       │         │
--   manage_members             │  ✓    │  ✓    │         │
--   manage_roles               │  ✓    │  ✓    │         │
--   view_all_employees         │  ✓    │  ✓    │         │
--   manage_employees           │  ✓    │  ✓    │         │
--   view_department_employees  │  ✓    │  ✓    │  ✓      │
--   manage_departments         │  ✓    │  ✓    │         │
--   view_own_profile           │  ✓    │  ✓    │  ✓      │  ✓
--   edit_own_profile           │  ✓    │  ✓    │  ✓      │  ✓

create or replace function public.seed_org_permissions(org_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.organization_role_permissions (organization_id, role, permission) values
    -- manage_organization:        owner
    (org_id, 'owner', 'manage_organization'),
    -- manage_members:             owner, admin
    (org_id, 'owner', 'manage_members'),    (org_id, 'admin', 'manage_members'),
    -- manage_roles:               owner, admin
    (org_id, 'owner', 'manage_roles'),      (org_id, 'admin', 'manage_roles'),
    -- view_all_employees:         owner, admin
    (org_id, 'owner', 'view_all_employees'),(org_id, 'admin', 'view_all_employees'),
    -- manage_employees:           owner, admin
    (org_id, 'owner', 'manage_employees'),  (org_id, 'admin', 'manage_employees'),
    -- view_department_employees:  owner, admin, manager
    (org_id, 'owner', 'view_department_employees'), (org_id, 'admin', 'view_department_employees'), (org_id, 'manager', 'view_department_employees'),
    -- manage_departments:         owner, admin
    (org_id, 'owner', 'manage_departments'),(org_id, 'admin', 'manage_departments'),
    -- view_own_profile:           all roles
    (org_id, 'owner', 'view_own_profile'),  (org_id, 'admin', 'view_own_profile'),  (org_id, 'manager', 'view_own_profile'),  (org_id, 'employee', 'view_own_profile'),
    -- edit_own_profile:           all roles
    (org_id, 'owner', 'edit_own_profile'),  (org_id, 'admin', 'edit_own_profile'),  (org_id, 'manager', 'edit_own_profile'),  (org_id, 'employee', 'edit_own_profile')
  on conflict (organization_id, role, permission) do nothing;
end;
$$;

-- ============================================
-- RLS HELPER FUNCTIONS
-- ============================================

-- Check if current user is a member of the given organization
create or replace function public.is_org_member(org_id uuid)
returns boolean
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  return exists (
    select 1 from public.organization_members
    where organization_id = org_id
      and user_id = auth.uid()
  );
end;
$$;

-- Get current user's role in the given organization
create or replace function public.get_org_role(org_id uuid)
returns public.app_role
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  user_role public.app_role;
begin
  select role into user_role
  from public.organization_members
  where organization_id = org_id
    and user_id = auth.uid()
  limit 1;

  return user_role;
end;
$$;

-- Check if current user is admin or owner in the given organization
create or replace function public.is_admin_or_owner(org_id uuid)
returns boolean
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  return exists (
    select 1 from public.organization_members
    where organization_id = org_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
end;
$$;

-- Check if current user has a specific permission in the given organization
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
  user_role public.app_role;
begin
  -- Get user's role in the organization
  select role into user_role
  from public.organization_members
  where organization_id = org_id
    and user_id = auth.uid()
  limit 1;

  -- Not a member → deny
  if user_role is null then
    return false;
  end if;

  -- Check per-org permissions
  return exists (
    select 1 from public.organization_role_permissions
    where organization_id = org_id
      and role = user_role
      and permission = requested_permission
  );
end;
$$;

-- ============================================
-- RLS POLICIES
-- ============================================

-- Organizations
alter table public.organizations enable row level security;

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

-- Organization members
alter table public.organization_members enable row level security;

create policy "Members can view org members"
  on public.organization_members for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "Admin/owner can add members"
  on public.organization_members for insert
  to authenticated
  with check (public.is_admin_or_owner(organization_id));

create policy "Admin/owner can update members (not own row)"
  on public.organization_members for update
  to authenticated
  using (
    public.is_admin_or_owner(organization_id)
    and auth.uid() != user_id  -- self-elevation prevention
  )
  with check (
    public.is_admin_or_owner(organization_id)
    and auth.uid() != user_id
  );

create policy "Only owner can remove members"
  on public.organization_members for delete
  to authenticated
  using (public.get_org_role(organization_id) = 'owner');

-- Organization role permissions
alter table public.organization_role_permissions enable row level security;

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

-- ============================================
-- REALTIME
-- ============================================

alter publication supabase_realtime add table public.organizations;
alter publication supabase_realtime add table public.organization_members;
