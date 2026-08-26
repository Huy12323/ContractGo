/**
 * api_templates_list — what an integrator needs to construct a valid create call.
 *
 * WITHOUT THIS ENDPOINT THE API IS UNUSABLE. `api_envelopes_create` takes a
 * `template_id`, a recipient per signing `role_id`, and `prefilled_values` keyed
 * by field id — three sets of opaque identifiers that exist only inside a
 * template's pinned version. An integrator with no way to read them would have to
 * copy them out of the builder's URL bar by hand and hard-code them, which breaks
 * silently the next time someone edits the template.
 *
 * So this returns the CONTRACT of each template: its roles (who must be supplied,
 * in what order) and its fields (what may be pre-filled, of what type, and by
 * which role). It reads the LATEST VERSION, which is what `api_envelopes_create`
 * will pin — so what a caller reads here is what its next send will validate
 * against, provided nobody saves the builder in between. That race is inherent
 * and already handled: `validateForSend` refuses and names the mismatch.
 *
 * `member` scope — CG-027 opened template SELECT to any org member, and this
 * exposes strictly less than that policy already allows.
 */

import { jsonResponse } from "../_shared/http.ts";
import { ApiAuthError, resolveApiClient, serveApiFunction } from "../_shared/apiAuth.ts";
import { SENDER_ROLE_ORDER, type SignerRole } from "../_shared/envelopeCompose.ts";

type LayoutField = {
    id?: unknown;
    key?: unknown;
    label?: unknown;
    type?: unknown;
    role_id?: unknown;
    required?: unknown;
    options?: unknown;
    page?: unknown;
};

serveApiFunction("api_templates_list", async (body, req) => {
    const ctx = await resolveApiClient(req, String(body.organization_id ?? ""), "member");

    const includeArchived = body.include_archived === true;

    const { data: templates, error } = await ctx.admin
        .from("contract_templates")
        .select("id, name, entity_id, is_archived, updated_at")
        .eq("organization_id", ctx.organizationId)
        .order("name", { ascending: true });

    if (error) {
        console.error("api_templates_list: lookup failed:", error);
        throw new ApiAuthError(500, "internal_error", "Could not load the templates");
    }

    const visible = (templates ?? []).filter((t) => includeArchived || !t.is_archived);
    if (visible.length === 0) return jsonResponse({ templates: [] }, 200);

    // The latest version per template, in ONE query rather than N. A template
    // with no version yet is not sendable, so it is reported with
    // `sendable: false` rather than omitted — an integrator that cannot find a
    // template it can see in the UI has no way to tell whether it is missing or
    // merely unfinished.
    const { data: versions, error: versionsError } = await ctx.admin
        .from("contract_template_versions")
        // ONE STRING LITERAL — see the note in `api_envelopes_get`. A
        // concatenation degrades the inferred row type to `GenericStringError`.
        .select(
            "id, template_id, version_number, layout, signer_roles, pdf_file_path, default_expiry_days, default_reminder_days"
        )
        .in(
            "template_id",
            visible.map((t) => t.id)
        )
        .order("version_number", { ascending: false });

    if (versionsError) {
        console.error("api_templates_list: versions lookup failed:", versionsError);
        throw new ApiAuthError(500, "internal_error", "Could not load the template versions");
    }

    const latest = new Map<string, (typeof versions)[number]>();
    for (const v of versions ?? []) {
        // Descending order means the first one seen per template is the latest.
        if (!latest.has(v.template_id as string)) latest.set(v.template_id as string, v);
    }

    return jsonResponse(
        {
            templates: visible.map((t) => {
                const version = latest.get(t.id);
                if (!version) {
                    return {
                        id: t.id,
                        name: t.name,
                        entity_id: t.entity_id,
                        is_archived: t.is_archived,
                        sendable: false,
                        reason: "This template has no saved version yet",
                    };
                }

                const roles = (version.signer_roles ?? []) as SignerRole[];
                const layout = (version.layout ?? []) as LayoutField[];

                return {
                    id: t.id,
                    name: t.name,
                    entity_id: t.entity_id,
                    is_archived: t.is_archived,
                    sendable: true,
                    version_id: version.id,
                    version_number: version.version_number,
                    default_expiry_days: version.default_expiry_days,
                    default_reminder_days: version.default_reminder_days,
                    // `order` is the routing position; roles sharing one sign in
                    // parallel (CG-011). `is_sender` marks the role the SENDING
                    // side fills — a recipient must NOT be supplied for it, and
                    // `validateForSend` rejects one that is, so saying which it is
                    // here is the difference between a working first integration
                    // and a confusing 400.
                    roles: roles.map((r) => ({
                        id: r.id,
                        name: r.name,
                        order: r.order,
                        is_sender: r.order === SENDER_ROLE_ORDER,
                    })),
                    // Keyed by `id`, which is what `prefilled_values` takes —
                    // NOT by `key`, which legitimately repeats across roles
                    // ("full_name" for each party) and would collide.
                    fields: layout.map((f) => ({
                        id: f.id,
                        key: f.key,
                        label: f.label,
                        type: f.type,
                        role_id: f.role_id,
                        required: f.required === true,
                        page: f.page,
                        ...(Array.isArray(f.options) ? { options: f.options } : {}),
                    })),
                };
            }),
        },
        200
    );
});
