import { afterEach, describe, expect, it, vi } from "vitest";
import { utils_Pdf_ScrollToPage } from "@/components/pdf/utils_Pdf_ScrollToPage";

/**
 * Navigating the document from a citation.
 *
 * The "not mounted" case is the important one: the assistant is reachable from
 * the welcome and sign steps, where no PDF is on screen at all. It must report
 * failure rather than throw — the caller retries once and then lets it go,
 * because a scroll that did not happen is a small disappointment and an
 * exception on the signing surface is not.
 */

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

const mountPages = (count: number) => {
    document.body.innerHTML = Array.from(
        { length: count },
        (_, i) => `<div data-pdf-page="${i + 1}"></div>`
    ).join("");
    // jsdom does not implement scrollIntoView.
    for (const element of Array.from(document.querySelectorAll("[data-pdf-page]"))) {
        (element as HTMLElement).scrollIntoView = vi.fn();
    }
};

describe("utils_Pdf_ScrollToPage", () => {
    it("finds a mounted page by its data attribute and scrolls to it", () => {
        mountPages(5);
        const target = document.querySelector('[data-pdf-page="3"]') as HTMLElement;

        expect(utils_Pdf_ScrollToPage(3)).toBe(true);
        expect(target.scrollIntoView).toHaveBeenCalled();
    });

    it("returns false without throwing when the page is not mounted", () => {
        mountPages(2);
        expect(() => utils_Pdf_ScrollToPage(7)).not.toThrow();
        expect(utils_Pdf_ScrollToPage(7)).toBe(false);
    });

    it("returns false without throwing when nothing is mounted at all", () => {
        expect(utils_Pdf_ScrollToPage(1)).toBe(false);
    });

    it("rejects a page number that cannot be a page", () => {
        mountPages(3);
        expect(utils_Pdf_ScrollToPage(0)).toBe(false);
        expect(utils_Pdf_ScrollToPage(-1)).toBe(false);
        expect(utils_Pdf_ScrollToPage(Number.NaN)).toBe(false);
    });

    it("honours prefers-reduced-motion", () => {
        mountPages(2);
        vi.spyOn(window, "matchMedia").mockImplementation(
            (query: string) =>
                ({
                    matches: query.includes("reduce"),
                    media: query,
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                }) as unknown as MediaQueryList
        );

        const target = document.querySelector('[data-pdf-page="1"]') as HTMLElement;
        utils_Pdf_ScrollToPage(1);

        expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    });
});
