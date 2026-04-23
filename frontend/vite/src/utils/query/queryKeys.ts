import type { Database } from "@/types/database.types";

type TableName = keyof Database["public"]["Tables"];

const createTableFactory = <T extends TableName>(tableName: T) =>
    ({
        all: () => [tableName] as const,
        list: () => [tableName, "list"] as const,
        record: (id: string) => [tableName, "record", id] as const,
    }) as const;

export const QueryKeys = {
    admin_invitations: createTableFactory("admin_invitations"),
    admins: createTableFactory("admins"),
    auth_tokens: createTableFactory("auth_tokens"),
    contract_template_versions: createTableFactory("contract_template_versions"),
    contract_templates: createTableFactory("contract_templates"),
    contracts: createTableFactory("contracts"),
    departments: createTableFactory("departments"),
    employee_column_choices: createTableFactory("employee_column_choices"),
    employee_columns: createTableFactory("employee_columns"),
    employee_views: createTableFactory("employee_views"),
    employees: createTableFactory("employees"),
    entities: createTableFactory("entities"),
    files: createTableFactory("files"),
    onboarding_invitations: createTableFactory("onboarding_invitations"),
    organization_role_permissions: createTableFactory("organization_role_permissions"),
    organizations: createTableFactory("organizations"),
    profiles: createTableFactory("profiles"),
    realtime_table_events: createTableFactory("realtime_table_events"),
    rel__department__employee: createTableFactory("rel__department__employee"),
    rel__department__invitation: createTableFactory("rel__department__invitation"),
} satisfies Record<TableName, ReturnType<typeof createTableFactory<TableName>>>;
