export type EmployeeTable_FieldType = "text" | "number" | "date" | "boolean" | "multi_select";

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
    kind: "condition";
    field: string;
    operator: EmployeeTable_FilterOperator;
    value: unknown;
};

export type EmployeeTable_FilterGroup = {
    kind: "group";
    combinator: "and" | "or";
    children: EmployeeTable_FilterNode[];
};

export type EmployeeTable_FilterNode = EmployeeTable_FilterCondition | EmployeeTable_FilterGroup;

export type EmployeeTable_ToolState = {
    sort: EmployeeTable_SortEntry[];
    filter: EmployeeTable_FilterGroup | null;
    groupBy: EmployeeTable_GroupEntry[];
    hiddenKeys: string[];
    fieldOrder: string[];
    search: string;
};

export type EmployeeView_Config = {
    sort: EmployeeTable_SortEntry[];
    filter: EmployeeTable_FilterGroup | null;
    groupBy: EmployeeTable_GroupEntry[];
    hiddenKeys: string[];
    fieldOrder: string[];
};
