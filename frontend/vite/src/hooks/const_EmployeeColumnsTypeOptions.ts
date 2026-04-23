import type { Enums } from "@/types";
import { Utils_Options_EnumsToOptions } from "@/utils/options/EnumsToOptions";

const EmployeeColumns_Type: Record<
    Enums<"employee_column_type">,
    { value: Enums<"employee_column_type">; label: string }
> = {
    text: { value: "text", label: "Text" },
    number: { value: "number", label: "Number" },
    date: { value: "date", label: "Date" },
    boolean: { value: "boolean", label: "Boolean" },
    single_select: { value: "single_select", label: "Single Select" },
    multi_select: { value: "multi_select", label: "Multi Select" },
    file: { value: "file", label: "File" },
};

export const const_EmployeeColumnsTypeOptions = Utils_Options_EnumsToOptions(EmployeeColumns_Type);
