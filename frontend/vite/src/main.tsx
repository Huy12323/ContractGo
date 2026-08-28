import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider_ANTD } from "@/providers/antd/Provider_ANTD";
import { Provider_SupabaseRealtimeSync } from "@/providers/realtime/Provider_SupabaseRealtimeSync";
import { queryClient } from "@/configs/query/config";
import { routeTree } from "./routeTree.gen";
import { Store_Auth_Actions } from "@/stores/Store_Auth";
import "@/styles/global.css";

// `@/configs/pdfjs/config` USED TO BE IMPORTED HERE and deliberately is not any
// more (CG-052). It pulls in react-pdf, the pdfjs-dist worker and two
// stylesheets, and importing it from the entry put all of that in the entry
// chunk — so every visitor to the public landing page downloaded a PDF renderer
// they will never use.
//
// It now lives in `App_PdfDocument`, the single component every PDF surface in
// the product renders through, so the worker is still configured before any PDF
// is parsed. Moving an initialisation side effect is exactly the kind of change
// that looks arbitrary later, hence this note at the place it left.

const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}

// Initialize auth listener before rendering
Store_Auth_Actions.initAuth();

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <Provider_SupabaseRealtimeSync>
                <Provider_ANTD>
                    <RouterProvider router={router} />
                </Provider_ANTD>
            </Provider_SupabaseRealtimeSync>
        </QueryClientProvider>
    </React.StrictMode>
);
