import { Modal } from 'antd'
import { App_OnboardingFormsList } from '@/components/employees/App_OnboardingFormsList'

interface Props {
  open: boolean
  onClose: () => void
  organizationId: string
}

export const App_ViewFormsModal = ({ open, onClose, organizationId }: Props) => (
  <Modal
    open={open}
    onCancel={onClose}
    title="Onboarding Forms"
    footer={null}
    width="60vw"
    styles={{ body: { minHeight: 300 } }}
    destroyOnHidden
  >
    <App_OnboardingFormsList organizationId={organizationId} />
  </Modal>
)
