-- ============================================
-- DROP RBAC INFRASTRUCTURE
-- AHR-321: Remove unused permission system
-- ============================================

-- PHASE 1: DROP RLS POLICIES on organization_role_permissions
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'organization_role_permissions') then
    drop policy if exists "Members can view org permissions" on public.organization_role_permissions;
    drop policy if exists "Owner can manage org permissions" on public.organization_role_permissions;
    drop policy if exists "Owner can update org permissions" on public.organization_role_permissions;
    drop policy if exists "Owner can delete org permissions" on public.organization_role_permissions;
  end if;
end $$;

-- PHASE 2: REPLACE create_organization() — remove seed_org_permissions call
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

  insert into public.organizations (name, owner_id)
  values (org_name, caller_id)
  returning id into new_org_id;

  return new_org_id;
end;
$$;

-- PHASE 3: DROP RBAC-SPECIFIC FUNCTIONS
drop function if exists public.authorize(text, public.app_permission);
drop function if exists public.seed_org_permissions(text);

-- PHASE 4: DROP TABLE
drop table if exists public.organization_role_permissions;

-- PHASE 5: DROP ENUM
drop type if exists public.app_permission;
