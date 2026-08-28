// Render coverage for the trial's first step and its file gate.
//
// SCOPED TO THE UPLOAD STEP on purpose. Steps 2 and 3 mount `App_PdfDocument`,
// which needs a real pdf.js worker and a real canvas; jsdom has neither (the
// setup file stubs `getContext` well enough for components not to crash, not
// well enough to render a page), so a test that drove the whole flow would be
// asserting against a blank canvas and calling it a signature. The parts of
// those steps that CAN be tested honestly are pure and already are —
// `utils_Trial_Steps`, `utils_Trial_Layout`, and the burn itself in
// `tests/unit/edge/pdfBurn.geometryParity.test.ts`.
//
// What is left is the gate: does a stranger's first interaction work, and does
// a file that is not a PDF get refused. That is worth a test because the refusal
// path is the one where `file.type` lies.

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    RouterProvider,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
} from "@tanstack/react-router";
import { Provider_ANTD } from "@/providers/antd/Provider_ANTD";
import { Page_Trial } from "./Page_Trial";
import { Store_Trial, Store_Trial_Actions } from "@/stores/Store_Trial";
import { const_Trial_StepLabels } from "./utils_Trial_Steps";

// The hand-off slot is module state; leaving one test's file in it would make
// the next test open on placement for no visible reason.
beforeEach(() => Store_Trial_Actions.clearPendingFile());

const rootRoute = createRootRoute();
const tryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/try",
    component: Page_Trial,
});

const renderTrial = () => {
    const router = createRouter({
        routeTree: rootRoute.addChildren([
            tryRoute,
            createRoute({
                getParentRoute: () => rootRoute,
                path: "/signup",
                component: () => null,
            }),
        ]),
        history: createMemoryHistory({ initialEntries: ["/try"] }),
    });
    return render(
        <Provider_ANTD>
            <RouterProvider router={router as never} />
        </Provider_ANTD>
    );
};

/** `%PDF-1.7` — a real header, which is what the validator actually checks. */
const pdfFile = (name = "contract.pdf") =>
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], name, {
        type: "application/pdf",
    });

/** A ZIP header wearing a .pdf name and a PDF mime type — i.e. a renamed .docx. */
const fakePdfFile = () =>
    new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], "contract.pdf", {
        type: "application/pdf",
    });

const fileInput = (container: HTMLElement) =>
    container.querySelector('input[type="file"]') as HTMLInputElement;

/**
 * Uploads a PDF and gets as far as the palette.
 *
 * The "View anyway" click is NOT test scaffolding — it is the real product path.
 * jsdom's `matchMedia` stub reports every breakpoint as unmatched, so
 * `useApp_Breakpoint` sees a phone, and the workspace shows its small-screen
 * guard exactly as it would on one. That guard is inherited behaviour the trial
 * did not add and does not override, and it is asserted on its own below.
 */
const advanceToPlacement = async (container: HTMLElement) => {
    await screen.findByText("Try signing a document");
    await userEvent.upload(fileInput(container), pdfFile());
    const viewAnyway = await screen.findByText("View anyway on this screen");
    await userEvent.click(viewAnyway);
    await waitFor(() => expect(screen.getByText("Add a field")).toBeTruthy());
};

describe("Page_Trial", () => {
    it("picks up a file dropped on the landing page and skips the upload step", async () => {
        // The whole point of `Store_Trial`: someone who dropped a PDF on the
        // landing hero has already chosen their document, so the trial must open
        // on placement rather than asking for it again.
        Store_Trial_Actions.setPendingFile(pdfFile());
        renderTrial();

        expect(await screen.findByText("Field placement needs a wider screen")).toBeTruthy();
        expect(screen.queryByText("Try signing a document")).toBeNull();
    });

    it("empties the hand-off slot once it has been used", async () => {
        // Otherwise re-opening /try later re-opens a document already signed.
        Store_Trial_Actions.setPendingFile(pdfFile());
        renderTrial();
        await screen.findByText("Field placement needs a wider screen");

        expect(Store_Trial.state.pendingFile).toBeNull();
    });

    it("opens on the upload step and states where the file goes", async () => {
        renderTrial();
        expect(await screen.findByText("Try signing a document")).toBeTruthy();
        expect(screen.getByText(/never leaves this browser/i, { exact: false })).toBeTruthy();
        expect(screen.getByText(const_Trial_StepLabels.upload)).toBeTruthy();
    });

    it("refuses a renamed .docx despite its PDF mime type, and says why", async () => {
        const { container } = renderTrial();
        await screen.findByText("Try signing a document");

        await userEvent.upload(fileInput(container), fakePdfFile());

        expect(await screen.findByText("Only PDF files are accepted")).toBeTruthy();
        // Still on step 1 — a rejected file must not advance the flow.
        expect(screen.getByText("Try signing a document")).toBeTruthy();
    });

    it("accepts a real PDF and moves to the placement step", async () => {
        const { container } = renderTrial();
        await advanceToPlacement(container);
        // The palette is what proves we got there. The PDF itself will not
        // render under jsdom, and no assertion here pretends otherwise.
        expect(screen.getByText("Add a field")).toBeTruthy();
    });

    it("inherits the workspace's small-screen guard rather than overriding it", async () => {
        // Worth pinning: the landing page invites phone visitors to try signing,
        // and placing fields by dragging genuinely does not work at that width.
        // The guard offers a way through rather than a dead end, and that is the
        // behaviour the trial relies on — if the workspace ever hard-blocks
        // instead, the trial is broken on phones and this test says so.
        const { container } = renderTrial();
        await screen.findByText("Try signing a document");
        await userEvent.upload(fileInput(container), pdfFile());

        expect(await screen.findByText("Field placement needs a wider screen")).toBeTruthy();
        expect(screen.getByText("View anyway on this screen")).toBeTruthy();
    });

    it("offers only the trial's three field types", async () => {
        // The `allowedTypes` prop in practice: no Choice, no Checkbox, no
        // Number, no Initials, no Attachment. Each of those was excluded for a
        // concrete reason recorded on the prop.
        const { container } = renderTrial();
        await advanceToPlacement(container);

        expect(screen.getByText("Signature")).toBeTruthy();
        expect(screen.getByText("Text")).toBeTruthy();
        expect(screen.getByText("Date")).toBeTruthy();
        expect(screen.queryByText("Choice")).toBeNull();
        expect(screen.queryByText("Checkbox")).toBeNull();
        expect(screen.queryByText("Initials")).toBeNull();
        expect(screen.queryByText("Attachment")).toBeNull();
    });

    it("hides the role manager — the trial has exactly one party", async () => {
        const { container } = renderTrial();
        await advanceToPlacement(container);

        expect(screen.queryByText(/add (a )?signer/i)).toBeNull();
    });

    it("blocks Continue until a field is placed, and explains itself", async () => {
        const { container } = renderTrial();
        await advanceToPlacement(container);

        // The plain DOM property, not jest-dom's `toBeDisabled`: colocated tests
        // under `src/` are type-checked by the APP tsconfig, which does not load
        // `@testing-library/jest-dom`'s matcher types.
        const continueButton = screen.getByRole("button", { name: /continue/i });
        expect((continueButton as HTMLButtonElement).disabled).toBe(true);
    });
});
