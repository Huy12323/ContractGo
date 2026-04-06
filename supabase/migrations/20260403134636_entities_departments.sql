-- ============================================
-- ENTITIES, ENTITY EMPLOYEES, DEPARTMENTS
-- ============================================

-- PHASE 1: ENTITIES (top-level, direct child of organizations)

create table public.entities (
    id text primary key default generate_id('ent'),
    organization_id text not null references public.organizations(id) on delete cascade,
    name text not null,
    timezone text,
    locale text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index idx_entities_organization_id on public.entities(organization_id);

alter table public.entities enable row level security;

create policy "Admin or owner can view entities"
  on public.entities for select
  to authenticated
  using (public.is_admin_or_owner(organization_id));

create policy "Admin or owner can create entities"
  on public.entities for insert
  to authenticated
  with check (public.is_admin_or_owner(organization_id));

create policy "Admin or owner can update entities"
  on public.entities for update
  to authenticated
  using (public.is_admin_or_owner(organization_id));

create policy "Admin or owner can delete entities"
  on public.entities for delete
  to authenticated
  using (public.is_admin_or_owner(organization_id));

-- PHASE 2: ENTITY EMPLOYEES (child of entities, trigger-populated org_id)

create table public.entity_employees (
    id text primary key default generate_id('ent_emp'),
    entity_id text not null references public.entities(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    organization_id text default '' not null,
    created_at timestamptz default now(),
    unique (entity_id, user_id)
);

create index idx_entity_employees_entity_id on public.entity_employees(entity_id);
create index idx_entity_employees_user_id on public.entity_employees(user_id);
create index idx_entity_employees_organization_id on public.entity_employees(organization_id);

-- Trigger: auto-populate organization_id from parent entity
create or replace function public.set_org_id_from_entity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    select organization_id into new.organization_id
    from public.entities
    where id = new.entity_id;

    if new.organization_id is null then
        raise exception 'Cannot resolve organization_id for entity_id %', new.entity_id;
    end if;

    return new;
end;
$$;

create trigger trigger_set_org_id_entity_employees
    before insert on public.entity_employees
    for each row
    execute function public.set_org_id_from_entity();

alter table public.entity_employees enable row level security;

create policy "Admin or owner can view entity employees"
  on public.entity_employees for select
  to authenticated
  using (public.is_admin_or_owner(organization_id));

create policy "Admin or owner can create entity employees"
  on public.entity_employees for insert
  to authenticated
  with check (public.is_admin_or_owner(organization_id));

create policy "Admin or owner can update entity employees"
  on public.entity_employees for update
  to authenticated
  using (public.is_admin_or_owner(organization_id));

create policy "Admin or owner can delete entity employees"
  on public.entity_employees for delete
  to authenticated
  using (public.is_admin_or_owner(organization_id));

-- PHASE 3: DEPARTMENTS (child of entities, self-referencing parent_id)

create table public.departments (
    id text primary key default generate_id('dept'),
    entity_id text not null references public.entities(id) on delete cascade,
    parent_id text references public.departments(id) on delete cascade,
    organization_id text default '' not null,
    name text not null,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index idx_departments_entity_id on public.departments(entity_id);
create index idx_departments_parent_id on public.departments(parent_id);
create index idx_departments_organization_id on public.departments(organization_id);

-- Reuse the same trigger function (same parent table: entities)
create trigger trigger_set_org_id_departments
    before insert on public.departments
    for each row
    execute function public.set_org_id_from_entity();

alter table public.departments enable row level security;

create policy "Admin or owner can view departments"
  on public.departments for select
  to authenticated
  using (public.is_admin_or_owner(organization_id));

create policy "Admin or owner can create departments"
  on public.departments for insert
  to authenticated
  with check (public.is_admin_or_owner(organization_id));

create policy "Admin or owner can update departments"
  on public.departments for update
  to authenticated
  using (public.is_admin_or_owner(organization_id));

create policy "Admin or owner can delete departments"
  on public.departments for delete
  to authenticated
  using (public.is_admin_or_owner(organization_id));
