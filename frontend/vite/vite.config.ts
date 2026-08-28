import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";

export default defineConfig({
    plugins: [
        // `autoCodeSplitting` (CG-052) makes the generated route tree import each
        // route's component lazily instead of statically. Without it,
        // `routeTree.gen.ts` eagerly imports all ~40 routes, so opening the
        // public landing page downloaded the template builder, the envelope
        // composer, TipTap and the signing ceremony along with it.
        //
        // Route-level only. It does not split what a route imports directly —
        // pdf-lib and pdf.js are kept out of the entry chunk by their own
        // dynamic imports (see `utils_PdfBurn_Client.ts` and
        // `App_PdfDocument.tsx`), not by this flag.
        TanStackRouterVite({
            autoCodeSplitting: true,
            // Colocated tests. Without this the generator treats every
            // `*.test.tsx` under `src/routes/` as a route file that forgot to
            // export a `Route`, and warns on each one at every build and dev
            // start. A route's `beforeLoad` is worth testing beside the route it
            // guards, so the tests stay and the generator learns to skip them.
            routeFileIgnorePattern: "\\.test\\.tsx?$",
        }),
        react(),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5173,
    },
});
