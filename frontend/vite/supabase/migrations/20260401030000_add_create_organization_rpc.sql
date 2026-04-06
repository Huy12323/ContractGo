-- ============================================
-- RPC to create an organization atomically
-- Creates org + adds caller as owner + seeds permissions
-- SECURITY DEFINER bypasses RLS for the chicken-and-egg problem:
-- user can't insert into organization_members until they're a member
-- ============================================

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

  -- Create organization
  insert into public.organizations (name)
  values (org_name)
  returning id into new_org_id;

  -- Add caller as owner
  insert into public.organization_members (user_id, organization_id, role)
  values (caller_id, new_org_id, 'owner');

  -- Seed default permissions
  perform public.seed_org_permissions(new_org_id);

  return new_org_id;
end;
$$;
