import { Modal, Form, Input, Button, theme } from "antd";
import { BankOutlined } from "@ant-design/icons";
import { useM_CreateOrgModal_OrganizationCreate } from "@/hooks/useM_CreateOrgModal_OrganizationCreate";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Modal_Responsive } from "@/utils/Utils_Modal_Responsive";

interface CreateOrgModalProps {
    open: boolean;
    onClose: () => void;
    onCreated?: () => void;
}

export const App_CreateOrgModal = ({ open, onClose, onCreated }: CreateOrgModalProps) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const [form] = Form.useForm<{ name: string }>();
    const mCreateOrg = useM_CreateOrgModal_OrganizationCreate();

    function handleFinish(values: { name: string }) {
        mCreateOrg.mutation.mutate(values.name, {
            onSuccess: () => {
                form.resetFields();
                onClose();
                onCreated?.();
            },
            onError: (err) => {
                form.setFields([
                    {
                        name: "name",
                        errors: [
                            err instanceof Error ? err.message : "Failed to create organization",
                        ],
                    },
                ]);
            },
        });
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title="Create Organization"
            footer={null}
            centered
            destroyOnHidden
            {...Utils_Modal_Responsive(isMobile, 420)}
        >
            <div style={{ marginTop: 16 }}>
                <Form form={form} layout="vertical" onFinish={handleFinish} requiredMark={false}>
                    <Form.Item
                        name="name"
                        label="Organization Name"
                        rules={[{ required: true, message: "Enter your organization name" }]}
                    >
                        <Input
                            prefix={<BankOutlined style={{ color: token.colorTextPlaceholder }} />}
                            placeholder="Acme Inc."
                            size="large"
                        />
                    </Form.Item>

                    <Button
                        type="primary"
                        htmlType="submit"
                        block
                        size="large"
                        loading={mCreateOrg.mutation.isPending}
                    >
                        Create Organization
                    </Button>
                </Form>
            </div>
        </Modal>
    );
};
