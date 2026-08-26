import { Modal, Form, Input, Button, Alert, theme } from "antd";
import { LockOutlined } from "@ant-design/icons";
import {
    Profile_CurrentPasswordError,
    useM_Profile_PasswordUpdate,
} from "@/hooks/useM_Profile_PasswordUpdate";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Modal_Responsive } from "@/utils/Utils_Modal_Responsive";

interface ProfilePasswordModalProps {
    open: boolean;
    onClose: () => void;
    email: string | null;
}

type PasswordValues = {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
};

/**
 * In-app password change, reached from the account menu.
 *
 * Until this existed the only way to change a password was to sign out and walk
 * the forgot-password → email → reset flow, which is a strange thing to ask of
 * someone who is already signed in and can prove it.
 *
 * The current password is required. See `useM_Profile_PasswordUpdate` for why
 * that is a security requirement and not a courtesy.
 */
export const App_ProfilePasswordModal = ({ open, onClose, email }: ProfilePasswordModalProps) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const [form] = Form.useForm<PasswordValues>();
    const mPasswordUpdate = useM_Profile_PasswordUpdate();

    const handleFinish = (values: PasswordValues) => {
        if (!email) return;
        mPasswordUpdate.mutation.mutate(
            {
                email,
                currentPassword: values.currentPassword,
                newPassword: values.newPassword,
            },
            {
                onSuccess: () => {
                    form.resetFields();
                    onClose();
                },
                onError: (err) => {
                    // On the field, not in a toast — the user needs to know WHICH input
                    // to correct, and there are three of them on this form.
                    if (err instanceof Profile_CurrentPasswordError) {
                        form.setFields([{ name: "currentPassword", errors: [err.message] }]);
                    }
                },
            }
        );
    };

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title="Update password"
            footer={null}
            centered
            destroyOnHidden
            {...Utils_Modal_Responsive(isMobile, 420)}
        >
            <div style={{ marginTop: token.marginMD }}>
                {!email && (
                    <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: token.marginMD }}
                        message="Your account email is still loading. Try again in a moment."
                    />
                )}
                <Form form={form} layout="vertical" onFinish={handleFinish} requiredMark={false}>
                    <Form.Item
                        name="currentPassword"
                        label="Current password"
                        rules={[{ required: true, message: "Enter your current password" }]}
                    >
                        <Input.Password
                            prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
                            placeholder="Current password"
                            size="large"
                            autoComplete="current-password"
                        />
                    </Form.Item>

                    <Form.Item
                        name="newPassword"
                        label="New password"
                        rules={[
                            { required: true, message: "Enter a new password" },
                            { min: 8, message: "At least 8 characters" },
                        ]}
                    >
                        <Input.Password
                            prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
                            placeholder="Min. 8 characters"
                            size="large"
                            autoComplete="new-password"
                        />
                    </Form.Item>

                    <Form.Item
                        name="confirmPassword"
                        label="Confirm new password"
                        dependencies={["newPassword"]}
                        rules={[
                            { required: true, message: "Confirm your new password" },
                            ({ getFieldValue }) => ({
                                validator(_, value) {
                                    if (!value || getFieldValue("newPassword") === value)
                                        return Promise.resolve();
                                    return Promise.reject(new Error("Passwords don't match"));
                                },
                            }),
                        ]}
                    >
                        <Input.Password
                            prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
                            placeholder="Re-enter new password"
                            size="large"
                            autoComplete="new-password"
                        />
                    </Form.Item>

                    <Button
                        type="primary"
                        htmlType="submit"
                        block
                        size="large"
                        disabled={!email}
                        loading={mPasswordUpdate.mutation.isPending}
                    >
                        Update password
                    </Button>
                </Form>
            </div>
        </Modal>
    );
};
