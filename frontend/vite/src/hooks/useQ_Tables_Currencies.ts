import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchCurrencies = async () => {
    const sb_FromCurrencies_Select = await supabase
        .from("currencies")
        .select("code, display_name")
        .order("display_name");
    if (sb_FromCurrencies_Select.error) throw sb_FromCurrencies_Select.error;
    return sb_FromCurrencies_Select.data;
};

export type Tables_Currencies_QueryData = Awaited<ReturnType<typeof fetchCurrencies>>;

export const useQ_Tables_Currencies = () => {
    const query = useQuery({
        queryKey: QueryKeys.currencies.list(),
        queryFn: fetchCurrencies,
        staleTime: Infinity,
    });

    const currencies = useMemo(() => query.data || [], [query.data]);

    return { query, currencies };
};
