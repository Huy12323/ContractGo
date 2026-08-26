import { describe, expect, it } from "vitest";
import { Utils_Scope_Route } from "@/utils/Utils_Scope_Route";

// CG-048. These assertions are about the ROUTE CONTRACT, not about formatting.
//
// The personal cases each assert that `params` carries no `organizationId`. That
// is the part worth a test: the personal workspace must never be named in a URL,
// because CG-048's PHASE 3 removed it from `get_my_member_organizations` and so
// from the `$organizationId` route guard. A personal link that leaked the id
// would resolve to a route that redirects to Home — a dead link that type-checks.
const ORG = "org_realorganization01";
const ENVELOPE = "sgr_envelope01";

describe("Utils_Scope_Route", () => {
    describe("org scope", () => {
        it("points the list at the organization route with the id as a param", () => {
            expect(Utils_Scope_Route.envelopes("org", ORG)).toEqual({
                to: "/$organizationId/envelopes",
                params: { organizationId: ORG },
            });
        });

        it("points the composer at the organization route", () => {
            expect(Utils_Scope_Route.envelopeNew("org", ORG)).toEqual({
                to: "/$organizationId/envelopes/new",
                params: { organizationId: ORG },
            });
        });

        it("carries both ids for the detail route", () => {
            expect(Utils_Scope_Route.envelopeDetail("org", ORG, ENVELOPE)).toEqual({
                to: "/$organizationId/envelopes/$envelopeId",
                params: { organizationId: ORG, envelopeId: ENVELOPE },
            });
        });

        it("carries both ids for the edit route", () => {
            expect(Utils_Scope_Route.envelopeEdit("org", ORG, ENVELOPE)).toEqual({
                to: "/$organizationId/envelopes/$envelopeId/edit",
                params: { organizationId: ORG, envelopeId: ENVELOPE },
            });
        });
    });

    describe("personal scope", () => {
        it("points the list at /me/documents and names no organization", () => {
            expect(Utils_Scope_Route.envelopes("personal", ORG)).toEqual({
                to: "/me/documents",
                params: {},
            });
        });

        it("points the composer at /me/documents/new and names no organization", () => {
            expect(Utils_Scope_Route.envelopeNew("personal", ORG)).toEqual({
                to: "/me/documents/new",
                params: {},
            });
        });

        it("carries the envelope id only for the detail route", () => {
            expect(Utils_Scope_Route.envelopeDetail("personal", ORG, ENVELOPE)).toEqual({
                to: "/me/documents/$envelopeId",
                params: { envelopeId: ENVELOPE },
            });
        });

        it("carries the envelope id only for the edit route", () => {
            expect(Utils_Scope_Route.envelopeEdit("personal", ORG, ENVELOPE)).toEqual({
                to: "/me/documents/$envelopeId/edit",
                params: { envelopeId: ENVELOPE },
            });
        });

        it("never leaks the organization id into any personal route", () => {
            const links = [
                Utils_Scope_Route.envelopes("personal", ORG),
                Utils_Scope_Route.envelopeNew("personal", ORG),
                Utils_Scope_Route.envelopeDetail("personal", ORG, ENVELOPE),
                Utils_Scope_Route.envelopeEdit("personal", ORG, ENVELOPE),
            ];
            for (const link of links) {
                expect(link.to.startsWith("/me/")).toBe(true);
                expect(Object.values(link.params)).not.toContain(ORG);
            }
        });
    });
});
