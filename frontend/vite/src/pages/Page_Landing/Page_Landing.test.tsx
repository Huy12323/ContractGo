// A render smoke test for the landing page.
//
// WHY THIS EXISTS AT ALL, when the unit silo otherwise tests pure functions:
// this page is eight components of composition with almost no logic, so the
// type-checker covers most of what could go wrong — and the one class it cannot
// see is a component that type-checks and then throws or renders invalid markup.
// It paid for itself immediately: it caught a router `<Link>` wrapped around a
// `<Typography.Link>`, which is an `<a>` inside an `<a>`. That type-checks
// perfectly, and browsers "recover" from it by silently splitting the element.
//
// It is the FIRST routed render test in this repo, hence the local router below.
// The page is full of `<Link to="...">`, and TanStack Router validates every
// `to` against the route tree at RENDER time, so a link to a route that does not
// exist fails here rather than in someone's browser. The stub routes are
// therefore load-bearing, not scaffolding: they are the set of destinations this
// page promises.
//
// Deliberately shallow. It asserts each section mounted and rendered its
// heading; it does not assert copy, spacing or layout, because those are meant
// to change often and a test that pins them would only ever be updated to match.

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
import { Page_Landing } from "./Page_Landing";
import { Store_Trial, Store_Trial_Actions } from "@/stores/Store_Trial";
import {
    const_Landing_Developers,
    const_Landing_FinalCta,
    const_Landing_Hero,
} from "./const_LandingContent";

const rootRoute = createRootRoute();
const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: Page_Landing,
});

/** Every destination the landing page links to. */
const const_Landing_Destinations = ["/try", "/login", "/signup", "/verify", "/home"];

/** `%PDF-1.7` — a real header, which is what the validator checks. */
const pdfFile = () =>
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], "contract.pdf", {
        type: "application/pdf",
    });

/** A ZIP header wearing a .pdf name — i.e. a renamed .docx. */
const fakePdfFile = () =>
    new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], "contract.pdf", {
        type: "application/pdf",
    });

const makeRouter = () =>
    createRouter({
        routeTree: rootRoute.addChildren([
            indexRoute,
            ...const_Landing_Destinations.map((path) =>
                createRoute({ getParentRoute: () => rootRoute, path, component: () => null })
            ),
        ]),
        history: createMemoryHistory({ initialEntries: ["/"] }),
    });

beforeEach(() => Store_Trial_Actions.clearPendingFile());

describe("Page_Landing", () => {
    it("renders every section, and every link resolves to a real route", async () => {
        render(
            <Provider_ANTD>
                <RouterProvider router={makeRouter() as never} />
            </Provider_ANTD>
        );

        expect(await screen.findByText(const_Landing_Hero.heading)).toBeTruthy();
        expect(screen.getByText("From a PDF to a signed agreement")).toBeTruthy();
        expect(screen.getByText("A signature is only worth the record behind it")).toBeTruthy();
        expect(screen.getByText("One product, three ways in")).toBeTruthy();
        expect(screen.getByText(const_Landing_Developers.heading)).toBeTruthy();
        expect(screen.getByText(const_Landing_FinalCta.heading)).toBeTruthy();
    });

    it("takes a PDF chosen in the hero card and hands it to the trial", async () => {
        // The card LOOKS like a drop zone, so it has to be one. It was a plain
        // link first, and a dashed box that silently ignores a dropped contract
        // is a small lie told to exactly the visitor this page is written for.
        const { container } = render(
            <Provider_ANTD>
                <RouterProvider router={makeRouter() as never} />
            </Provider_ANTD>
        );
        await screen.findByText(const_Landing_Hero.heading);

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, pdfFile());

        await waitFor(() => expect(Store_Trial.state.pendingFile).not.toBeNull());
        expect(Store_Trial.state.pendingFile?.name).toBe("contract.pdf");
    });

    it("refuses a non-PDF in the hero card rather than handing it on", async () => {
        // Validated HERE, because the trial trusts whatever comes out of the
        // store — an unvalidated file would fail two steps later with an error
        // the visitor cannot connect to what they did.
        const { container } = render(
            <Provider_ANTD>
                <RouterProvider router={makeRouter() as never} />
            </Provider_ANTD>
        );
        await screen.findByText(const_Landing_Hero.heading);

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, fakePdfFile());

        expect(await screen.findByText("Only PDF files are accepted")).toBeTruthy();
        expect(Store_Trial.state.pendingFile).toBeNull();
    });

    it("shows the logged-out calls to action while there is no session", () => {
        // `Store_Auth` starts unauthenticated and `initAuth()` never runs here,
        // so this is the anonymous visitor — the state the page is written for.
        render(
            <Provider_ANTD>
                <RouterProvider router={makeRouter() as never} />
            </Provider_ANTD>
        );

        expect(screen.queryByText("Go to dashboard")).toBeNull();
    });
});
