import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchContract = async (contractId: string) => {
    const sb_FromContracts_Select = await supabase
        .from("contracts")
        .select(
            "id, organization_id, status, template_snapshot, field_values, prefilled_fields, signature_path, signed_at, signed_by, invitation_id, approved_at, approved_by, contract_template_id, contract_template_version_id",
        )
        .eq("id", contractId)
        .single();

    if (sb_FromContracts_Select.error) throw sb_FromContracts_Select.error;
    return sb_FromContracts_Select.data;
};

export type Tables_Contract_QueryData = Awaited<ReturnType<typeof fetchContract>>;

export const useQ_Tables_Contract = ({
    contractId,
}: {
    contractId: string | null;
}) => {
    const query = useQuery({
        enabled: !!contractId,
        queryKey: QueryKeys.contracts.record(contractId ?? ""),
        queryFn: () => fetchContract(contractId!),
    });

    const contract = query.data ?? null;

    return { query, contract };
};
