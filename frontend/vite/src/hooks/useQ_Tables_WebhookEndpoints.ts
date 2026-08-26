import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

/**
 * The organization's webhook endpoints, with their health — CG-045.
 *
 * ⚠ THROUGH THE RPC, NEVER THE TABLE, and here the reason is sharper than it is
 * for API keys. `webhook_endpoints.secret` holds a live HMAC signing secret in
 * PLAINTEXT — it has to, because a digest cannot sign — so a direct client query
 * would not merely be blocked by RLS, it would be asking PostgREST for the
 * credential itself. `webhook_endpoints_list` is admin-gated and never selects
 * that column.
 *
 * THE HEALTH COLUMNS ARE WHY THIS PAGE IS WORTH HAVING. `consecutive_failures`,
 * `pending_count`, `failed_count`, `last_delivery_at` and `disabled_reason` come
 * back with the row, so "my integration went quiet" is answerable at a glance
 * rather than by reading a log. An endpoint that the circuit breaker switched
 * off is the case that most needs to be visible: nothing is retrying it, and
 * until someone acts, no further events will ever arrive.
 */
const fetchWebhookEndpoints = async (organizationId: string) => {
    const sb_RpcWebhookEndpointsList = await supabase.rpc("webhook_endpoints_list", {
        p_organization_id: organizationId,
    });
    if (sb_RpcWebhookEndpointsList.error) throw sb_RpcWebhookEndpointsList.error;
    return sb_RpcWebhookEndpointsList.data ?? [];
};

export type Tables_WebhookEndpoints_QueryData = Awaited<ReturnType<typeof fetchWebhookEndpoints>>;
export type Tables_WebhookEndpoints_Row = Tables_WebhookEndpoints_QueryData[number];

export const useQ_Tables_WebhookEndpoints = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.webhook_endpoints.list(), organizationId],
        queryFn: () => fetchWebhookEndpoints(organizationId),
        // Health data goes stale on its own — the delivery pump runs every
        // minute and the breaker can trip without anyone touching this page. A
        // window focus is the cheapest honest moment to catch up, and this list
        // is small.
        refetchOnWindowFocus: true,
    });

    const endpoints = useMemo(() => query.data ?? [], [query.data]);

    /**
     * Endpoints in trouble: switched off by the breaker, or accumulating
     * failures while still enabled.
     *
     * Both, not just the disabled ones. An endpoint at nine consecutive failures
     * is one delivery away from being switched off, and telling someone only
     * after it has gone dark is telling them too late.
     */
    const unhealthy = useMemo(
        () => endpoints.filter((e) => !e.is_enabled || e.consecutive_failures > 0),
        [endpoints]
    );

    return { query, endpoints, unhealthy };
};
