import type {
    EmployeeView_Config,
    EmployeeTable_FilterNode,
    EmployeeTable_FilterGroup,
} from "@/types/employeeTable.types";

function cleanFilterNode(
    node: EmployeeTable_FilterGroup,
    validKeys: Set<string>,
): EmployeeTable_FilterGroup | null;
function cleanFilterNode(
    node: EmployeeTable_FilterNode,
    validKeys: Set<string>,
): EmployeeTable_FilterNode | null;
function cleanFilterNode(
    node: EmployeeTable_FilterNode,
    validKeys: Set<string>,
): EmployeeTable_FilterNode | null {
    if (node.kind === "condition") return validKeys.has(node.field) ? node : null;

    const cleanedChildren: EmployeeTable_FilterNode[] = [];
    let anyChildChanged = false;
    for (const child of node.children) {
        const cleaned = cleanFilterNode(child, validKeys);
        if (cleaned === null) {
            anyChildChanged = true;
            continue;
        }
        if (cleaned !== child) anyChildChanged = true;
        cleanedChildren.push(cleaned);
    }

    if (cleanedChildren.length === 0) return null;
    if (!anyChildChanged) return node;

    return { kind: "group", combinator: node.combinator, children: cleanedChildren };
}

export const Utils_EmployeeView_CleanConfig = (
    config: EmployeeView_Config,
    validKeys: Set<string>,
): EmployeeView_Config => {
    const cleanFieldOrder = config.fieldOrder.filter((k) => validKeys.has(k));
    const cleanHiddenKeys = config.hiddenKeys.filter((k) => validKeys.has(k));
    const cleanSort = config.sort.filter((s) => validKeys.has(s.field));
    const cleanGroupBy = config.groupBy.filter((g) => validKeys.has(g.field));
    const cleanFilter = config.filter ? cleanFilterNode(config.filter, validKeys) : null;

    if (
        cleanFieldOrder.length === config.fieldOrder.length &&
        cleanHiddenKeys.length === config.hiddenKeys.length &&
        cleanSort.length === config.sort.length &&
        cleanGroupBy.length === config.groupBy.length &&
        cleanFilter === config.filter
    ) {
        return config;
    }

    return {
        sort: cleanSort,
        filter: cleanFilter,
        groupBy: cleanGroupBy,
        hiddenKeys: cleanHiddenKeys,
        fieldOrder: cleanFieldOrder,
    };
};
