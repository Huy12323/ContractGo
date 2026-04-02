import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Card, Typography, Row, Col, Button, Space, Spin, Empty, theme } from 'antd'
import { PlusOutlined, SettingOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { useQ_Tables_MyOrganizations } from '@/hooks/useQ_Tables_MyOrganizations'
import { useQ_Tables_MyInvitations } from '@/hooks/useQ_Tables_MyInvitations'
import { useQ_Tables_MyRole } from '@/hooks/useQ_Tables_MyRole'
import { useM_PageHome_InvitationAccept } from '@/hooks/useM_PageHome_InvitationAccept'
import { useM_PageHome_InvitationReject } from '@/hooks/useM_PageHome_InvitationReject'
import { App_OrgSettingsModal } from '@/components/organization/App_OrgSettingsModal'
import { App_CreateOrgModal } from '@/components/organization/App_CreateOrgModal'

export const Route = createFileRoute('/_protected/home/')({
  component: HomePage,
})

function HomePage() {
  const { token: themeToken } = theme.useToken()

  const qOrganizations = useQ_Tables_MyOrganizations()
  const qInvitations = useQ_Tables_MyInvitations()
  const mAcceptInvitation = useM_PageHome_InvitationAccept()
  const mRejectInvitation = useM_PageHome_InvitationReject()

  const [settingsOrg, setSettingsOrg] = useState<{ id: string; name: string } | null>(null)
  const [createOrgOpen, setCreateOrgOpen] = useState(false)

  if (qOrganizations.query.isLoading || qInvitations.query.isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    )
  }

  const pendingInvitations = qInvitations.invitations.filter(
    (inv) => new Date(inv.expires_at) > new Date()
  )

  return (
    <div>
      {/* My Organizations */}
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        My Organizations
      </Typography.Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
        {/* Create org card */}
        <Col xs={12} sm={8} md={6}>
          <Card
            hoverable
            onClick={() => setCreateOrgOpen(true)}
            style={{
              height: 160,
              border: `2px dashed ${themeToken.colorBorderSecondary}`,
              background: 'transparent',
            }}
            styles={{ body: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 0 } }}
          >
            <Space direction="vertical" align="center" size={4}>
              <PlusOutlined style={{ fontSize: 24, color: themeToken.colorTextSecondary }} />
              <Typography.Text type="secondary">Create Organization</Typography.Text>
            </Space>
          </Card>
        </Col>

        {/* Org cards */}
        {qOrganizations.organizations.map((org) => (
          <Col xs={12} sm={8} md={6} key={org.id}>
            <Card
              style={{
                height: 160,
                borderLeft: `3px solid ${themeToken.colorPrimary}`,
              }}
              styles={{ body: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' } }}
            >
              <Typography.Title level={5} style={{ margin: 0 }}>
                {org.name}
              </Typography.Title>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <OrgOwnerSettingsButton
                  organizationId={org.id}
                  onClick={() => setSettingsOrg(org)}
                />
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Invitations — always shown */}
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        Pending Invitations
      </Typography.Title>

      {pendingInvitations.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No pending invitations"
          style={{ padding: '24px 0' }}
        />
      ) : (
        <Row gutter={[16, 16]}>
          {pendingInvitations.map((inv) => (
            <Col xs={12} sm={8} md={6} key={inv.id}>
              <Card
                style={{
                  height: 160,
                  borderLeft: `3px solid ${themeToken.colorWarning}`,
                }}
                styles={{ body: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' } }}
              >
                <div>
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    {inv.organizations?.name ?? 'Organization'}
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Invited {new Date(inv.created_at).toLocaleDateString()}
                  </Typography.Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Button
                    size="small"
                    icon={<CloseOutlined />}
                    loading={mRejectInvitation.mutation.isPending}
                    onClick={() => mRejectInvitation.mutation.mutate(inv.id)}
                  >
                    Decline
                  </Button>
                  <Button
                    type="primary"
                    size="small"
                    icon={<CheckOutlined />}
                    loading={mAcceptInvitation.mutation.isPending}
                    onClick={() => mAcceptInvitation.mutation.mutate(inv.token)}
                  >
                    Accept
                  </Button>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* Settings modal */}
      {settingsOrg && (
        <App_OrgSettingsModal
          open={!!settingsOrg}
          onClose={() => setSettingsOrg(null)}
          organizationId={settingsOrg.id}
          organizationName={settingsOrg.name}
        />
      )}

      {/* Create org modal */}
      <App_CreateOrgModal
        open={createOrgOpen}
        onClose={() => setCreateOrgOpen(false)}
      />
    </div>
  )
}

function OrgOwnerSettingsButton({
  organizationId,
  onClick,
}: {
  organizationId: string
  onClick: () => void
}) {
  const qRole = useQ_Tables_MyRole({ organizationId })

  if (qRole.role !== 'owner') return null

  return (
    <Button
      type="text"
      size="small"
      icon={<SettingOutlined />}
      onClick={onClick}
    />
  )
}
