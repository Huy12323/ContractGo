import { useState, useEffect } from 'react'
import { Button } from 'antd'
import { SolutionOutlined } from '@ant-design/icons'
import { useOrganization } from '@/hooks/useOrganization'
import { useQ_Tables_OrgEntities } from '@/hooks/useQ_Tables_OrgEntities'
import { App_PageToolbar } from '@/components/app-shell/App_PageToolbar'
import { App_OnboardingModal } from '@/components/employees/App_OnboardingModal'
import { PageEmployees_ListView } from './PageEmployees_ListView/PageEmployees_ListView'

export const Page_Employees = () => {
  const { organizationId } = useOrganization()
  const qEntities = useQ_Tables_OrgEntities({ organizationId })

  const [selectedEntityId, setSelectedEntityId] = useState<string>('')
  const activeEntityId = selectedEntityId || qEntities.entities[0]?.id || ''

  useEffect(() => {
    if (!selectedEntityId && qEntities.entities.length > 0) {
      setSelectedEntityId(qEntities.entities[0]!.id)
    }
  }, [qEntities.entities, selectedEntityId])

  const [onboardingOpen, setOnboardingOpen] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <App_PageToolbar
        organizationId={organizationId}
        entityId={activeEntityId}
        onEntityChange={setSelectedEntityId}
        actions={
          <Button size="small" icon={<SolutionOutlined />} type="primary" onClick={() => setOnboardingOpen(true)}>
            Onboarding
          </Button>
        }
      />

      <PageEmployees_ListView entityId={activeEntityId} organizationId={organizationId} />

      <App_OnboardingModal
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        organizationId={organizationId}
        entityId={activeEntityId}
      />
    </div>
  )
}
