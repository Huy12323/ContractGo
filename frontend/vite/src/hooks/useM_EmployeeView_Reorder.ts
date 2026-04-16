import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { Tables_OrgEmployeeViews_QueryData } from "@/hooks/useQ_Tables_OrgEmployeeViews";

export type UseM_EmployeeView_Reorder_Body = {
    organizationId: string;
    orderedIds: string[];
};

export const useM_EmployeeView_Reorder = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({ orderedIds }: UseM_EmployeeView_Reorder_Body) => {
            const sb_RpcReorderEmployeeViews = await supabase.rpc("reorder_employee_views", {
                p_ids: orderedIds,
            });
            if (sb_RpcReorderEmployeeViews.error) throw sb_RpcReorderEmployeeViews.error;
        },
        onMutate: async ({ organizationId, orderedIds }) => {
            const queryKey = [...QueryKeys.employee_views.list(), { organizationId }] as const;
            await queryClient.cancelQueries({ queryKey });
            const previousViews = queryClient.getQueryData<Tables_OrgEmployeeViews_QueryData>(queryKey);
            if (previousViews) {
                const byId = new Map(previousViews.map((v) => [v.id, v]));
                const optimistic: Tables_OrgEmployeeViews_QueryData = orderedIds.flatMap((id, idx) => {
                    const v = byId.get(id);
                    return v ? [{ ...v, sort_order: (idx + 1) * 100 }] : [];
                });
                queryClient.setQueryData(queryKey, optimistic);
            }
            return { previousViews, queryKey };
        },
        onError: (err, _vars, context) => {
            console.error(err);
            message.error("Failed to reorder views");
            if (context?.previousViews) {
                queryClient.setQueryData(context.queryKey, context.previousViews);
            }
        },
        onSettled: (_data, _err, _vars, context) => {
            if (context?.queryKey) {
                queryClient.invalidateQueries({ queryKey: context.queryKey });
            }
        },
    });

    return { mutation };
};
