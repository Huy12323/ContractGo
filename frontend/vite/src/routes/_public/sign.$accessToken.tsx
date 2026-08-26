// `/sign/{token}` — the URL the emailed link points at.
//
// The token is in the PATH because that is what an email link can carry, but it
// goes no further: `Page_Sign` sends it in a POST body, never as a query string
// (query strings leak through `Referer` headers and server logs), and opening
// this page does not consume it. Corporate mail scanners pre-fetch links, so a
// landing page that consumed a single-use token would silently burn the
// signer's link before they ever clicked it — hence the use-count cap in
// `signer_access_tokens` rather than strict single use.

import { createFileRoute } from "@tanstack/react-router";
import { Page_Sign } from "@/pages/Page_Sign/Page_Sign";

export const Route = createFileRoute("/_public/sign/$accessToken")({
    component: SignRoute,
});

function SignRoute() {
    const { accessToken } = Route.useParams();
    return <Page_Sign accessToken={accessToken} />;
}
