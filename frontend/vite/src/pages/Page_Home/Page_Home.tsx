import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Typography, Button, Input, Spin, Empty, Dropdown, theme } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Building2, MoreHorizontal, Users } from "lucide-react";
import { useQ_Tables_MyOrganizations } from "@/hooks/useQ_Tables_MyOrganizations";
import type { Tables_MyOrganizations_QueryData } from "@/hooks/useQ_Tables_MyOrganizations";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";
import { App_CreateOrgModal } from "@/components/organization/App_CreateOrgModal";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { PageHome_MyDocuments } from "@/pages/Page_Home/PageHome_MyDocuments";

export const Page_Home = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const qOrganizations = useQ_Tables_MyOrganizations();
    const [createOrgOpen, setCreateOrgOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    if (qOrganizations.query.isLoading) {
        return (
            <div style={{ display: "flex", justifyContent: "center", padding: 64 }}>
                <Spin size="large" />
            </div>
        );
    }

    return (
        <div style={{ minHeight: "100%", background: token.colorBgContainer }}>
            <div
                style={{
                    maxWidth: 800,
                    margin: "0 auto",
                    padding: `${isMobile ? token.paddingMD : token.paddingLG}px ${isMobile ? token.paddingSM : token.paddingMD}px`,
                }}
            >
                {/* CG-048. FIRST, and above "My Organizations" on purpose.
          This page used to be a single list, so a user who had joined nothing saw
          an empty state and had exactly one thing they could do: create an
          organization. Their own documents are the thing they are most likely to
          want and the only thing that works with no setup at all, so they lead.
          Organizations keep the search and the Create button below — this section
          is a preview with its own way through. */}
                <PageHome_MyDocuments />

                {/* Header row: [title] ... [search] ... [create]
          On a phone the three of them need ~500px, so the search takes `order: 1`
          and drops to a full-width row of its own under title + Create. */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: token.marginSM,
                        marginBottom: 20,
                    }}
                >
                    <Typography.Title level={4} style={{ margin: 0 }}>
                        My Organizations
                    </Typography.Title>
                    <Input
                        placeholder="Search..."
                        prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        allowClear
                        style={{
                            width: isMobile ? "100%" : 240,
                            order: isMobile ? 1 : 0,
                        }}
                    />
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => setCreateOrgOpen(true)}
                    >
                        Create
                    </Button>
                </div>

                {/* Org list */}
                {(() => {
                    const filtered = searchQuery
                        ? qOrganizations.organizations.filter((org) =>
                              org.name.toLowerCase().includes(searchQuery.toLowerCase())
                          )
                        : qOrganizations.organizations;

                    if (qOrganizations.organizations.length === 0) {
                        return (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description="No organizations yet"
                            />
                        );
                    }

                    if (filtered.length === 0) {
                        return (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description="No organizations match your search"
                            />
                        );
                    }

                    return (
                        <div
                            style={{
                                border: `1px solid ${token.colorBorderSecondary}`,
                                borderRadius: token.borderRadiusLG,
                                overflow: "hidden",
                                background: token.colorBgContainer,
                            }}
                        >
                            {filtered.map((org, i) => (
                                <PageHome_OrgRow
                                    key={org.id}
                                    org={org}
                                    isLast={i === filtered.length - 1}
                                />
                            ))}
                        </div>
                    );
                })()}

                {/* `PageHome_OnboardingInvitations` lived here — the "contracts waiting on
          you" panel for employees being onboarded. It retired with the v1 review
          loop in Phase I: a ContractGo signer is EXTERNAL — not a member of the
          sending organization — and reaches their document through an emailed
          link rather than by logging in and finding it. Signing now requires an
          account on the signer's own address, but that account grants no
          membership and so has nothing to list here. The in-app equivalent is
          the Inbox in v1.1, which is for members who are also parties to a
          document. */}

                <App_CreateOrgModal open={createOrgOpen} onClose={() => setCreateOrgOpen(false)} />
            </div>
        </div>
    );
};

function PageHome_OrgRow({
    org,
    isLast,
}: {
    org: Tables_MyOrganizations_QueryData[number];
    isLast: boolean;
}) {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const navigate = useNavigate();
    const qRole = useQ_Tables_MyRole({ organizationId: org.id });

    return (
        <>
            <Link
                to="/$organizationId"
                params={{ organizationId: org.id }}
                style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "10px 16px",
                    textDecoration: "none",
                    color: "inherit",
                    borderBottom: isLast ? "none" : `1px solid ${token.colorBorderSecondary}`,
                    transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = token.colorPrimaryBg;
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                }}
            >
                {/* Org icon */}
                <div
                    style={{
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 32,
                        height: 32,
                        borderRadius: token.borderRadiusSM,
                        background: token.colorFillQuaternary,
                    }}
                >
                    <Building2 size={18} color={token.colorTextSecondary} />
                </div>

                {/* Name */}
                <div style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                    <Typography.Text strong ellipsis style={{ display: "block", fontSize: 14 }}>
                        {org.name}
                    </Typography.Text>
                </div>

                {/* Members placeholder. Dropped on a phone — it renders an em dash, and
            the organization's own name is the thing worth the horizontal room. */}
                {!isMobile && (
                    <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12, marginLeft: 12, flexShrink: 0 }}
                    >
                        <Users size={13} style={{ marginRight: 4, verticalAlign: "middle" }} />—
                    </Typography.Text>
                )}

                {/* Settings dropdown — owner only */}
                {qRole.role === "owner" && (
                    <div
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                        style={{ marginLeft: 8 }}
                    >
                        <Dropdown
                            menu={{
                                // CG-050: navigates to the settings route rather
                                // than opening `App_OrgSettingsModal`, which is
                                // gone. A dropdown item cannot be a `<Link>`
                                // without fighting antd's own click handling, so
                                // this one stays imperative — unlike the gear in
                                // the org switcher, which is a real link.
                                items: [{ key: "settings", label: "Settings" }],
                                onClick: ({ key }) => {
                                    if (key === "settings") {
                                        navigate({
                                            to: "/$organizationId/settings",
                                            params: { organizationId: org.id },
                                        });
                                    }
                                },
                            }}
                            trigger={["click"]}
                            placement="bottomRight"
                        >
                            <Button
                                type="text"
                                size="small"
                                icon={<MoreHorizontal size={16} />}
                                style={{ color: token.colorTextSecondary }}
                            />
                        </Dropdown>
                    </div>
                )}
            </Link>
        </>
    );
}
