import { useState, useEffect } from "react";
import { Modal, Tabs, Input, Button, Form, Typography, Alert, Table, Select, Space, Avatar } from "antd";
import { ExclamationCircleOutlined, DeleteOutlined } from "@ant-design/icons";
import { Utils_String_GetInitials } from "@/utils/Utils_String_GetInitials";
import { useQ_Tables_EntityEmployees } from "@/hooks/useQ_Tables_EntityEmployees";
import { useQ_Tables_EntityDepartments } from "@/hooks/useQ_Tables_EntityDepartments";
import { useQ_Tables_OrgAdmins } from "@/hooks/useQ_Tables_OrgAdmins";
import { useM_EntitySettings_EntityUpdate } from "@/hooks/useM_EntitySettings_EntityUpdate";
import { useM_EntitySettings_EntityDelete } from "@/hooks/useM_EntitySettings_EntityDelete";
import { useM_EntitySettings_EntityEmployeeAdd } from "@/hooks/useM_EntitySettings_EntityEmployeeAdd";
import { useM_EntitySettings_EntityEmployeeRemove } from "@/hooks/useM_EntitySettings_EntityEmployeeRemove";

interface EntitySettingsModalProps {
    open: boolean;
    onClose: () => void;
    entityId: string;
    entityName: string;
    organizationId: string;
}

export const App_EntitySettingsModal = ({ open, onClose, entityId, entityName, organizationId }: EntitySettingsModalProps) => {
    const [form] = Form.useForm<{ name: string; timezone: string; locale: string }>();
    const [deleteConfirm, setDeleteConfirm] = useState("");
    const [selectedUserId, setSelectedUserId] = useState<string | undefined>();

    const qEmployees = useQ_Tables_EntityEmployees({ entityId });
    const qDepartments = useQ_Tables_EntityDepartments({ entityId });
    const qAdmins = useQ_Tables_OrgAdmins({ organizationId });
    const mEntityUpdate = useM_EntitySettings_EntityUpdate({ entityId });
    const mEntityDelete = useM_EntitySettings_EntityDelete({ entityId, onSuccess: onClose });
    const mEmployeeAdd = useM_EntitySettings_EntityEmployeeAdd({ entityId });
    const mEmployeeRemove = useM_EntitySettings_EntityEmployeeRemove({ entityId });

    useEffect(() => {
        if (open) {
            form.setFieldsValue({ name: entityName, timezone: "", locale: "" });
            setDeleteConfirm("");
        }
    }, [open, entityName, form]);

    const hasDepartments = qDepartments.departments.length > 0;
    const deleteEnabled = deleteConfirm === entityName && !hasDepartments;

    const assignedUserIds = new Set(qEmployees.employees.map((e) => e.user_id));
    const availableMembers = qAdmins.admins.filter((a) => !assignedUserIds.has(a.user_id));

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={entityName}
            footer={null}
            width="70vw"
            styles={{ body: { minHeight: 400, overflow: "auto" } }}
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
                                onFinish={(values) => mEntityUpdate.mutation.mutate(values)}
                            >
                                <Form.Item name="name" label="Entity Name" rules={[{ required: true, message: "Name is required" }]}>
                                    <Input />
                                </Form.Item>
                                <Form.Item name="timezone" label="Timezone">
                                    <Input placeholder="e.g. Asia/Ho_Chi_Minh" />
                                </Form.Item>
                                <Form.Item name="locale" label="Locale">
                                    <Input placeholder="e.g. vi-VN" />
                                </Form.Item>
                                <Button type="primary" htmlType="submit" loading={mEntityUpdate.mutation.isPending}>
                                    Save
                                </Button>
                            </Form>
                        ),
                    },
                    {
                        key: "employees",
                        label: "Entity Employees",
                        children: (
                            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                <Space.Compact style={{ maxWidth: 400 }}>
                                    <Select
                                        showSearch
                                        optionFilterProp="label"
                                        placeholder="Add employee..."
                                        value={selectedUserId}
                                        onChange={setSelectedUserId}
                                        style={{ flex: 1 }}
                                        options={availableMembers.map((a) => ({
                                            label: a.profiles?.full_name ?? a.profiles?.email ?? "Unknown",
                                            value: a.user_id,
                                        }))}
                                    />
                                    <Button
                                        type="primary"
                                        disabled={!selectedUserId}
                                        loading={mEmployeeAdd.mutation.isPending}
                                        onClick={() => {
                                            if (selectedUserId) {
                                                mEmployeeAdd.mutation.mutate(selectedUserId, {
                                                    onSuccess: () => setSelectedUserId(undefined),
                                                });
                                            }
                                        }}
                                    >
                                        Add
                                    </Button>
                                </Space.Compact>
                                <Table
                                    dataSource={qEmployees.employees}
                                    rowKey="id"
                                    loading={qEmployees.query.isLoading}
                                    pagination={false}
                                    size="small"
                                    locale={{ emptyText: "No employees assigned to this entity" }}
                                    columns={[
                                        {
                                            title: "Employee",
                                            key: "employee",
                                            render: (_, record) => (
                                                <Space>
                                                    <Avatar size={28} style={{ backgroundColor: "#0958d9" }}>
                                                        {Utils_String_GetInitials(record.profiles?.full_name)}
                                                    </Avatar>
                                                    <div>
                                                        <Typography.Text strong style={{ display: "block", fontSize: 13 }}>
                                                            {record.profiles?.full_name ?? "No name"}
                                                        </Typography.Text>
                                                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                                            {record.profiles?.email}
                                                        </Typography.Text>
                                                    </div>
                                                </Space>
                                            ),
                                        },
                                        {
                                            title: "",
                                            key: "action",
                                            width: 60,
                                            render: (_, record) => (
                                                <Button
                                                    type="text"
                                                    danger
                                                    size="small"
                                                    icon={<DeleteOutlined />}
                                                    loading={mEmployeeRemove.mutation.isPending}
                                                    onClick={() => mEmployeeRemove.mutation.mutate(record.id)}
                                                />
                                            ),
                                        },
                                    ]}
                                />
                            </div>
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
                                    message="Delete this entity"
                                    description={
                                        <div>
                                            {hasDepartments && (
                                                <Typography.Text type="danger" style={{ display: "block", marginBottom: 12 }}>
                                                    This entity has {qDepartments.departments.length} department(s). Delete all departments first.
                                                </Typography.Text>
                                            )}
                                            <Typography.Text type="secondary">
                                                Permanently delete <strong>{entityName}</strong> and all associated data. This action cannot be undone.
                                            </Typography.Text>
                                            <div style={{ marginTop: 16 }}>
                                                <Typography.Text style={{ fontSize: 13, display: "block", marginBottom: 8 }}>
                                                    Type <strong>{entityName}</strong> to confirm:
                                                </Typography.Text>
                                                <Input
                                                    placeholder={entityName}
                                                    value={deleteConfirm}
                                                    onChange={(e) => setDeleteConfirm(e.target.value)}
                                                    disabled={hasDepartments}
                                                    style={{ marginBottom: 12, maxWidth: 320 }}
                                                />
                                                <div>
                                                    <Button
                                                        danger
                                                        type="primary"
                                                        disabled={!deleteEnabled}
                                                        loading={mEntityDelete.mutation.isPending}
                                                        onClick={() => mEntityDelete.mutation.mutate()}
                                                    >
                                                        Delete Entity
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
