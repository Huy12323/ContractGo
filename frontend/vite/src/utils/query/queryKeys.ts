import type { Database } from "@/types/database.types";

type TableName = keyof Database["public"]["Tables"];

const createTableFactory = <T extends TableName>(tableName: T) =>
    ({
        all: () => [tableName] as const,
        list: () => [tableName, "list"] as const,
        record: (id: string) => [tableName, "record", id] as const,
    }) as const;

// The `satisfies Record<TableName, …>` below is the compiler-enforced tripwire
// for every schema change: adding a table without a key here fails the build, and
// so does keeping a key whose table was dropped.
//
// The old `StaticTableName` alias — `Exclude<TableName, \`ent_${string}__employees\`>`
// — is gone with the dynamic per-entity employee tables it was written to hide.
// Those tables were provisioned at runtime, so they could never be enumerated
// statically; nothing in ContractGo creates tables at runtime, so every table is
// knowable at compile time again and the filter has nothing left to exclude.
//
// CG-009 removed the last four HR-era entries — `contracts`,
// `onboarding_invitations`, `employee_columns` and `employee_column_choices`.
// They outlived the Phase B strip on purpose, because the v1 send/sign surface
// still read them; Phases G–I replaced that surface and Phase J dropped the
// tables, so the keys go with them.

export const QueryKeys = {
    admins: createTableFactory("admins"),
    auth_tokens: createTableFactory("auth_tokens"),
    contract_template_versions: createTableFactory("contract_template_versions"),
    contract_templates: createTableFactory("contract_templates"),
    // Same reason as `signer_access_tokens` below: present only to satisfy the
    // exhaustiveness check. CG-013's cron config holds the scheduler's shared
    // secret, has RLS on and no policies, and is read by `cron_dispatch()`
    // inside Postgres — never by a browser.
    cron_dispatch_config: createTableFactory("cron_dispatch_config"),
    // Same reason as `cron_dispatch_config` above: present only to satisfy the
    // exhaustiveness check. CG-030 removed every client read of `entities` and
    // dropped the table's realtime trigger, so these keys should have no users —
    // an entity is filled in by a Postgres trigger and never named by a browser.
    entities: createTableFactory("entities"),
    files: createTableFactory("files"),
    folders: createTableFactory("folders"),
    // Was `admin_invitations` until CG-020 generalised it to carry a role. The
    // key is the table name because realtime matches by string equality, so this
    // rename is not cosmetic — it is what keeps the event bus wired up.
    invitations: createTableFactory("invitations"),
    members: createTableFactory("members"),
    notifications: createTableFactory("notifications"),
    organizations: createTableFactory("organizations"),
    profiles: createTableFactory("profiles"),
    realtime_table_events: createTableFactory("realtime_table_events"),
    signature_audit_log: createTableFactory("signature_audit_log"),
    signature_captures: createTableFactory("signature_captures"),
    signature_request_signers: createTableFactory("signature_request_signers"),
    signature_requests: createTableFactory("signature_requests"),
    // Present only to satisfy the exhaustiveness check. `signer_access_tokens`
    // has no RLS policies at all, so no client query can ever return a row from
    // it — nothing should use these keys.
    signer_access_tokens: createTableFactory("signer_access_tokens"),
    // Same reason again, and the strongest case of the three: CG-031's passcode
    // challenges hold bcrypt hashes of live credentials, RLS is on with no
    // policies, and the only readers are two SECURITY DEFINER routines called by
    // service_role. A client query here cannot return a row, and a client that
    // wanted one would be asking the wrong question.
    signer_otp_challenges: createTableFactory("signer_otp_challenges"),
    // [ekyc] Same cluster, same reason. CG-033's identity checks have RLS on with
    // no policies — deliberately including no sender-facing one, because the
    // verdict is already in the audit chain and `App_EnvelopeTimeline` already
    // renders it from there. No client query can return a row.
    signer_identity_checks: createTableFactory("signer_identity_checks"),
    // Same shape of entry as `signer_access_tokens` above, for the same reason:
    // CG-027's whitelist has RLS on and no policies, so no client query can ever
    // return a row from it. Whitelist status is read through the
    // `is_whitelisted()` RPC instead — `useQ_Me_Whitelisted` caches under
    // `whitelist.record(userId)`, which is the one legitimate use of these keys.
    // CG-029's saved signature library. User-scoped rather than org-scoped, so
    // `list()` is the whole of one person's library and `record(id)` is one
    // signature — there is no org dimension to key on.
    user_signatures: createTableFactory("user_signatures"),
    // The same never-query cluster as `signer_access_tokens` and
    // `signer_otp_challenges` above. CG-043's throttle state for the PUBLIC
    // document-verification endpoint: RLS on with no policies, written only from
    // inside `signature_request_verify_by_hash`. No client query can return a
    // row, and a client asking for one would be asking to see how close another
    // visitor is to being rate-limited.
    verify_rate_limits: createTableFactory("verify_rate_limits"),
    whitelist: createTableFactory("whitelist"),
    // CG-044's three, all in the never-query cluster above for the same reason:
    // RLS on with zero policies, so no client query can return a row.
    //
    // `api_keys` is the one worth spelling out, because it is the entry most
    // likely to be "fixed" by a later reader wiring the settings page to it. The
    // settings page reads keys through the `api_keys_list` RPC, which is
    // admin-gated and NEVER SELECTS `key_hash`; querying the table directly
    // would be asking PostgREST for a column that is a credential digest. The
    // list's cache key is `api_keys.list()`, which is the one legitimate use of
    // this entry.
    api_keys: createTableFactory("api_keys"),
    api_idempotency_keys: createTableFactory("api_idempotency_keys"),
    api_rate_limits: createTableFactory("api_rate_limits"),
    // CG-045's two, same cluster and same reason — RLS on, zero policies.
    // `webhook_endpoints` holds a live HMAC secret in PLAINTEXT (a digest cannot
    // sign), so a direct client query is not merely blocked, it is the wrong
    // instinct: the settings page reads through `webhook_endpoints_list`, which
    // is admin-gated and never selects that column. The list caches under
    // `webhook_endpoints.list()` and the per-endpoint delivery drawer under
    // `webhook_deliveries.record(endpointId)`.
    webhook_endpoints: createTableFactory("webhook_endpoints"),
    webhook_deliveries: createTableFactory("webhook_deliveries"),
    // CG-049's four, all in the never-query cluster above — RLS on, zero
    // policies, service_role only.
    //
    // `signer_ai_messages` is the one worth spelling out. The transcript is
    // deliberately NOT visible to the sender, so the absence of a policy here is
    // a product decision and not an oversight: a signer's questions are their
    // own words about why they hesitate, and adding a sender-facing policy would
    // hand the counterparty the one artefact the design refuses to disclose.
    // `signer_ai_document_context` holds the full text of a contract and is
    // exactly as sensitive as the PDF; `ai_usage_daily` would tell any caller
    // how close another tenant is to a quota.
    signer_ai_document_context: createTableFactory("signer_ai_document_context"),
    signer_ai_sessions: createTableFactory("signer_ai_sessions"),
    signer_ai_messages: createTableFactory("signer_ai_messages"),
    ai_usage_daily: createTableFactory("ai_usage_daily"),
} satisfies Record<TableName, ReturnType<typeof createTableFactory<TableName>>>;
