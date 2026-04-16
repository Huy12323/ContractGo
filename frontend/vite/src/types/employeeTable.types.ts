export type EmployeeTable_FieldType = "text" | "number" | "date" | "boolean" | "single_select" | "multi_select";

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
