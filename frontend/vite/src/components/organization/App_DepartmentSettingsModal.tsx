import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Modal, Tabs, Input, Button, Form, Typography, Alert, Tag, Empty, Dropdown, Select, Avatar, theme } from "antd";
import { ExclamationCircleOutlined, MoreOutlined, SearchOutlined } from "@ant-design/icons";
import { useM_DeptSettings_DepartmentUpdate } from "@/hooks/useM_DeptSettings_DepartmentUpdate";
import { useM_DeptSettings_DepartmentDelete } from "@/hooks/useM_DeptSettings_DepartmentDelete";
import { useM_DeptSettings_$DeptEmployee$ManagerToggle } from "@/hooks/useM_DeptSettings_$DeptEmployee$ManagerToggle";
import { useM_DeptSettings_$Department$Employee$RelationCreate } from "@/hooks/useM_DeptSettings_$Department$Employee$RelationCreate";
import { useM_DeptSettings_$Department$Employee$RelationDelete } from "@/hooks/useM_DeptSettings_$Department$Employee$RelationDelete";
import { useQ_Tables_OrgEmployeesWithDepartments } from "@/hooks/useQ_Tables_OrgEmployeesWithDepartments";

const ROW_HEIGHT = 62;
const OVERSCAN = 5;
const MAX_HEIGHT = 400;

type EmpRecord = { id: string; first_name: string; last_name: string; email: string };

const VirtualEmployeeList = ({ employees, managerIds, token, onToggleManager, onRemove, toggleLoading, removeLoading }: {
    employees: EmpRecord[];
    managerIds: Set<string>;
    token: Record<string, any>;
    onToggleManager: (id: string, current: boolean) => void;
    onRemove: (id: string) => void;
    toggleLoading?: string;
    removeLoading?: string;
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);

    const handleScroll = useCallback(() => {
        if (containerRef.current) setScrollTop(containerRef.current.scrollTop);
    }, []);

    const totalHeight = employees.length * ROW_HEIGHT;
    const containerHeight = Math.min(MAX_HEIGHT, totalHeight);
    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIdx = Math.min(employees.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
    const visibleItems = employees.slice(startIdx, endIdx);

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            style={{ height: containerHeight, overflowY: "auto", position: "relative" }}
        >
            <div style={{ height: totalHeight, position: "relative" }}>
                {visibleItems.map((emp, i) => {
                    const isManager = managerIds.has(emp.id);
                    const initial = (emp.first_name?.[0] ?? emp.email[0] ?? "?").toUpperCase();
                    const top = (startIdx + i) * ROW_HEIGHT;
                    return (
                        <div
                            key={emp.id}
                            style={{
                                position: "absolute", top, left: 0, right: 0, height: ROW_HEIGHT,
                                display: "flex", alignItems: "center", gap: token.marginSM,
                                padding: `0 ${token.paddingMD}px`,
                                borderRadius: token.borderRadiusLG,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                background: token.colorBgContainer,
                                marginBottom: 2,
                                boxSizing: "border-box",
                            }}
                        >
                            <Avatar
                                style={{
                                    backgroundColor: isManager ? token.colorPrimary : token.colorFillSecondary,
                                    color: isManager ? token.colorWhite : token.colorText,
                                    fontWeight: 600, flexShrink: 0,
                                }}
                            >
                                {initial}
                            </Avatar>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: token.marginXS }}>
                                    <Typography.Text strong style={{ fontSize: 14 }}>{emp.first_name} {emp.last_name}</Typography.Text>
                                    {isManager && <Tag color="blue" bordered={false} style={{ fontWeight: 500, margin: 0 }}>Manager</Tag>}
                                </div>
                                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>{emp.email}</Typography.Text>
                            </div>
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    items: [
                                        { key: "toggle", label: isManager ? "Remove Manager" : "Make Manager", onClick: () => onToggleManager(emp.id, isManager) },
                                        { type: "divider" },
                                        { key: "remove", label: "Remove from department", danger: true, onClick: () => onRemove(emp.id) },
                                    ],
                                }}
                            >
                                <Button
                                    type="text" shape="circle" icon={<MoreOutlined />}
                                    loading={toggleLoading === emp.id || removeLoading === emp.id}
                                />
                            </Dropdown>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

interface DepartmentSettingsModalProps {
    open: boolean;
    onClose: () => void;
    departmentId: string;
    departmentName: string;
    entityId: string;
}

export const App_DepartmentSettingsModal = ({ open, onClose, departmentId, departmentName, entityId }: DepartmentSettingsModalProps) => {
    const { token } = theme.useToken();
    const [form] = Form.useForm<{ name: string }>();
    const [deleteConfirm, setDeleteConfirm] = useState("");
    const [employeeSearch, setEmployeeSearch] = useState("");

    const qEmployees = useQ_Tables_OrgEmployeesWithDepartments({ entityId });

    const mDeptUpdate = useM_DeptSettings_DepartmentUpdate({ departmentId });
    const mDeptDelete = useM_DeptSettings_DepartmentDelete({ departmentId, onSuccess: onClose });
    const mManagerToggle = useM_DeptSettings_$DeptEmployee$ManagerToggle({ departmentId });
    const mEmployeeAdd = useM_DeptSettings_$Department$Employee$RelationCreate({ departmentId });
    const mEmployeeRemove = useM_DeptSettings_$Department$Employee$RelationDelete({ departmentId });

    const deptEmployees = useMemo(() => {
        const people = qEmployees.peopleByDeptId[departmentId];
        if (!people) return [];
        const mgrs = [...people.managers].sort((a, b) => a.first_name.localeCompare(b.first_name));
        const emps = [...people.employees].sort((a, b) => a.first_name.localeCompare(b.first_name));
        return [...mgrs, ...emps];
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
                                    <VirtualEmployeeList
                                        employees={filteredEmployees}
                                        managerIds={managerIds}
                                        token={token}
                                        onToggleManager={(empId, current) => mManagerToggle.mutation.mutate({ employeeId: empId, is_manager: !current })}
                                        onRemove={(empId) => mEmployeeRemove.mutation.mutate({ employee_id: empId })}
                                        toggleLoading={mManagerToggle.mutation.isPending ? mManagerToggle.mutation.variables?.employeeId : undefined}
                                        removeLoading={mEmployeeRemove.mutation.isPending ? mEmployeeRemove.mutation.variables?.employee_id : undefined}
                                    />
                                )}
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
