import { Spin, Tabs, Typography, theme } from "antd";
import { EditOutlined, UserOutlined } from "@ant-design/icons";
import { PageSettings_ProfileTab } from "@/pages/Page_Settings/PageSettings_ProfileTab";
import { App_SignatureLibrary } from "@/components/profile/App_SignatureLibrary";
import { useQ_Me } from "@/hooks/useQ_Me";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

/**
 * The account page — personal information and the saved signature library.
 *
 * ORG-AGNOSTIC, and mounted at `/_protected/settings` rather than under
 * `$organizationId`. Neither of its two tabs is an organization's property: a
 * profile is a person's, and so is a signature — which is exactly why
 * `user_signatures` carries no `organization_id`. Filing this under an
 * organization would tie personal data to whichever one the user happened to be
 * looking at.
 *
 * The known cost, which `App_UserMenu` had already reasoned about when it chose
 * modals: `App_VerticalNav` renders nothing outside an organization, so the shell
 * here is half-built. That is not new — `/_protected/` (the organization picker)
 * has the same shape — so this is consistent with the one precedent rather than a
 * new kind of page.
 */
export const Page_Settings = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const qMe = useQ_Me();

    return (
        <div style={{ minHeight: "100%", background: token.colorBgContainer }}>
            <div
                style={{
                    maxWidth: 800,
                    margin: "0 auto",
                    padding: `${isMobile ? token.paddingMD : token.paddingLG}px ${
                        isMobile ? token.paddingSM : token.paddingMD
                    }px`,
                }}
            >
                <Typography.Title level={4} style={{ margin: 0, marginBottom: token.marginMD }}>
                    Settings
                </Typography.Title>

                {qMe.query.isLoading ? (
                    <div style={{ display: "flex", justifyContent: "center", padding: 64 }}>
                        <Spin size="large" />
                    </div>
                ) : (
                    <Tabs
                        defaultActiveKey="profile"
                        items={[
                            {
                                key: "profile",
                                label: (
                                    <span>
                                        <UserOutlined /> Profile
                                    </span>
                                ),
                                children: <PageSettings_ProfileTab profile={qMe.profile} />,
                            },
                            {
                                key: "signatures",
                                label: (
                                    <span>
                                        <EditOutlined /> Signatures
                                    </span>
                                ),
                                children: (
                                    <App_SignatureLibrary
                                        defaultTypedName={qMe.profile?.full_name ?? ""}
                                    />
                                ),
                            },
                        ]}
                    />
                )}
            </div>
        </div>
    );
};
