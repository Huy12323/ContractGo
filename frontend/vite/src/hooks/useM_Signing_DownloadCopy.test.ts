import { describe, expect, it } from "vitest";
import { utils_Signing_CopyFilename } from "@/hooks/useM_Signing_DownloadCopy";

// The filename is the only part of the download the signer keeps looking at, and
// it is derived from text a SENDER typed — so it is the one place in this feature
// where untrusted input reaches a filesystem API. These assertions are about the
// characters that make a name unusable rather than about wording.
describe("utils_Signing_CopyFilename", () => {
    it("keeps an ordinary title intact, hyphens included", () => {
        expect(utils_Signing_CopyFilename("Non-Disclosure Agreement")).toBe(
            "Non-Disclosure Agreement.pdf"
        );
    });

    it("strips path syntax so the name cannot be read as a directory", () => {
        // A browser that sanitises these itself does so inconsistently — one turns
        // them into underscores, another keeps only the tail after the last slash.
        expect(utils_Signing_CopyFilename("Q1/Q2 Contract")).toBe("Q1 Q2 Contract.pdf");
        expect(utils_Signing_CopyFilename("C:\\Users\\admin\\deal")).toBe("C Users admin deal.pdf");
    });

    it("removes the Windows-reserved characters", () => {
        expect(utils_Signing_CopyFilename('Deal *?"<>| terms')).toBe("Deal terms.pdf");
    });

    it("drops control characters rather than writing them into a filename", () => {
        expect(utils_Signing_CopyFilename("Lease\u0000\u001f\u007fAgreement")).toBe(
            "LeaseAgreement.pdf"
        );
    });

    it("collapses runs of whitespace left behind by the stripping", () => {
        expect(utils_Signing_CopyFilename("A  //  B")).toBe("A B.pdf");
    });

    it("trims a trailing dot or space, which Windows strips on save", () => {
        // Left in place it would leave the extension looking doubled.
        expect(utils_Signing_CopyFilename("Amendment .")).toBe("Amendment.pdf");
    });

    it("caps the length, leaving room for the extension", () => {
        const name = utils_Signing_CopyFilename("x".repeat(300));
        expect(name).toHaveLength(124);
        expect(name.endsWith(".pdf")).toBe(true);
    });

    it("falls back rather than producing a file called only '.pdf'", () => {
        // A title of nothing but path syntax is degenerate but reachable, and a
        // bare-extension filename is the one output no signer could identify.
        expect(utils_Signing_CopyFilename("///")).toBe("Signed document.pdf");
        expect(utils_Signing_CopyFilename("   ")).toBe("Signed document.pdf");
    });
});
