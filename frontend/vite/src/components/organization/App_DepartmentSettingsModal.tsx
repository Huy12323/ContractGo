import { useState, useEffect, useMemo } from "react";
import { Modal, Tabs, Input, Button, Form, Typography, Alert, Tag, Empty, List, Dropdown, Select, Avatar, theme } from "antd";
import { ExclamationCircleOutlined, MoreOutlined, SearchOutlined } from "@ant-design/icons";
import { useM_DeptSettings_DepartmentUpdate } from "@/hooks/useM_DeptSettings_DepartmentUpdate";
import { useM_DeptSettings_DepartmentDelete } from "@/hooks/useM_DeptSettings_DepartmentDelete";
import { useM_DeptSettings_$DeptEmployee$ManagerToggle } from "@/hooks/useM_DeptSettings_$DeptEmployee$ManagerToggle";
import { useM_DeptSettings_$Department$Employee$RelationCreate } from "@/hooks/useM_DeptSettings_$Department$Employee$RelationCreate";
import { useM_DeptSettings_$Department$Employee$RelationDelete } from "@/hooks/useM_DeptSettings_$Department$Employee$RelationDelete";
import { useOrganization } from "@/hooks/useOrganization";
import { useQ_Tables_OrgEmployeesWithDepartments } from "@/hooks/useQ_Tables_OrgEmployeesWithDepartments";

interface DepartmentSettingsModalProps {
    open: boolean;
    onClose: () => void;
    departmentId: string;
    departmentName: string;
}

