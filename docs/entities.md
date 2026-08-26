# Entities

This document exists because the `entities` table looks like a half-built feature
and is not one. If you have just found it and are wondering where the missing UI
went, this is the answer.

## What an entity is

One hidden row per organization, carrying `name`, `timezone` and `locale`.

Its only remaining product purpose is **formatting the dates burned onto
documents**. CG-003 kept exactly those columns for that reason when it stripped
the HR domain, and dropped everything else the table used to hold.

Nobody creates one, names one, sees one, or chooses between them. The name is set
to the organization's name and never read by the UI.

## What an entity is not

**It is never an authorization boundary.** `entity_id` has never appeared in an
RLS predicate and must not start. Every policy in this schema authorizes on
`organization_id`, through `is_org_member()`, `is_admin_or_owner()`, or
`has_org_permission()` (CG-027).

Per-entity access control — members assigned to entities, seeing only that
entity's documents — is **out of scope by decision, not by oversight**. It was
considered during CG-030 and rejected: it would mean rewriting policies across
`contract_templates`, `signature_requests` and `files`, plus a member↔entity
assignment surface, to reinstate a distinction the product does not make.

## Who creates one

`create_organization()` (CG-026), which is provably the only path: it is the sole
caller-visible way to make an organization, it has exactly one frontend caller
(`useM_CreateOrgModal_OrganizationCreate`), and there is no other
`INSERT INTO public.organizations` in the migrations or edge functions.

`seed.sql` writes its own rows by hand for the two seeded organizations, because
pass 2 inserts organizations directly rather than through the RPC. CG-026 explains
why an `AFTER INSERT` trigger on `organizations` was rejected in favour of the RPC.

## Who fills one in

`set_template_org_and_entity()` (CG-030), a `BEFORE INSERT` trigger on
`contract_templates`. It fills whichever of the pair the caller did not supply:

- **The caller named an organization** — the client's only path. The entity is
  resolved as that organization's oldest, deterministic by `(created_at, id)`.
- **The caller named an entity** — kept for SQL written entity-first. The entity
  wins and sets `organization_id`, because letting a caller pass an
  `organization_id` that contradicts its entity is how a row becomes visible to
  the wrong organization.

`contract_templates.entity_id` stays `NOT NULL` deliberately. It is the tripwire:
if the resolver ever breaks, the insert fails loudly instead of writing a NULL
nobody notices.

## Where `entity_id` still appears

Two columns, and nowhere in the client:

| Column | Null? | On entity delete | Written by |
|---|---|---|---|
| `contract_templates.entity_id` | NOT NULL | `CASCADE` | the trigger above |
| `signature_requests.entity_id` | nullable | `SET NULL` | copied from the template at draft-create |

The divergence in delete semantics is intentional. A sent envelope is an immutable
record of a transmission, and `CASCADE` there would let removing a label destroy
signed documents.

Edge functions do **not** accept an `entity_id` on the wire. Before CG-030 they
did, and wrote it straight onto the row with a service-role client and no check
that the id belonged to the caller's organization — the one field on the compose
body that skipped the organization scoping applied to everything else.

## Legacy multi-entity organizations

Possible in production, inherited from the HR era, and harmless. Their templates
all list together (the library is organization-scoped), new templates file under
the oldest entity, and no access check is affected.

They were deliberately **not** merged. Merging means repointing templates before
deleting the redundant entity — `contract_templates.entity_id` is `ON DELETE
CASCADE`, so getting that order wrong silently deletes templates — and repointing
can violate `contract_templates_unique_name_per_entity`, which then needs
collision renaming. That is a real data-loss surface bought for an invariant
nothing depends on.

## Known follow-ups

Two gaps CG-030 chose not to close, because both rewrite existing rows and neither
is load-bearing:

1. **`members` has no unique key.** Dropping `entity_id` took
   `employees_entity_id_user_id_key UNIQUE (entity_id, user_id)` with it. That key
   was already inert for ContractGo — CG-023 recorded that `entity_id` was NULL
   for every member and NULLs are distinct in a btree — so duplicate
   `(organization_id, user_id)` rows have been possible since CG-020. Adding
   `UNIQUE (organization_id, user_id)` requires deduplicating first. Both
   `accept_invitation` (CG-021) and `set_organization_role` (CG-023) guard with an
   explicit `NOT EXISTS` in the meantime.
2. **Template name uniqueness is still per-entity.**
   `contract_templates_unique_name_per_entity` predates the organization-scoped
   library, so a legacy two-entity organization could show two templates called
   "NDA" side by side. Rescoping it would silently rename one of them.

A third, cheaper follow-up: if production turns out to have no multi-entity
organizations, `UNIQUE (organization_id)` on `entities` becomes a no-data-movement
migration. Check first with `SELECT organization_id, count(*) FROM entities GROUP
BY 1 HAVING count(*) > 1;`.

## History

Read in this order if you need the reasoning rather than the result — each
migration's header comment is the primary source.

| | |
|---|---|
| `20260403134636` | `entities` created. An HR legal/operational branch, with `entity_employees` and `departments` hanging off it. |
| AHR-1967 (`20260505084955`) | `employees.entity_id` NOT NULL. The entity becomes the scoping key for people. |
| `20260505133950` | `contract_templates.entity_id` NOT NULL, and `organization_id` gains its `DEFAULT ''`. This is the constraint that kept the entity alive through everything below. |
| CG-003 (`20260813114032`) | The HR domain is stripped. Entities lose `correction_approval_mode` and the per-entity dynamic-table machinery; `employees` becomes `members`. |
| CG-009 (`20260814100028`) | Every remaining NOT NULL `entity_id` consumer is dropped except `contract_templates`. |
| CG-020 / CG-022 (`20260818140100`, `…140300`) | `members.entity_id` becomes nullable, then vestigial; the trigger learns to live without it. |
| CG-026 (`20260819120000`) | `create_organization` seeds one entity per organization, closing the hole where a new organization could hold no templates at all. States the design intent: *the entity stays invisible*. |
| CG-030 (`20260821090000`) | Inverts the derivation so the client names the organization and never the entity. Drops `members.entity_id`, the entity selector, and every entity read in the frontend. |
