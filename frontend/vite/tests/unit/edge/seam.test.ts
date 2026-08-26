import { describe, expect, it } from "vitest";
import { firstSignerOrder } from "../../../supabase/functions/_shared/envelopeCompose.ts";

/**
 * V-SEAM. Guards the two assumptions that make every other edge test possible:
 * the `supabase` bare-specifier alias in vitest.config.ts, and the module-scope
 * `Deno` global from tests/setup/deno-shim.ts. If this file fails, no other test
 * under tests/unit/edge/ can run — fix the shim, don't delete the test.
 */
describe("edge-function import seam", () => {
    it("imports a pure function out of _shared without a Deno runtime", () => {
        expect(typeof firstSignerOrder).toBe("function");
    });
});
