import type { MergeDeep } from "type-fest";
import type { Database } from "./database.types";
import type { EmployeeView_Config } from "./employeeTable.types";

type DatabaseOverrides = {
    public: {
        Tables: {
            employee_views: {
                Row: { config: EmployeeView_Config };
                Insert: { config: EmployeeView_Config };
                Update: { config?: EmployeeView_Config };
            };
        };
    };
};

export type DatabaseWithCustomTypes = MergeDeep<Database, DatabaseOverrides>;
