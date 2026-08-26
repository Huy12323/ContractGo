import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

// One envelope, with its parties.
//
// `template_snapshot` comes along deliberately: the detail page renders what was
// SENT, and resolving fields through `contract_templates` would show whatever
// the template says today. The template may have been edited or hard-deleted
// since (AHR-1487/1490/1954) — the snapshot is the only honest source, and it is
// the same JSON the signer surface and the burn pipeline read.

const fetchEnvelope = async (envelopeId: string) => {
    const sb_FromSignatureRequests_Select = await supabase
        .from("signature_requests")
        // ONE string literal — see the note in `useQ_Tables_Envelopes.ts`:
        // concatenation widens to `string` and the row type degrades to
        // `GenericStringError` with no error at the call site.
        .select(
            "id, organization_id, template_id, template_version_id, title, status, current_order, source_pdf_r2_key, source_pdf_sha256, signed_pdf_r2_key, signed_pdf_sha256, template_snapshot, prefilled_values, sent_at, completed_at, expires_at, reminder_days, signer_auth, require_identity_check, created_at, created_by, certificate_r2_key, certificate_sha256, certificate_generated_at, certificate_events_seq, certificate_chain_intact, signature_request_signers(id, signer_name, signer_email, signer_phone, signer_order, role_id, recipient_type, status, notified_at, viewed_at, signed_at, decline_reason, changes_requested_reason, field_values, last_reminded_at, reminder_count, auth_method, require_identity_check)"
        )
        .eq("id", envelopeId)
        .single();
    if (sb_FromSignatureRequests_Select.error) throw sb_FromSignatureRequests_Select.error;
    return sb_FromSignatureRequests_Select.data;
};

export type Tables_Envelope_QueryData = Awaited<ReturnType<typeof fetchEnvelope>>;
export type Tables_Envelope_Signer = Tables_Envelope_QueryData["signature_request_signers"][number];

export const useQ_Tables_Envelope = ({ envelopeId }: { envelopeId: string }) => {
    const query = useQuery({
        enabled: !!envelopeId,
        queryKey: QueryKeys.signature_requests.record(envelopeId),
        queryFn: () => fetchEnvelope(envelopeId),
    });

    return { query, envelope: query.data ?? null };
};
