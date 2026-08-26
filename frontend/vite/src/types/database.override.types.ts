import type { MergeDeep } from "type-fest";
import type { Database } from "./database.types";

// Corrections to the generated types, where codegen cannot see what Postgres
// actually requires.
//
// `configs/supabase/config.ts` types the client on `DatabaseWithCustomTypes`, so
// every override lives here and nowhere else.
//
// `MergeDeep` cannot verify that the columns it names still exist, so a stale
// entry here is a type that quietly lies about the schema. Three earlier
// overrides did exactly that before they were removed — `employee_views.config`
// (HR strip), `contract_templates.{mandatory,hr}_field_keys` (CG-001, which had
// outlived its columns and still asserted a `string[]` Postgres no longer had),
// and `onboarding_invitations.hr_comments` (CG-009, which dropped the table).
// Remove an override the moment its column goes, rather than leaving it as
// harmless-looking scaffolding.
//
// Deliberately NOT overridden, and not an oversight: `contract_templates.layout`
// and `signer_roles`, plus `signature_requests.template_snapshot`. They are read
// through `template.types.ts` with an explicit cast at the query boundary,
// because a snapshot may hold a v1 layout that `isLayoutV1()` upgrades in
// memory — an override would assert v2 on rows that aren't.
type DatabaseOverrides = {
    public: {
        Tables: {
            contract_templates: {
                // CG-030 inverted the derivation: the client sends
                // `organization_id` and the BEFORE INSERT trigger
                // `set_template_org_and_entity()` fills `entity_id` from it. The
                // column is still NOT NULL — that is the tripwire that makes a
                // broken resolver fail loudly — and codegen reads NOT NULL with
                // no column DEFAULT as "the caller must supply this". It must
                // not: an entity is plumbing no client is allowed to name.
                //
                // `Row` is untouched. Reading `entity_id` back off a row is
                // always a `string`; only the INSERT contract differs.
                Insert: {
                    entity_id?: string;
                };
            };
        };
    };
};

export type DatabaseWithCustomTypes = MergeDeep<Database, DatabaseOverrides>;
