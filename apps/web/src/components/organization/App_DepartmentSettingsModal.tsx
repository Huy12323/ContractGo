import { useState, useEffect } from "react";
import { Modal, Tabs, Input, Button, Form, Typography, Alert } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { useM_DeptSettings_DepartmentUpdate } from "@/hooks/useM_DeptSettings_DepartmentUpdate";
import { useM_DeptSettings_DepartmentDelete } from "@/hooks/useM_DeptSettings_DepartmentDelete";

interface DepartmentSettingsModalProps {
    open: boolean;
    onClose: () => void;
    departmentId: string;
    departmentName: string;
}

export const App_DepartmentSettingsModal = ({ open, onClose, departmentId, departmentName }: DepartmentSettingsModalProps) => {
    const [form] = Form.useForm<{ name: string }>();
    const [deleteConfirm, setDeleteConfirm] = useState("");

    const mDeptUpdate = useM_DeptSettings_DepartmentUpdate({ departmentId });
    const mDeptDelete = useM_DeptSettings_DepartmentDelete({ departmentId, onSuccess: onClose });

    useEffect(() => {
        if (open) {
            form.setFieldsValue({ name: departmentName });
            setDeleteConfirm("");
        }
    }, [open, departmentName, form]);

    const deleteEnabled = deleteConfirm === departmentName;

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={departmentName}
            footer={null}
            width="60vw"
            styles={{ body: { minHeight: 300, overflow: "auto" } }}
            destroyOnHidden
        >
            <Tabs
                items={[
                    {
                        key: "general",
                        label: "General",
                        children: (
                            <Form
                                form={form}
                                layout="vertical"
                                style={{ maxWidth: 480 }}
                                onFinish={(values) => mDeptUpdate.mutation.mutate(values)}
                            >
                                <Form.Item name="name" label="Department Name" rules={[{ required: true, message: "Name is required" }]}>
                                    <Input />
                                </Form.Item>
                                <Button type="primary" htmlType="submit" loading={mDeptUpdate.mutation.isPending}>
                                    Save
                                </Button>
                            </Form>
                        ),
                    },
                    {
                        key: "danger",
                        label: <span style={{ color: "#ff4d4f" }}>Danger Zone</span>,
                        children: (
                            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                <Alert
                                    type="error"
                                    showIcon
                                    icon={<ExclamationCircleOutlined />}
                                    message="Delete this department"
                                    description={
                                        <div>
                                            <Typography.Text type="secondary">
                                                Permanently delete <strong>{departmentName}</strong> and all sub-departments. This action cannot be undone.
                                            </Typography.Text>
                                            <div style={{ marginTop: 16 }}>
                                                <Typography.Text style={{ fontSize: 13, display: "block", marginBottom: 8 }}>
                                                    Type <strong>{departmentName}</strong> to confirm:
                                                </Typography.Text>
                                                <Input
                                                    placeholder={departmentName}
                                                    value={deleteConfirm}
                                                    onChange={(e) => setDeleteConfirm(e.target.value)}
                                                    style={{ marginBottom: 12, maxWidth: 320 }}
                                                />
                                                <div>
                                                    <Button
                                                        danger
                                                        type="primary"
                                                        disabled={!deleteEnabled}
                                                        loading={mDeptDelete.mutation.isPending}
                                                        onClick={() => mDeptDelete.mutation.mutate()}
                                                    >
                                                        Delete Department
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    }
                                />
                            </div>
                        ),
                    },
                ]}
            />
        </Modal>
    );
};
