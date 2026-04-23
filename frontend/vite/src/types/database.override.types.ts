import type { MergeDeep } from "type-fest";
import type { Database } from "./database.types";
import type { EmployeeView_Config } from "./employeeTable.types";
import type { OnboardingInvitation_HrComments } from "./invitation.types";

type DatabaseOverrides = {
    public: {
        Tables: {
            employee_views: {
                Row: { config: EmployeeView_Config };
                Insert: { config: EmployeeView_Config };
                Update: { config?: EmployeeView_Config };
            };
            onboarding_invitations: {
                Row: { hr_comments: OnboardingInvitation_HrComments };
                Insert: { hr_comments?: OnboardingInvitation_HrComments };
                Update: { hr_comments?: OnboardingInvitation_HrComments };
            };
            contract_templates: {
                Row: { mandatory_field_keys: string[] };
                Insert: { mandatory_field_keys?: string[] };
                Update: { mandatory_field_keys?: string[] };
            };
        };
    };
};

export type DatabaseWithCustomTypes = MergeDeep<Database, DatabaseOverrides>;
