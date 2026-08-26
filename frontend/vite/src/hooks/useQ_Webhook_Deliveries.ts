import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

/**
 * The recent delivery attempts for one endpoint — CG-045.
 *
 * ENABLED ONLY WHEN THE DRAWER IS OPEN. Deliveries are the highest-cardinality
 * thing this page can ask for, and nobody looking at a list of four endpoints
 * wants four delivery histories fetched behind it. `endpointId` being null is
 * the closed state.
 *
 * THE PAYLOAD IS NOT RETURNED, deliberately. `webhook_deliveries_list` omits it
 * (CG-045), and the drawer is better for the omission: its job is "did this
 * arrive, and if not why", and a column of JSON blobs makes that harder to read
 * rather than easier. An integrator who needs the body has it — it was POSTed to
 * their own server.
 *
 * WHAT THE DRAWER CAN ANSWER: the status, the HTTP code the endpoint returned,
 * how many attempts have been made, when the next one is due, and the error
 * text. That is the whole of "why is my integration quiet".
 */
const fetchWebhookDeliveries = async (endpointId: string, limit: number) => {
    const sb_RpcWebhookDeliveriesList = await supabase.rpc("webhook_deliveries_list", {
        p_endpoint_id: endpointId,
        p_limit: limit,
    });
    if (sb_RpcWebhookDeliveriesList.error) throw sb_RpcWebhookDeliveriesList.error;
    return sb_RpcWebhookDeliveriesList.data ?? [];
};

export type Webhook_Deliveries_QueryData = Awaited<ReturnType<typeof fetchWebhookDeliveries>>;
export type Webhook_Delivery_Row = Webhook_Deliveries_QueryData[number];

export const useQ_Webhook_Deliveries = ({
    endpointId,
    limit = 50,
}: {
    endpointId: string | null;
    limit?: number;
}) => {
    const query = useQuery({
        enabled: !!endpointId,
        // `record(endpointId)`, not `list()`: these deliveries belong to ONE
        // endpoint, and the record shape is what CG-045's `queryKeys.ts` entry
        // reserved. The empty string is unreachable — `enabled` gates it — and
        // exists only so the key type stays a string.
        queryKey: [...QueryKeys.webhook_deliveries.record(endpointId ?? ""), limit],
        queryFn: () => fetchWebhookDeliveries(endpointId!, limit),
        // A delivery in `pending` has a `next_attempt_at` in the future and will
        // change without anyone touching this drawer. Someone watching a retry
        // should see it resolve rather than have to close and reopen.
        refetchInterval: 15_000,
    });

    const deliveries = useMemo(() => query.data ?? [], [query.data]);

    return { query, deliveries };
};
