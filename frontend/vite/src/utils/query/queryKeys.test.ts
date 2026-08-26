import { describe, expect, it } from "vitest";
import { QueryKeys } from "./queryKeys";

/**
 * The `satisfies Record<TableName, …>` clause in queryKeys.ts already makes the
 * BUILD fail if a table is added or dropped without updating this factory. What
 * it cannot catch is the key STRING drifting from the table name — and
 * Provider_SupabaseRealtimeSync matches realtime events by string equality, so
 * that drift silently unwires the event bus with no type error and no runtime
 * throw. The `invitations` entry (renamed from `admin_invitations` in CG-020)
 * carries a comment saying exactly this.
 */
describe("QueryKeys", () => {
    const entries = Object.entries(QueryKeys);

    it("has entries", () => {
        expect(entries.length).toBeGreaterThan(0);
    });

    it.each(entries)("%s: the key string equals the table name", (name, factory) => {
        // If this fails, realtime invalidation for this table is broken even
        // though everything still compiles.
        expect(factory.all()).toEqual([name]);
    });

    it.each(entries)("%s: list() and record() extend all()", (name, factory) => {
        expect(factory.list()).toEqual([name, "list"]);
        expect(factory.record("abc123")).toEqual([name, "record", "abc123"]);
    });

    it("keeps list and record namespaces distinct", () => {
        // Both are prefixed by all(), so an invalidate on all() catches both —
        // but a record must never collide with the list.
        const { organizations } = QueryKeys;
        expect(organizations.list()).not.toEqual(organizations.record("list"));
    });
});
