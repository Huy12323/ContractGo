import { useNavigate } from "@tanstack/react-router";
import { App, Badge, Button, Tooltip, Typography, theme } from "antd";
import { ArrowRightOutlined, ExportOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { const_Notification_Presentation } from "@/components/notifications/const_NotificationTypes";
import { useM_Notification_MarkRead } from "@/hooks/useM_Notification_MarkRead";
import { useM_Signing_LinkForMe } from "@/hooks/useM_Signing_LinkForMe";
import { useQ_Tables_MyOrganizations } from "@/hooks/useQ_Tables_MyOrganizations";
import { const_LinkForMe_ReasonCopy } from "@/hooks/useM_Signing_LinkForMe";
import { useQ_Me_PersonalOrganization } from "@/hooks/useQ_Me_PersonalOrganization";
import { Utils_Scope_Route } from "@/utils/Utils_Scope_Route";
import type { Tables_Notifications_Row } from "@/hooks/useQ_Tables_Notifications";

dayjs.extend(relativeTime);

/**
 * One row of the inbox, in the dropdown and on the full page alike.
 *
 * CLICKING MARKS READ AND NAVIGATES, in that order but without waiting: the
 * navigation is what the user asked for and must not be held up by a write whose
 * only consequence is a badge number. The mark-read mutation is deliberately
 * silent (see `useM_Notification_MarkRead`).
 *
 * `body` is rendered as TEXT. It carries decline and change-request reasons
 * copied verbatim from what a counterparty typed, so there is no version of this
 * that renders HTML.
 */
export const App_NotificationItem = ({
    notification,
    onNavigate,
}: {
    notification: Tables_Notifications_Row;
    /** Lets the dropdown close itself when a row sends the user somewhere. */
    onNavigate?: () => void;
}) => {
    const { token } = theme.useToken();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const mMarkRead = useM_Notification_MarkRead();
    const mLinkForMe = useM_Signing_LinkForMe();
    // Cached under the same key the org switcher uses, so the bell costs no extra
    // request on any page that has already loaded it.
    const qMyOrganizations = useQ_Tables_MyOrganizations();
    // CG-048. READ-ONLY — it never provisions. See the hook's own note: the bell
    // renders on every page for every user, and creating a workspace as a side
    // effect of drawing a list would put the moment of creation somewhere nobody
    // would think to look for it.
    const qPersonalOrganization = useQ_Me_PersonalOrganization();

    const presentation = const_Notification_Presentation[notification.type];
    const isUnread = !notification.read_at;

    const toneColor = {
        default: token.colorTextSecondary,
        success: token.colorSuccess,
        warning: token.colorWarning,
        error: token.colorError,
        info: token.colorPrimary,
    }[presentation?.tone ?? "default"];

    // A party's document opens on the SIGNING surface, not the envelope page: the
    // envelope page lives under `/_protected/$organizationId` and a signer who is
    // not a member of the sending organization cannot open it.
    const isPartyDocument = !!presentation?.party && !!notification.request_id;

    // …unless the party is ALSO a member of the sending organization, in which case
    // the server may send them to the document page instead once they have signed.
    // Used only to decide whether to pre-open a popup — the destination itself is
    // the server's call, because only it knows whether they have signed yet.
    const isOrgMember =
        !!notification.organization_id &&
        qMyOrganizations.organizations.some((org) => org.id === notification.organization_id);
    const expectsInApp = isPartyDocument && isOrgMember;

    // CG-048. Which surface an id belongs to. A null personal id — the common case,
    // for anyone who has never opened `/me` — can never match, so every id falls
    // through to `'org'`, which is exactly the behaviour that predates CG-048.
    const scopeOf = (id: string) =>
        !!qPersonalOrganization.personalOrganizationId &&
        id === qPersonalOrganization.personalOrganizationId
            ? ("personal" as const)
            : ("org" as const);

    const isPersonalEnvelope =
        !!notification.organization_id && scopeOf(notification.organization_id) === "personal";

    const openAsParty = () => {
        // THE TAB IS OPENED SYNCHRONOUSLY, HERE, BEFORE THE REQUEST — and this is the
        // whole reason for the handle-passing below. A `window.open` issued from a
        // promise callback has left the user-gesture context by the time it runs, and
        // every mainstream browser blocks it as a popup. Opening a blank tab inside
        // the click and pointing it at the URL when it arrives is the standard way
        // round that, and it also gives the user something to look at while the
        // server mints the credential.
        //
        // NOT WHEN THE ANSWER IS PROBABLY IN-APP. A member of the sending
        // organization who has already signed is routed to the document page in THIS
        // tab, and pre-opening a blank one for them would flash a tab open and shut
        // on every click. `expectsInApp` is a guess made from what the client knows;
        // the server decides, and both branches below cope with being wrong — a
        // sign link with no tab falls back to a same-tab assign, exactly as the
        // popup-blocked path already did.
        const tab = expectsInApp ? null : window.open("", "_blank");
        // Severs `window.opener` so the signing page cannot reach back into this
        // document. The tab is blank and same-origin at this instant, which is the
        // only moment this assignment is possible; `noopener` is not an option
        // because passing it makes `window.open` return null and we need the handle.
        if (tab) tab.opener = null;

        mLinkForMe.mutation.mutate(
            { request_id: notification.request_id! },
            {
                onSuccess: (result) => {
                    onNavigate?.();

                    // Already signed, and a member of the organization that sent it. The
                    // document page is where they wanted to go: the signed PDF, the
                    // recipients, the hashes, the audit trail and the download — none of
                    // which the signing surface has, since for them it is a receipt.
                    if (result.mode === "in_app") {
                        tab?.close();
                        // CG-048. The organization route would REDIRECT for a personal
                        // envelope, not merely look wrong: PHASE 3 dropped the personal
                        // workspace from `get_my_member_organizations`, which is what the
                        // `$organizationId` guard reads — so the id the server returned is a
                        // dead link on that route and a live one under `/me`.
                        navigate(
                            Utils_Scope_Route.envelopeDetail(
                                scopeOf(result.organization_id),
                                result.organization_id,
                                result.request_id
                            )
                        );
                        // SAID OUT LOUD, because the row promised something else. The label
                        // read "Open to sign" and the page that arrives has no signing on
                        // it; without a sentence naming why, a landing that is correct looks
                        // like a broken link. ANTD messages outlive the route change, so
                        // firing it alongside `navigate` lands it on the page the user is
                        // reading, not the one they are leaving.
                        message.info(const_LinkForMe_ReasonCopy[result.reason]);
                        return;
                    }

                    if (tab) {
                        // The ABSOLUTE url, not the path: the signer portal is its own origin
                        // on deployments that set `SIGNER_PORTAL_URL`, and a new tab needs a
                        // full URL regardless.
                        tab.location.href = result.url;
                        tab.focus();
                        return;
                    }
                    // No tab — either the popup was blocked or we did not open one because
                    // we expected to stay in the app. Same-tab either way, and
                    // `location.assign` rather than the router, because the router can
                    // only reach the portal when it happens to share this origin.
                    window.location.assign(result.url);
                },
                // The refusals ARE the feature — "it is not your turn to sign yet" — so
                // they are shown as-is rather than flattened into a generic failure. The
                // blank tab is closed behind them; leaving it open would strand the user
                // staring at nothing while the reason appeared on the tab they just left.
                onError: (err) => {
                    tab?.close();
                    message.error(
                        err instanceof Error ? err.message : "Could not open the document"
                    );
                },
            }
        );
    };

    const handleClick = () => {
        if (isUnread) mMarkRead.mutation.mutate({ id: notification.id });

        if (isPartyDocument) {
            openAsParty();
            return;
        }

        onNavigate?.();

        // CG-048. A personal envelope's link is REBUILT rather than followed. The
        // server interpolates `/{organization_id}/envelopes/{request_id}` when it
        // writes the row, which is correct for every organization and a dead link for
        // the personal workspace — that id resolves to a route that redirects Home.
        // Rebuilding needs both ids, so it only applies to rows that carry them;
        // anything else (an invitation, a webhook warning) follows the stored path.
        if (notification.organization_id && notification.request_id && isPersonalEnvelope) {
            navigate(
                Utils_Scope_Route.envelopeDetail(
                    "personal",
                    notification.organization_id,
                    notification.request_id
                )
            );
            return;
        }

        // Stored as an app-relative path by the server. `to` takes it as-is; there
        // is no params object because the ids are already interpolated into it.
        if (notification.link) navigate({ to: notification.link });
    };

    const hasAction = isPartyDocument || !!notification.link;

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleClick()}
            style={{
                display: "flex",
                gap: token.marginSM,
                padding: `${token.paddingSM}px ${token.padding}px`,
                cursor: hasAction ? "pointer" : "default",
                borderRadius: token.borderRadius,
                background: isUnread ? token.colorPrimaryBg : "transparent",
                alignItems: "flex-start",
            }}
        >
            <span
                style={{
                    color: toneColor,
                    fontSize: token.fontSizeLG,
                    lineHeight: 1.4,
                    flexShrink: 0,
                }}
            >
                {presentation?.icon}
            </span>

            <div style={{ minWidth: 0, flex: 1 }}>
                <Typography.Paragraph
                    strong={isUnread}
                    ellipsis={{ rows: 2 }}
                    style={{ marginBottom: 2, fontSize: token.fontSize }}
                >
                    {notification.title}
                </Typography.Paragraph>

                {notification.body && (
                    <Typography.Paragraph
                        type="secondary"
                        ellipsis={{ rows: 2 }}
                        style={{ marginBottom: 2, fontSize: token.fontSizeSM }}
                    >
                        {notification.body}
                    </Typography.Paragraph>
                )}

                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    {dayjs(notification.created_at).fromNow()}
                    {/* Says the mail also went out, so a user who cannot find it in their
              inbox knows to check spam rather than assume nothing was sent. */}
                    {notification.emailed && " · also emailed"}
                </Typography.Text>

                {/* The link, said out loud. The whole row is already clickable, but a
            row that only LOOKS like text gives the reader nothing to aim at and
            no idea where they would land — the email this mirrors has a labelled
            button, and the bell should not be the weaker half of the pair.
            `stopPropagation` keeps the row handler from firing behind it and
            marking the same notification read twice. */}
                {hasAction && (
                    <div style={{ marginTop: token.marginXXS }}>
                        <Tooltip
                            // Named BEFORE the click, not apologised for after. Minting a
                            // credential revokes the signer's previous live one, so opening
                            // from here kills the link in their inbox — the same trade a
                            // resend makes, and the reason that one says so too.
                            //
                            // Conditional now, because a party who has already signed is sent
                            // to the document page instead and nothing is minted for them.
                            // The client cannot know which before it asks, so the sentence
                            // states the condition rather than a cost that may not apply.
                            title={
                                isPartyDocument
                                    ? "If this document is still awaiting your signature, opening it here replaces the link in your email."
                                    : undefined
                            }
                        >
                            <Button
                                type="link"
                                size="small"
                                loading={mLinkForMe.mutation.isPending}
                                style={{
                                    paddingInline: 0,
                                    height: "auto",
                                    fontSize: token.fontSizeSM,
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleClick();
                                }}
                            >
                                {/* The icon carries the destination: an arrow for a route within
                    the app, the export glyph for the signing surface, which
                    leaves in a new tab and may be another origin entirely.
                    `expectsInApp` gets the arrow — a member who has signed stays
                    here, and promising a new tab we do not open is the kind of
                    small lie that makes an interface feel unreliable. */}
                                {presentation?.action ?? "Open"}{" "}
                                {isPartyDocument && !expectsInApp ? (
                                    <ExportOutlined />
                                ) : (
                                    <ArrowRightOutlined />
                                )}
                            </Button>
                        </Tooltip>
                    </div>
                )}
            </div>

            {isUnread && (
                <Badge
                    color={token.colorPrimary}
                    style={{ marginTop: 6, flexShrink: 0 }}
                    title="Unread"
                />
            )}
        </div>
    );
};