export const App_DepartmentSettingsModal = ({ open, onClose, departmentId, departmentName }: DepartmentSettingsModalProps) => {
    const { token } = theme.useToken();
    const [form] = Form.useForm<{ name: string }>();
    const [deleteConfirm, setDeleteConfirm] = useState("");
    const [employeeSearch, setEmployeeSearch] = useState("");

    const { organizationId } = useOrganization();
    const qEmployees = useQ_Tables_OrgEmployeesWithDepartments({ organizationId });

    const mDeptUpdate = useM_DeptSettings_DepartmentUpdate({ departmentId });
    const mDeptDelete = useM_DeptSettings_DepartmentDelete({ departmentId, onSuccess: onClose });
    const mManagerToggle = useM_DeptSettings_$DeptEmployee$ManagerToggle({ departmentId });
    const mEmployeeAdd = useM_DeptSettings_$Department$Employee$RelationCreate({ departmentId });
    const mEmployeeRemove = useM_DeptSettings_$Department$Employee$RelationDelete({ departmentId });

    const deptEmployees = useMemo(() => {
        const people = qEmployees.peopleByDeptId[departmentId];
        if (!people) return [];
        return [...people.managers, ...people.employees].sort((a, b) => a.first_name.localeCompare(b.first_name));
    }, [qEmployees.peopleByDeptId, departmentId]);

    const filteredEmployees = useMemo(() => {
        if (!employeeSearch) return deptEmployees;
        const term = employeeSearch.toLowerCase();
        return deptEmployees.filter((emp) =>
            emp.first_name.toLowerCase().includes(term) ||
            emp.last_name.toLowerCase().includes(term) ||
            emp.email.toLowerCase().includes(term),
        );
    }, [deptEmployees, employeeSearch]);

    const managerIds = useMemo(() => {
        const people = qEmployees.peopleByDeptId[departmentId];
        if (!people) return new Set<string>();
        return new Set(people.managers.map((m) => m.id));
    }, [qEmployees.peopleByDeptId, departmentId]);

    const availableEmployees = useMemo(() => {
        const assignedIds = new Set(deptEmployees.map((e) => e.id));
        return qEmployees.employees
            .filter((e) => !assignedIds.has(e.id))
            .map((e) => ({
                label: `${e.first_name} ${e.last_name} — ${e.email}`,
                value: e.id,
            }));
    }, [qEmployees.employees, deptEmployees]);

    useEffect(() => {
        if (open) {
            form.setFieldsValue({ name: departmentName });
            setDeleteConfirm("");
            setEmployeeSearch("");
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
                        key: "employees",
                        label: "Employees",
                        children: (
                            <div style={{ display: "flex", flexDirection: "column", gap: token.marginMD }}>
                                <div style={{ display: "flex", gap: token.marginSM }}>
                                    <Input
                                        placeholder="Search employees..."
                                        allowClear
                                        prefix={<SearchOutlined />}
                                        value={employeeSearch}
                                        onChange={(e) => setEmployeeSearch(e.target.value)}
                                        style={{ flex: 1 }}
                                    />
                                    <Select<string>
                                        showSearch
                                        placeholder="Add Employee"
                                        value={null as unknown as string}
                                        options={availableEmployees}
                                        filterOption={(input, option) =>
                                            String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                                        }
                                        onSelect={(value) => mEmployeeAdd.mutation.mutate({ employee_id: value })}
                                        loading={mEmployeeAdd.mutation.isPending}
                                        style={{ minWidth: 240 }}
                                        notFoundContent="No available employees"
                                    />
                                </div>
                                {deptEmployees.length === 0 ? (
                                    <Empty description="No employees in this department" />
                                ) : filteredEmployees.length === 0 ? (
                                    <Empty description="No employees match your search" />
                                ) : (
                                    <List
                                        dataSource={filteredEmployees}
                                        split={false}
                                        renderItem={(emp) => {
                                            const isManager = managerIds.has(emp.id);
                                            const initial = (emp.first_name?.[0] ?? emp.email[0] ?? "?").toUpperCase();
                                            return (
                                                <List.Item
                                                    key={emp.id}
                                                    className="dept-emp-row"
                                                    style={{
                                                        padding: `${token.paddingSM}px ${token.paddingMD}px`,
                                                        borderRadius: token.borderRadiusLG,
                                                        marginBottom: token.marginXXS,
                                                        border: `1px solid ${token.colorBorderSecondary}`,
                                                        background: token.colorBgContainer,
                                                        transition: "background-color 0.15s, border-color 0.15s",
                                                    }}
                                                    actions={[
                                                        <Dropdown
                                                            key="actions"
                                                            trigger={["click"]}
                                                            menu={{
                                                                items: [
                                                                    {
                                                                        key: "toggle",
                                                                        label: isManager ? "Remove Manager" : "Make Manager",
                                                                        onClick: () => mManagerToggle.mutation.mutate({ employeeId: emp.id, is_manager: !isManager }),
                                                                    },
                                                                    { type: "divider" },
                                                                    {
                                                                        key: "remove",
                                                                        label: "Remove from department",
                                                                        danger: true,
                                                                        onClick: () => mEmployeeRemove.mutation.mutate({ employee_id: emp.id }),
                                                                    },
                                                                ],
                                                            }}
                                                        >
                                                            <Button
                                                                type="text"
                                                                shape="circle"
                                                                icon={<MoreOutlined />}
                                                                loading={
                                                                    (mManagerToggle.mutation.isPending && mManagerToggle.mutation.variables?.employeeId === emp.id) ||
                                                                    (mEmployeeRemove.mutation.isPending && mEmployeeRemove.mutation.variables?.employee_id === emp.id)
                                                                }
                                                            />
                                                        </Dropdown>,
                                                    ]}
                                                >
                                                    <List.Item.Meta
                                                        avatar={
                                                            <Avatar
                                                                style={{
                                                                    backgroundColor: isManager ? token.colorPrimary : token.colorFillSecondary,
                                                                    color: isManager ? token.colorWhite : token.colorText,
                                                                    fontWeight: 600,
                                                                }}
                                                            >
                                                                {initial}
                                                            </Avatar>
                                                        }
                                                        title={
                                                            <span style={{ display: "inline-flex", alignItems: "center", gap: token.marginXS }}>
                                                                <Typography.Text strong>{emp.first_name} {emp.last_name}</Typography.Text>
                                                                {isManager && (
                                                                    <Tag
                                                                        color="blue"
                                                                        bordered={false}
                                                                        style={{ fontWeight: 500, margin: 0 }}
                                                                    >
                                                                        Manager
                                                                    </Tag>
                                                                )}
                                                            </span>
                                                        }
                                                        description={
                                                            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                                                {emp.email}
                                                            </Typography.Text>
                                                        }
                                                    />
                                                </List.Item>
                                            );
                                        }}
                                    />
                                )}
                                <style>{`
                                    .dept-emp-row:hover {
                                        background-color: ${token.colorFillTertiary} !important;
                                        border-color: ${token.colorBorder} !important;
                                    }
                                `}</style>
                            </div>
                        ),
                    },
                    {
                        key: "danger",
                        label: <span style={{ color: token.colorError }}>Danger Zone</span>,
                        children: (
                            <div style={{ display: "flex", flexDirection: "column", gap: token.marginMD }}>
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
