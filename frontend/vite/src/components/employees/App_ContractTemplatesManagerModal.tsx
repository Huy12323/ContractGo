import { Modal, theme } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'
import { App_ContractTemplatesManager } from './App_ContractTemplatesManager'

type Props = {
    open: boolean
    onClose: () => void
    organizationId: string
}

export const App_ContractTemplatesManagerModal = ({ open, onClose, organizationId }: Props) => {
    const { token } = theme.useToken()

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={<><FileTextOutlined style={{ marginRight: token.marginXS }} />Manage Templates</>}
            width="70vw"
            footer={null}
            destroyOnHidden
            styles={{ body: { height: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}
        >
            <App_ContractTemplatesManager organizationId={organizationId} />
        </Modal>
    )
}
