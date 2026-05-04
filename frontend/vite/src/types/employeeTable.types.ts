export type EmployeeTable_FieldType = "text" | "number" | "date" | "boolean" | "single_select" | "multi_select" | "file";

// Per-org dynamic table name from organization id.
// Mirrors the SQL convention `<organization_id>__employees` from AHR-1947.
export const orgEmployeesTable = (organizationId: string): string =>
    `${organizationId}__employees`;

// Generic shape for rows in any per-org `<orgid>__employees` table.
// `employee_id` is the PK FK to `employees.id`. All other keys are dynamic
// `col_<id>` columns whose set varies per organization.
export type EmployeeDynamicRow = {
    employee_id: string;
    [key: string]: unknown;
};

export type EmployeeTable_FilterOperator =
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "before"
    | "after"
    | "is_true"
    | "is_false"
    | "contains_any"
    | "contains_all"
    | "is_empty"
    | "is_not_empty";

export type EmployeeTable_SortEntry = {
    field: string;
    direction: "asc" | "desc";
};

export type EmployeeTable_GroupEntry = {
    field: string;
    direction: "asc" | "desc";
};

export type EmployeeTable_FilterCondition = {
    field: string;
    operator: EmployeeTable_FilterOperator;
    value: unknown;
};

export type EmployeeView_Config = {
    filter: EmployeeTable_FilterCondition[];
    sort: EmployeeTable_SortEntry[];
    group_by: EmployeeTable_GroupEntry[];
    hidden_keys: string[];
    field_order: string[];
    field_widths: Record<string, number>;
};

// Table/Grid field metadata — previously defined in App_EmployeeDataTable.tsx.
// Lifted here so the Grid + engine don't have to import from a specific renderer.
export type EmployeeDataTable_TableField = {
    key: string;
    label: string;
    type: EmployeeTable_FieldType;
};

// Universal (non-dynamic) employee fields — always present on every employee.
// `__`-prefixed keys are system-managed (derived, read-only); see `isSystemFieldKey`.
// `__full_name` is pinned as the grid's sticky first column — never reordered or hidden.
export const EmployeeDataTable_UniversalFields: ReadonlyArray<EmployeeDataTable_TableField> = [
    { key: "__full_name", label: "Full Name", type: "text" },
    { key: "first_name", label: "First Name", type: "text" },
    { key: "last_name", label: "Last Name", type: "text" },
    { key: "email", label: "Email", type: "text" },
    { key: "birthday", label: "Birthday", type: "date" },
];

export const isSystemFieldKey = (key: string) => key.startsWith("__");
