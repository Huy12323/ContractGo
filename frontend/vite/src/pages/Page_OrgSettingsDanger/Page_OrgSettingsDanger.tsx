import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Alert, Button, Input, Skeleton, Space, Typography } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { useQ_Tables_Organization } from "@/hooks/useQ_Tables_Organization";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";
import { useM_OrgSettings_OrganizationDelete } from "@/hooks/useM_OrgSettings_OrganizationDelete";

/**
 * Danger zone — deleting the organization.
 *
 * Ported verbatim from `App_OrgSettingsModal`'s last tab, which CG-050 deleted.
 * The type-the-name confirmation is kept exactly as it was: it is the only thing
 * standing between a misclick and an irreversible cascade, and a `Modal.confirm`
 * would be weaker, not equivalent.
 *
 * ═══ THIS IS THE ONE TAB THAT IS GATED TWICE ═══
 *
 * It is `ownerOnly` in `const_OrgSettings_Tabs`, so an admin never sees it in
 * the strip — and it is checked AGAIN here, because a strip is not a gate. A URL
 * is typeable, and a tab that is merely absent from the navigation is absent the
 * way an unlocked door is closed.
 *
 * There is deliberately no async `beforeLoad` RPC doing this check. That would
 * cost a round trip on EVERY settings navigation to harden a courtesy layer —
 * RLS `DELETE ... USING (get_organization_role(id) = 'owner')` is the actual
 * boundary, and it does not care what this component rendered.
 *
 * ═══ WHY IT NAVIGATES AWAY ON SUCCESS ═══
 *
 * This page lives at `/$organizationId/settings/danger`, and the moment the
 * delete succeeds that route's guard has stopped being satisfiable. Without the
 * redirect you sit on a dead route until something else happens to navigate.
 */
export const Page_OrgSettingsDanger = () => {
    const { organizationId } = useParams({
        from: "/_protected/$organizationId/settings/danger",
    });
    const navigate = useNavigate();
    const [deleteConfirm, setDeleteConfirm] = useState("");

    const { organization, query } = useQ_Tables_Organization({ organizationId });
    const qRole = useQ_Tables_MyRole({ organizationId });

    const mOrganizationDelete = useM_OrgSettings_OrganizationDelete({
        organizationId,
        onSuccess: () => navigate({ to: "/" }),
    });

    if (query.isPending || qRole.query.isPending) {
        return <Skeleton active paragraph={{ rows: 4 }} />;
    }

    // The second gate. See the docblock — the strip hiding this tab is not it.
    if (qRole.role !== "owner") {
        return (
            <Alert
                type="warning"
                showIcon
                message="Only the organization owner can delete this organization"
                description="Ownership can be transferred from the People page if the current owner is leaving."
            />
        );
    }

    const name = organization?.name ?? "";
    // Exact match, not trimmed or case-folded. The point of the ceremony is that
    // it cannot be completed absent-mindedly.
    const deleteEnabled = deleteConfirm === name && name.length > 0;

    return (
        <Alert
            type="error"
            showIcon
            icon={<ExclamationCircleOutlined />}
            message="Delete this organization"
            description={
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                    <Typography.Text type="secondary">
                        Permanently delete <strong>{name}</strong> and everything in it — documents,
                        templates, members, invitations, API keys and webhook endpoints. Signed
                        documents already delivered to recipients are not recalled, but you will
                        lose your own copies and their audit trails. This action cannot be undone.
                    </Typography.Text>

                    <div>
                        <Typography.Text style={{ display: "block", marginBottom: 8 }}>
                            Type <strong>{name}</strong> to confirm:
                        </Typography.Text>
                        <Input
                            placeholder={name}
                            value={deleteConfirm}
                            onChange={(e) => setDeleteConfirm(e.target.value)}
                            style={{ marginBottom: 12, maxWidth: 320 }}
                        />
                        <div>
                            <Button
                                danger
                                type="primary"
                                disabled={!deleteEnabled}
                                loading={mOrganizationDelete.mutation.isPending}
                                onClick={() => mOrganizationDelete.mutation.mutate()}
                            >
                                Delete organization
                            </Button>
                        </div>
                    </div>
                </Space>
            }
        />
    );
};
