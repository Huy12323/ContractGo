import { pdfjs } from "react-pdf";
// `?url` is Vite's asset-URL import: it resolves the path through node_modules
// (works for bare specifiers) and emits the file into the build with a hashed
// filename. Returns the final URL string at runtime.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

// No CDN, no runtime fetch from a third-party host. The worker file is bundled
// alongside the app and served from the same origin.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
