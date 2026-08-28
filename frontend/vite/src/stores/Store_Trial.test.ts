import { beforeEach, describe, expect, it } from "vitest";
import { Store_Trial, Store_Trial_Actions } from "./Store_Trial";

const pdf = (name = "contract.pdf") => new File([new Uint8Array([1, 2, 3])], name);

beforeEach(() => Store_Trial_Actions.clearPendingFile());

describe("Store_Trial", () => {
    it("starts empty", () => {
        expect(Store_Trial.state.pendingFile).toBeNull();
    });

    it("hands a file across", () => {
        const file = pdf();
        Store_Trial_Actions.setPendingFile(file);
        expect(Store_Trial_Actions.peekPendingFile()).toBe(file);
    });

    it("peeking does NOT consume — the StrictMode hazard", () => {
        // The reason `peek` and `clear` are separate calls. The consumer reads
        // this from a `useState` lazy initialiser, which React.StrictMode
        // double-invokes; a read that also cleared would return the file on the
        // first pass and null on the second, and React keeps the second. The
        // file would then vanish in development and survive in production.
        const file = pdf();
        Store_Trial_Actions.setPendingFile(file);

        expect(Store_Trial_Actions.peekPendingFile()).toBe(file);
        expect(Store_Trial_Actions.peekPendingFile()).toBe(file);
    });

    it("clears, and clearing twice is harmless", () => {
        // StrictMode also double-invokes effects, and the clear lives in one.
        Store_Trial_Actions.setPendingFile(pdf());
        Store_Trial_Actions.clearPendingFile();
        Store_Trial_Actions.clearPendingFile();
        expect(Store_Trial_Actions.peekPendingFile()).toBeNull();
    });

    it("does not hold on to a file after it is cleared", () => {
        // A stale file is a real bug: someone who finishes the trial and later
        // opens /try again must get an empty upload step, not the document they
        // already signed.
        Store_Trial_Actions.setPendingFile(pdf("signed-already.pdf"));
        Store_Trial_Actions.clearPendingFile();
        expect(Store_Trial.state.pendingFile).toBeNull();
    });
});
