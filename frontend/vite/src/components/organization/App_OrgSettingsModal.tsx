import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQ_Tables_Organization } from "@/hooks/useQ_Tables_Organization";
import { useQ_Tables_MyRole } from "@/hooks/useQ_Tables_MyRole";
import { useM_OrgSettings_OrganizationUpdate } from "@/hooks/useM_OrgSettings_OrganizationUpdate";
import { useM_OrgSettings_OrganizationDelete } from "@/hooks/useM_OrgSettings_OrganizationDelete";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Modal_Responsive } from "@/utils/Utils_Modal_Responsive";
import { Modal, Tabs, Input, Button, Form, Typography, Alert } from "antd";
import { ExclamationCircleOutlined, TeamOutlined } from "@ant-design/icons";

interface OrgSettingsModalProps {
    open: boolean;
    onClose: () => void;
    organizationId: string;
    organizationName: string;
}

/**
 * The Admins tab is gone (CG-020).
 *
 * It was the only place to invite anyone, it could only invite admins, and it
 * was reachable only from an owner-gated `…` menu — so "add a colleague" was
 * buried two clicks inside a settings dialog. The People page replaces it: a
 * real destination in the nav, both tiers, and open to every admin. This dialog
 * keeps what is genuinely organization-level configuration.
 */
export const App_OrgSettingsModal = ({
    open,
    onClose,
    organizationId,
    organizationName,
}: OrgSettingsModalProps) => {
    const navigate = useNavigate();
    const { isMobile } = useApp_Breakpoint();
    const [form] = Form.useForm<{ name: string }>();
    const [deleteConfirm, setDeleteConfirm] = useState("");

    // The prop is the name as of whenever the caller last read the list. Reading
    // the row itself means a rename shows through here immediately instead of
    // waiting for the list cache to come back around.
    const qOrganization = useQ_Tables_Organization({ organizationId, enabled: open });
    const name = qOrganization.organization?.name ?? organizationName;

    const qRole = useQ_Tables_MyRole({ organizationId });
    // Courtesy hiding only — RLS is what actually stops a non-owner writing.
    const isOwner = qRole.role === "owner";

    const mOrganizationUpdate = useM_OrgSettings_OrganizationUpdate({ organizationId });
    const mOrganizationDelete = useM_OrgSettings_OrganizationDelete({
        organizationId,
        // Closing is not enough. This dialog is reachable from the org switcher
        // while you are inside `/$organizationId/...`, and that route's guard has
        // just stopped being satisfiable — without the redirect you sit on a dead
        // route until something else happens to navigate.
        onSuccess: () => {
            onClose();
            navigate({ to: "/" });
        },
    });

    useEffect(() => {
        if (open && qOrganization.organization) {
            form.setFieldsValue({ name: qOrganization.organization.name });
            setDeleteConfirm("");
        }
    }, [open, qOrganization.organization, form]);

    const deleteEnabled = deleteConfirm === name;

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={`${name} — Settings`}
            footer={null}
            // `70vh` of a phone leaves the dialog floating with its own scrollbar
            // inside a nearly-full-height sheet. `--app-vh` is the dvh-corrected
            // viewport (global.css); the 140px covers the header and the 8px inset.
            styles={{
                body: {
                    height: isMobile ? "calc(var(--app-vh) - 140px)" : "70vh",
                    overflow: "auto",
                },
            }}
            destroyOnHidden
            {...Utils_Modal_Responsive(isMobile, "80vw")}
        >
            <Tabs
                style={{ height: "100%" }}
                items={[
                    {
                        key: "general",
                        label: "General",
                        children: (
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 24,
                                    maxWidth: 480,
                                }}
                            >
                                <Form
                                    form={form}
                                    layout="vertical"
                                    disabled={!isOwner}
                                    onFinish={(values) =>
                                        mOrganizationUpdate.mutation.mutate(values)
                                    }
                                >
                                    <Form.Item
                                        name="name"
                                        label="Organization Name"
                                        rules={[{ required: true, message: "Name is required" }]}
                                        extra={
                                            isOwner
                                                ? undefined
                                                : "Only the owner can rename this organization."
                                        }
                                    >
                                        <Input />
                                    </Form.Item>
                                    {isOwner && (
                                        <Button
                                            type="primary"
                                            htmlType="submit"
                                            loading={mOrganizationUpdate.mutation.isPending}
                                        >
                                            Save
                                        </Button>
                                    )}
                                </Form>

                                {qOrganization.organization && (
                                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                                        Created{" "}
                                        {new Date(
                                            qOrganization.organization.created_at
                                        ).toLocaleDateString()}
                                    </Typography.Text>
                                )}

                                <div>
                                    <Typography.Text
                                        type="secondary"
                                        style={{ display: "block", marginBottom: 12 }}
                                    >
                                        Admins, members and pending invitations now live on their
                                        own page.
                                    </Typography.Text>
                                    <Button
                                        icon={<TeamOutlined />}
                                        onClick={() => {
                                            onClose();
                                            navigate({
                                                to: "/$organizationId/people",
                                                params: { organizationId },
                                            });
                                        }}
                                    >
                                        Manage people
                                    </Button>
                                </div>
                            </div>
                        ),
                    },
                    // Only the owner can delete (RLS), so showing an admin or a
                    // member a Danger Zone tab is an offer the database will not
                    // honour. The switcher's gear is open to everyone; the tab is not.
                    ...(!isOwner
                        ? []
                        : [
                              {
                                  key: "danger",
                                  label: (
                                      <Typography.Text type="danger">Danger Zone</Typography.Text>
                                  ),
                                  children: (
                                      <div
                                          style={{
                                              display: "flex",
                                              flexDirection: "column",
                                              gap: 16,
                                          }}
                                      >
                                          <Alert
                                              type="error"
                                              showIcon
                                              icon={<ExclamationCircleOutlined />}
                                              message="Delete this organization"
                                              description={
                                                  <div>
                                                      <Typography.Text type="secondary">
                                                          Permanently delete <strong>{name}</strong>{" "}
                                                          and all associated data including admins,
                                                          members, and invitations. This action
                                                          cannot be undone.
                                                      </Typography.Text>
                                                      <div style={{ marginTop: 16 }}>
                                                          <Typography.Text
                                                              style={{
                                                                  fontSize: 13,
                                                                  display: "block",
                                                                  marginBottom: 8,
                                                              }}
                                                          >
                                                              Type <strong>{name}</strong> to
                                                              confirm:
                                                          </Typography.Text>
                                                          <Input
                                                              placeholder={name}
                                                              value={deleteConfirm}
                                                              onChange={(e) =>
                                                                  setDeleteConfirm(e.target.value)
                                                              }
                                                              style={{
                                                                  marginBottom: 12,
                                                                  maxWidth: 320,
                                                              }}
                                                          />
                                                          <div>
                                                              <Button
                                                                  danger
                                                                  type="primary"
                                                                  disabled={!deleteEnabled}
                                                                  loading={
                                                                      mOrganizationDelete.mutation
                                                                          .isPending
                                                                  }
                                                                  onClick={() =>
                                                                      mOrganizationDelete.mutation.mutate()
                                                                  }
                                                              >
                                                                  Delete Organization
                                                              </Button>
                                                          </div>
                                                      </div>
                                                  </div>
                                              }
                                          />
                                      </div>
                                  ),
                              },
                          ]),
                ]}
            />
        </Modal>
    );
};
