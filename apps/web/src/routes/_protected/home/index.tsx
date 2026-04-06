import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Card, Typography, Row, Col, Button, Space, Spin, Empty, Tag, Avatar, theme } from 'antd'
import {
  PlusOutlined,
  MoreOutlined,
  CheckOutlined,
  CloseOutlined,
  TeamOutlined,
  CalendarOutlined,
} from '@ant-design/icons'
import { useQ_Tables_MyOrganizations } from '@/hooks/useQ_Tables_MyOrganizations'
import type { Tables_MyOrganizations_QueryData } from '@/hooks/useQ_Tables_MyOrganizations'
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
        <Col xs={12} sm={8} md={6} xl={4}>
          <Card
            hoverable
            onClick={() => setCreateOrgOpen(true)}
            style={{
              height: '100%',
              border: `2px dashed ${themeToken.colorPrimaryBorder}`,
              background: themeToken.colorPrimaryBg,
            }}
            styles={{ body: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 0 } }}
          >
            <Space direction="vertical" align="center" size={4}>
              <PlusOutlined style={{ fontSize: 24, color: themeToken.colorPrimary }} />
              <Typography.Text style={{ color: themeToken.colorPrimary }}>Create Organization</Typography.Text>
            </Space>
          </Card>
        </Col>

        {/* Org cards */}
        {qOrganizations.organizations.map((org) => (
          <Col xs={12} sm={8} md={6} xl={4} key={org.id}>
            <PageHome_OrgCard org={org} />
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
            <Col xs={12} sm={8} md={6} xl={4} key={inv.id}>
              <Card
                style={{
                  height: 180,
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

      {/* Create org modal */}
      <App_CreateOrgModal
        open={createOrgOpen}
        onClose={() => setCreateOrgOpen(false)}
      />
    </div>
  )
}

const ROLE_COLORS: Record<string, string> = {
  owner: 'gold',
  admin: 'blue',
  employee: 'default',
}

const getOrgHue = (name: string) => {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return Math.abs(hash) % 360
}

function PageHome_OrgCard({ org }: { org: Tables_MyOrganizations_QueryData[number] }) {
  const { token: themeToken } = theme.useToken()
  const navigate = useNavigate()
  const qRole = useQ_Tables_MyRole({ organizationId: org.id })

  const [settingsOpen, setSettingsOpen] = useState(false)

  const hue = getOrgHue(org.name)
  const bannerGradient = `linear-gradient(135deg, hsl(${hue}, 45%, 88%) 0%, hsl(${(hue + 40) % 360}, 40%, 92%) 50%, hsl(${(hue + 80) % 360}, 35%, 90%) 100%)`
  const orgInitial = org.name.charAt(0).toUpperCase()

  return (
    <>
      <Card
        hoverable
        onClick={() => navigate({ to: '/$organizationId/dashboard', params: { organizationId: org.id } })}
        style={{ cursor: 'pointer', overflow: 'hidden', height: '100%' }}
        styles={{ body: { padding: 0, height: '100%', display: 'flex', flexDirection: 'column' } }}
      >
        {/* Banner / image placeholder */}
        <div
          style={{
            height: 72,
            background: bannerGradient,
            position: 'relative',
          }}
        >
          {/* Subtle pattern overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.08,
              backgroundImage:
                'radial-gradient(circle at 20% 50%, #000 1px, transparent 1px), radial-gradient(circle at 80% 20%, #000 1px, transparent 1px), radial-gradient(circle at 50% 80%, #000 1.5px, transparent 1.5px)',
              backgroundSize: '40px 40px, 60px 60px, 50px 50px',
            }}
          />
          {qRole.role === 'owner' && (
            <Button
              size="small"
              icon={<MoreOutlined />}
              onClick={(e) => { e.stopPropagation(); setSettingsOpen(true) }}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
              }}
            />
          )}
        </div>

        {/* Details section */}
        <div style={{ padding: '12px 16px 16px', background: themeToken.colorBgContainer, flex: 1 }}>
          {/* Avatar + name + settings */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Avatar
              size={36}
              style={{
                backgroundColor: `hsl(${hue}, 50%, 45%)`,
                fontSize: 16,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {orgInitial}
            </Avatar>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text strong ellipsis style={{ display: 'block', fontSize: 14 }}>
                {org.name}
              </Typography.Text>
              {qRole.role && (
                <Tag
                  color={ROLE_COLORS[qRole.role] ?? 'default'}
                  style={{ marginTop: 2, fontSize: 11 }}
                >
                  {qRole.role.charAt(0).toUpperCase() + qRole.role.slice(1)}
                </Tag>
              )}
            </div>
          </div>

          {/* Meta */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <TeamOutlined style={{ marginRight: 4 }} />
              — members
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <CalendarOutlined style={{ marginRight: 4 }} />
              — joined
            </Typography.Text>
          </div>
        </div>
      </Card>

      <App_OrgSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        organizationId={org.id}
        organizationName={org.name}
      />
    </>
  )
}
