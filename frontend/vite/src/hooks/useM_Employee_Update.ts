import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { orgEmployeesTable } from "@/types/employeeTable.types";

export type UseM_Employee_Update_Params = {
    organizationId: string;
};

export type UseM_Employee_Update_Body = {
    employeeId: string;
    patch: Record<string, unknown>;
};

const COL_KEY_PATTERN = /^col_[A-Za-z0-9]+$/;

export const useM_Employee_Update = ({ organizationId }: UseM_Employee_Update_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["employees", "update"],
        mutationFn: async ({ employeeId, patch }: UseM_Employee_Update_Body) => {
            // Split patch by key prefix: col_* → per-org dynamic table; everything else → global employees.
            const universalPatch: Record<string, unknown> = {};
            const dynamicPatch: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(patch)) {
                if (COL_KEY_PATTERN.test(key)) dynamicPatch[key] = value;
                else universalPatch[key] = value;
            }

            const universalPromise =
                Object.keys(universalPatch).length > 0
                    ? supabase
                          .from("employees")
                          .update(universalPatch as never)
                          .eq("id", employeeId)
                    : null;

            const perOrgTable = orgEmployeesTable(organizationId) as "employees";
            const dynamicPromise =
                Object.keys(dynamicPatch).length > 0
                    ? supabase
                          .from(perOrgTable)
                          .upsert(
                              { employee_id: employeeId, ...dynamicPatch } as never,
                              { onConflict: "employee_id" },
                          )
                    : null;

            const [universalResult, dynamicResult] = await Promise.all([universalPromise, dynamicPromise]);

            if (universalResult?.error) throw universalResult.error;
            if (dynamicResult?.error) throw dynamicResult.error;

            return { employeeId };
        },
        onSuccess: () => {
            message.success("Employee updated");
            queryClient.invalidateQueries({ queryKey: QueryKeys.employees.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to update employee");
        },
    });

    return { mutation };
};
