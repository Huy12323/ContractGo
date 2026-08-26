// `/verify` — public document verification.
//
// NO ROUTE PARAMETER, and that is the security decision rather than a shortcut.
// The v1.0 roadmap sketched `/verify/$documentId`, but a document id is short,
// enumerable, and ends up in URLs, browser history, `Referer` headers and server
// logs — a public path keyed on one is an oracle for "does envelope X exist".
//
// The credential here is the SHA-256 of the file the visitor already holds. It
// cannot be minted or guessed, it can only be produced by someone in possession
// of the document, and it travels in a POST body for the same reason the signing
// token does. So the route is a bare page and the address bar carries nothing.
//
// It sits under `_public`, which has no `beforeLoad` guard and no
// redirect-if-authenticated: the visitor is a counterparty with no account, and
// a signed-in ContractGo user checking someone else's document must not be
// bounced to their dashboard either.

import { createFileRoute } from "@tanstack/react-router";
import { Page_Verify } from "@/pages/Page_Verify/Page_Verify";

export const Route = createFileRoute("/_public/verify")({
    component: Page_Verify,
});
