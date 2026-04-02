import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button, Typography, theme } from 'antd'
import { TeamOutlined } from '@ant-design/icons'
import { Store_Auth_Actions } from '@/stores/Store_Auth'
import { App_CreateOrgModal } from '@/components/organization/App_CreateOrgModal'

export const Route = createFileRoute('/_auth/setup-organization')({
  component: SetupOrganizationPage,
})

function SetupOrganizationPage() {
  const { token } = theme.useToken()
  const navigate = useNavigate()
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            background: token.colorPrimary,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}
        >
          <TeamOutlined style={{ fontSize: 24, color: '#fff' }} />
        </div>
        <Typography.Title level={4} style={{ marginBottom: 0 }}>
          AIUR-HR
        </Typography.Title>
        <Typography.Text type="secondary">Set up your organization</Typography.Text>
      </div>

      <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 24, fontSize: 13 }}>
        Create your organization to get started. You'll be the owner with full access.
      </Typography.Paragraph>

      <Button
        type="primary"
        block
        size="large"
        onClick={() => setModalOpen(true)}
      >
        Create Organization
      </Button>

      <Button
        type="link"
        block
        onClick={() => {
          sessionStorage.setItem('setup-org-skipped', '1')
          navigate({ to: '/home' })
        }}
        style={{ marginTop: 8 }}
      >
        Skip for now
      </Button>

      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          Wrong account?{' '}
          <Typography.Link onClick={() => Store_Auth_Actions.signOut()}>Sign out</Typography.Link>
        </Typography.Text>
      </div>

      <App_CreateOrgModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => navigate({ to: '/home' })}
      />
    </>
  )
}
