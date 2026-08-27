import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/settings` has no content of its own — it lands on the first tab.
 *
 * That first tab is General since CG-050, which promoted this surface from two
 * integration tabs to the full organization settings. It used to be API keys.
 *
 * A `beforeLoad` redirect rather than a component that navigates in an effect:
 * the redirect happens before anything renders, so there is no frame in which an
 * empty settings shell is visible and no entry added to the history stack that
 * the back button would have to walk through.
 *
 * `replace` for that second reason specifically. Without it, going back from
 * `/settings/general` would land on `/settings`, which would immediately
 * redirect forward again — a back button that does nothing.
 */
export const Route = createFileRoute("/_protected/$organizationId/settings/")({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: "/$organizationId/settings/general",
            params: { organizationId: params.organizationId },
            replace: true,
        });
    },
});
