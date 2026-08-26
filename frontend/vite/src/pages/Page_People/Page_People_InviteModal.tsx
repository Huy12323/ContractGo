import { Form, Input, Modal, Radio, Typography, theme } from "antd";
import type { InvitationRole } from "@/hooks/useM_People_InvitationCreate";
import { useM_People_InvitationCreate } from "@/hooks/useM_People_InvitationCreate";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Modal_Responsive } from "@/utils/Utils_Modal_Responsive";

type InviteForm = {
    email: string;
    role: InvitationRole;
};

type Props = {
    open: boolean;
    onClose: () => void;
    organizationId: string;
    organizationName: string;
};

/**
 * One email, one tier.
 *
 * The tier is a Radio.Group rather than a Select because there are exactly two
 * of them and each needs a line of explanation — what an Admin can do that a
 * Member cannot is the whole decision being made here, and hiding it behind a
 * dropdown makes the caller guess.
 */
export const Page_People_InviteModal = ({
    open,
    onClose,
    organizationId,
    organizationName,
}: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const [form] = Form.useForm<InviteForm>();
    const mInvitationCreate = useM_People_InvitationCreate({ organizationId });

    const handleFinish = (values: InviteForm) =>
        mInvitationCreate.mutation.mutate(
            { email: values.email.trim().toLowerCase(), role: values.role },
            {
                onSuccess: () => {
                    form.resetFields();
                    onClose();
                },
            }
        );

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={`Invite someone to ${organizationName}`}
            okText="Send invitation"
            onOk={() => form.submit()}
            confirmLoading={mInvitationCreate.mutation.isPending}
            destroyOnHidden
            {...Utils_Modal_Responsive(isMobile)}
        >
            <Form
                form={form}
                layout="vertical"
                initialValues={{ role: "member" satisfies InvitationRole }}
                onFinish={handleFinish}
                style={{ marginTop: token.marginMD }}
            >
                <Form.Item
                    name="email"
                    label="Email address"
                    rules={[
                        { required: true, message: "Enter an email address" },
                        { type: "email", message: "That does not look like an email address" },
                    ]}
                >
                    <Input placeholder="colleague@company.com" autoFocus />
                </Form.Item>

                <Form.Item name="role" label="Role">
                    <Radio.Group
                        style={{ display: "flex", flexDirection: "column", gap: token.marginXS }}
                    >
                        <Radio value={"member" satisfies InvitationRole}>
                            <div>
                                <Typography.Text strong>Member</Typography.Text>
                                <Typography.Text
                                    type="secondary"
                                    style={{ display: "block", fontSize: 12 }}
                                >
                                    Can be a party to documents in this organization.
                                </Typography.Text>
                            </div>
                        </Radio>
                        <Radio value={"admin" satisfies InvitationRole}>
                            <div>
                                <Typography.Text strong>Admin</Typography.Text>
                                <Typography.Text
                                    type="secondary"
                                    style={{ display: "block", fontSize: 12 }}
                                >
                                    Everything a member can do, plus templates, sending documents,
                                    and inviting people.
                                </Typography.Text>
                            </div>
                        </Radio>
                    </Radio.Group>
                </Form.Item>

                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    They will get an email with a link that expires in 7 days. It only works for the
                    address you enter here.
                </Typography.Text>
            </Form>
        </Modal>
    );
};
