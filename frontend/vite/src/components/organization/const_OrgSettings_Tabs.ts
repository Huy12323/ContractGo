/**
 * The organization settings strip, as data.
 *
 * Extracted because THREE things read it and they must not drift: the desktop
 * `Tabs` items, the mobile `Select` options, and the `activeKey` derivation that
 * decides which of them is lit. Two tabs could be written out inline three times
 * and stay consistent by luck; seven cannot.
 *
 * The array is `as const` and NOT annotated, so the `to` values stay route
 * literals — that is what makes a tab pointing at a route that does not exist a
 * type error rather than a dead link. `satisfies` below still checks the shape.
 */

type OrgSettingsTabShape = {
    key: string;
    label: string;
    /** Route path, with `$organizationId` still a parameter. */
    to: string;
    /**
     * URL segments under `/{orgId}/settings/` that light this tab, matched by
     * PREFIX so a future nested route keeps its parent lit rather than clearing
     * the whole strip.
     *
     * A LIST, not a single value, because Integrations owns two of them. Its
     * children live under a PATHLESS layout (`_integrations/`), which is the
     * whole point: `/settings/api-keys` and `/settings/webhooks` keep the exact
     * URLs `docs/api.md` already promises, while gaining a shared sub-strip.
     * So the segment a tab matches and the route id it renders under genuinely
     * disagree, and parsing `to` would get it wrong.
     */
    segments: readonly string[];
    /**
     * Hidden from the strip entirely for anyone but the owner.
     *
     * Note the asymmetry with the tabs that are merely owner-WRITE (General,
     * Branding, Documents): those stay VISIBLE and render disabled, because RLS
     * SELECT on `organizations` is `is_org_member` — an admin may legitimately
     * read those values, and hiding the fields only raises "where did the name
     * go". Danger zone has nothing to read; it is only an action, so there is
     * nothing to show an admin.
     */
    ownerOnly?: boolean;
    /**
     * Renders with a departure icon and can never become `activeKey`. Members
     * links OUT to `/people` rather than embedding it — see the layout route.
     */
    external?: boolean;
};

export const const_OrgSettings_Tabs = [
    {
        key: "general",
        label: "General",
        to: "/$organizationId/settings/general",
        segments: ["general"],
    },
    {
        key: "branding",
        label: "Branding",
        to: "/$organizationId/settings/branding",
        segments: ["branding"],
    },
    {
        key: "members",
        label: "Members",
        to: "/$organizationId/people",
        // Empty: nothing under `/settings/` can light this, which is correct —
        // it is a link off this surface, not a tab of it.
        segments: [],
        external: true,
    },
    {
        key: "documents",
        label: "Document defaults",
        to: "/$organizationId/settings/documents",
        segments: ["documents"],
    },
    {
        key: "integrations",
        label: "Integrations",
        // Lands on the first sub-tab. There is no `/settings/integrations` URL
        // and deliberately so — the layout under it is pathless.
        to: "/$organizationId/settings/api-keys",
        segments: ["api-keys", "webhooks"],
    },
    {
        key: "billing",
        label: "Billing",
        to: "/$organizationId/settings/billing",
        segments: ["billing"],
    },
    {
        key: "danger",
        label: "Danger zone",
        to: "/$organizationId/settings/danger",
        segments: ["danger"],
        ownerOnly: true,
    },
] as const satisfies readonly OrgSettingsTabShape[];

export type OrgSettingsTab = (typeof const_OrgSettings_Tabs)[number];

/** The tab `/settings` itself redirects to. */
export const ORG_SETTINGS_DEFAULT_TAB = "general";

/**
 * The secondary strip inside Integrations. Same shape, same reasons — the
 * sub-strip and its `activeKey` are two readers of one list.
 */
export const const_OrgSettings_IntegrationTabs = [
    {
        key: "api-keys",
        label: "API keys",
        to: "/$organizationId/settings/api-keys",
        segments: ["api-keys"],
    },
    {
        key: "webhooks",
        label: "Webhooks",
        to: "/$organizationId/settings/webhooks",
        segments: ["webhooks"],
    },
] as const satisfies readonly OrgSettingsTabShape[];

/**
 * Which tab of `tabs` the current URL lights, or `fallback` when none does.
 *
 * Prefix-matched on `segments` for the reason stated on that field. `members`
 * cannot win because its segment list is empty by construction.
 */
export function resolveOrgSettingsTab(
    pathname: string,
    organizationId: string,
    tabs: readonly OrgSettingsTabShape[] = const_OrgSettings_Tabs,
    fallback: string = ORG_SETTINGS_DEFAULT_TAB
): string {
    const base = `/${organizationId}/settings/`;
    const match = tabs.find((tab) =>
        tab.segments.some((segment) => pathname.startsWith(base + segment))
    );
    return match?.key ?? fallback;
}
