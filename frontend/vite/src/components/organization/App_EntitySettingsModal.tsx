import { useState, useEffect } from "react";
import { Modal, Tabs, Input, Button, Form, Typography, Alert, Select } from "antd";
import { const_TimezoneOptions } from "@/hooks/const_TimezoneOptions";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { useQ_Tables_EntityDepartments } from "@/hooks/useQ_Tables_EntityDepartments";
import { useM_EntitySettings_EntityUpdate } from "@/hooks/useM_EntitySettings_EntityUpdate";
import { useM_EntitySettings_EntityDelete } from "@/hooks/useM_EntitySettings_EntityDelete";

interface EntitySettingsModalProps {
    open: boolean;
    onClose: () => void;
    entityId: string;
    entityName: string;
    organizationId: string;
}

export const App_EntitySettingsModal = ({ open, onClose, entityId, entityName }: EntitySettingsModalProps) => {
    const [form] = Form.useForm<{ name: string; timezone: string | null; locale: string }>();
    const [deleteConfirm, setDeleteConfirm] = useState("");

    // Fetch the entity's current data so the form shows actual values
    const qEntity = useQuery({
        enabled: !!entityId && open,
        queryKey: [...QueryKeys.entities.record(entityId)],
        queryFn: async () => {
            const sb_FromEntities_Select = await supabase
                .from("entities")
                .select("id, name, timezone, locale")
                .eq("id", entityId)
                .single();
            if (sb_FromEntities_Select.error) throw sb_FromEntities_Select.error;
            return sb_FromEntities_Select.data;
        },
    });

    const qDepartments = useQ_Tables_EntityDepartments({ entityId });
    const mEntityUpdate = useM_EntitySettings_EntityUpdate({ entityId });
    const mEntityDelete = useM_EntitySettings_EntityDelete({ entityId, onSuccess: onClose });

    useEffect(() => {
        if (open && qEntity.data) {
            form.setFieldsValue({
                name: qEntity.data.name,
                timezone: qEntity.data.timezone || null,
                locale: qEntity.data.locale || "",
            });
            setDeleteConfirm("");
        }
    }, [open, qEntity.data, form]);

    const hasDepartments = qDepartments.departments.length > 0;
    const deleteEnabled = deleteConfirm === entityName && !hasDepartments;

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
                                onFinish={(values) => mEntityUpdate.mutation.mutate(values as Parameters<typeof mEntityUpdate.mutation.mutate>[0])}
                            >
                                <Form.Item name="name" label="Entity Name" rules={[{ required: true, message: "Name is required" }]}>
                                    <Input />
                                </Form.Item>
                                <Form.Item name="timezone" label="Timezone">
                                    <Select
                                        showSearch
                                        optionFilterProp="label"
                                        options={[...const_TimezoneOptions]}
                                        placeholder="Search timezone..."
                                        style={{ width: '100%' }}
                                        allowClear
                                    />
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
