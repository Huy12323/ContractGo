import { Modal } from "antd";
import { App_TimeclockDetailView } from "@/components/timeclock/App_TimeclockDetailView";

type Props = {
    open: boolean;
    onClose: () => void;
    employeeId: string;
    employeeName: string;
    entityId: string;
    timezone: string;
};

export const PageTimesheets_EmployeeModal = ({ open, onClose, employeeId, employeeName, entityId: _entityId, timezone }: Props) => {
    void _entityId;
    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={employeeName}
            footer={null}
            width="80vw"
            styles={{ body: { padding: 0, maxHeight: "70vh", overflow: "auto" } }}
            destroyOnHidden
        >
            <App_TimeclockDetailView employeeId={employeeId} timezone={timezone} />
        </Modal>
    );
};
