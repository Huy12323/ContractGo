import type { OrganizationScope } from "@/providers/organization/Provider_Organization";

/**
 * CG-048. Envelope routes for whichever scope the page was mounted under.
 *
 * The envelope list, composer and detail pages are shared verbatim between an
 * organization (`/$organizationId/envelopes/...`) and the hidden personal
 * workspace (`/me/documents/...`). Everything else about them is already
 * scope-agnostic — they take `organizationId` as a prop and every query and
 * mutation authorizes on it — so the routes were the only thing standing
 * between one implementation and two.
 *
 * WHY A BUILDER AND NOT A SECOND COPY OF THE PAGES. The alternative was to
 * duplicate three pages under a personal namespace. That splits the composer,
 * which is the most intricate component in the app and carries comments about
 * two already-fixed ordering bugs; a copy of it would drift from the original
 * the first time either was touched.
 *
 * Returns `{ to, params }` only. `search` stays at the call site because it is
 * genuinely per-call — the list passes a status tab, the composer passes `{}` —
 * and folding it in here would mean this file knowing each page's search schema.
 *
 * The personal routes take no `organizationId` param: the personal workspace is
 * never named in a URL. That is the point of CG-048's PHASE 3, which drops it
 * from `get_my_member_organizations` and so from the `$organizationId` guard —
 * personal documents are reachable through `/me/*` or not at all.
 */
export const Utils_Scope_Route = {
    envelopes: (scope: OrganizationScope, organizationId: string) =>
        scope === "personal"
            ? ({ to: "/me/documents", params: {} } as const)
            : ({ to: "/$organizationId/envelopes", params: { organizationId } } as const),

    envelopeNew: (scope: OrganizationScope, organizationId: string) =>
        scope === "personal"
            ? ({ to: "/me/documents/new", params: {} } as const)
            : ({ to: "/$organizationId/envelopes/new", params: { organizationId } } as const),

    envelopeDetail: (scope: OrganizationScope, organizationId: string, envelopeId: string) =>
        scope === "personal"
            ? ({ to: "/me/documents/$envelopeId", params: { envelopeId } } as const)
            : ({
                  to: "/$organizationId/envelopes/$envelopeId",
                  params: { organizationId, envelopeId },
              } as const),

    envelopeEdit: (scope: OrganizationScope, organizationId: string, envelopeId: string) =>
        scope === "personal"
            ? ({ to: "/me/documents/$envelopeId/edit", params: { envelopeId } } as const)
            : ({
                  to: "/$organizationId/envelopes/$envelopeId/edit",
                  params: { organizationId, envelopeId },
              } as const),
} as const;
