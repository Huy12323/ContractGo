import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

// The evidence trail for one envelope.
//
// Read directly through RLS (`org_members_can_view_signature_audit_log`) rather
// than through an edge function: the log is readable by any member of the
// organization by design — it is what they would hand a regulator — and the
// rows contain no secrets. `signer_access_tokens` is where the secrets live, and
// that table has no policies at all.
//
// NOT wired to realtime, deliberately. The AHR-2100 realtime migration wired
// `signature_requests` and `signature_request_signers` only, because the log is
// chatty (four to six entries per signer) and every entry that matters to the UI
// accompanies a status change that already emits an event. The trail refetches
// when its request does.

const fetchAuditLog = async (envelopeId: string) => {
    const sb_FromSignatureAuditLog_Select = await supabase
        .from("signature_audit_log")
        .select(
            "id, seq, event_type, signer_id, actor_user_id, payload, occurred_at, entry_hash, prev_hash"
        )
        .eq("request_id", envelopeId)
        .order("seq", { ascending: true });
    if (sb_FromSignatureAuditLog_Select.error) throw sb_FromSignatureAuditLog_Select.error;
    return sb_FromSignatureAuditLog_Select.data;
};

export type Tables_EnvelopeAuditLog_QueryData = Awaited<ReturnType<typeof fetchAuditLog>>;
export type Tables_EnvelopeAuditLog_Entry = Tables_EnvelopeAuditLog_QueryData[number];

export const useQ_Tables_EnvelopeAuditLog = ({ envelopeId }: { envelopeId: string }) => {
    const query = useQuery({
        enabled: !!envelopeId,
        queryKey: [...QueryKeys.signature_audit_log.list(), { envelopeId }],
        queryFn: () => fetchAuditLog(envelopeId),
    });

    const entries = useMemo(() => query.data || [], [query.data]);

    return { query, entries };
};

/**
 * Recomputes nothing — asks Postgres to.
 *
 * `signature_verify_chain` rehashes every entry server-side with the same
 * IMMUTABLE function that wrote them. Verifying in the browser would mean
 * reimplementing the hash formula in a second language, and a chain that only
 * validates against a reimplementation of itself proves nothing.
 *
 * Calls the `_for_member` wrapper, not the primitive: CG-008 revoked the latter
 * from PUBLIC because it answered questions about any request id in any
 * organization. No rows back means "not yours", which is deliberately NOT the
 * same as `chain_intact: false`.
 *
 * Manual (`enabled: false` until refetched) because it is O(n) over the trail
 * and answers a question nobody asks on every page load.
 */
export const useQ_Envelope_VerifyChain = ({ envelopeId }: { envelopeId: string }) => {
    const query = useQuery({
        enabled: false,
        queryKey: [...QueryKeys.signature_audit_log.record(envelopeId), "verify-chain"],
        queryFn: async () => {
            const sb_RpcSignatureVerifyChainForMember = await supabase
                .rpc("signature_verify_chain_for_member", { p_request_id: envelopeId })
                .maybeSingle();
            if (sb_RpcSignatureVerifyChainForMember.error)
                throw sb_RpcSignatureVerifyChainForMember.error;
            return sb_RpcSignatureVerifyChainForMember.data;
        },
    });

    return { query, result: query.data ?? null };
};
