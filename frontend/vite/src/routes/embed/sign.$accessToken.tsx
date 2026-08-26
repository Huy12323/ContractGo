// `/embed/sign/{token}` — the same ceremony as `/sign/{token}`, rendered to be
// framed.
//
// The token is in the PATH for the same reason it is on the public route: it is
// what a URL can carry. `Page_Sign` still sends it in a POST body and never as a
// query string, and opening this page still does not consume it.
//
// The credential behind this URL is NOT the emailed one. It was minted by
// `api_envelopes_embed-url` with a fifteen-minute life and a three-use cap, was
// never sent through a mail server, and carries the single origin this session
// may report progress to. `embedded` is what turns that origin into
// `postMessage` events; everything else about the ceremony is identical, which
// is the point — an embedded signature and a mailed one produce the same
// document, the same chain and the same certificate.

import { createFileRoute } from "@tanstack/react-router";
import { Page_Sign } from "@/pages/Page_Sign/Page_Sign";

export const Route = createFileRoute("/embed/sign/$accessToken")({
    component: EmbedSignRoute,
});

function EmbedSignRoute() {
    const { accessToken } = Route.useParams();
    return <Page_Sign accessToken={accessToken} embedded />;
}
