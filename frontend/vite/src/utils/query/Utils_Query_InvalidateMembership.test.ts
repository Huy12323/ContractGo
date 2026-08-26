import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { QueryKeys } from "./queryKeys";
import { Utils_Query_InvalidateMembership } from "./Utils_Query_InvalidateMembership";

/**
 * Shared by the three membership mutations so they cannot drift apart. The
 * failure mode is silent and looks like "the UI didn't update for one action",
 * which is why it is worth pinning rather than trusting to review.
 */
describe("Utils_Query_InvalidateMembership", () => {
    const run = (organizationId = "org_1") => {
        const invalidateQueries = vi.fn();
        Utils_Query_InvalidateMembership(
            { invalidateQueries } as unknown as QueryClient,
            organizationId
        );
        return invalidateQueries.mock.calls.map(([arg]) => arg.queryKey);
    };

    it("invalidates all eight key prefixes", () => {
        expect(run()).toHaveLength(8);
    });

    it("covers the three membership list tables, scoped to the organization", () => {
        const keys = run();
        expect(keys).toContainEqual([...QueryKeys.admins.list(), "org_1"]);
        expect(keys).toContainEqual([...QueryKeys.members.list(), "org_1"]);
        expect(keys).toContainEqual([...QueryKeys.invitations.list(), "org_1"]);
    });

    it("covers the four easy-to-forget org-record keys", () => {
        // `role` and `capabilities` drive every permission check on the page,
        // `owner` drives the owner row, and `person` is usually showing the
        // person who just changed.
        const keys = run();
        for (const suffix of ["owner", "role", "person", "capabilities"]) {
            expect(keys).toContainEqual([...QueryKeys.organizations.record("org_1"), suffix]);
        }
    });

    // CG-027: promoting a member to admin grants both permissions implicitly, so
    // a role change has to drop the capabilities cache as well as the role one.
    // Missing this leaves the newly-promoted admin looking at a disabled "New
    // template" button until they reload.
    it("covers the capabilities key, which a role change also invalidates", () => {
        expect(run()).toContainEqual([...QueryKeys.organizations.record("org_1"), "capabilities"]);
    });

    it("covers the org switcher list, which must drop an org the user just left", () => {
        expect(run()).toContainEqual([...QueryKeys.organizations.list(), "mine"]);
    });

    it("scopes every key to the organization it was given", () => {
        for (const key of run("org_other")) {
            expect(JSON.stringify(key)).not.toContain("org_1");
        }
    });

    it("leaves the person key un-scoped by user so prefix matching covers all open records", () => {
        const personKey = run().find((k) => k.at(-1) === "person")!;
        expect(personKey).toEqual(["organizations", "record", "org_1", "person"]);
    });
});
