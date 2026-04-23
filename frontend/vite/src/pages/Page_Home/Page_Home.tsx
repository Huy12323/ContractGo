import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Typography, Button, Input, Spin, Empty, Dropdown, theme } from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { Building2, MoreHorizontal, Users } from 'lucide-react'
import { useQ_Tables_MyOrganizations } from '@/hooks/useQ_Tables_MyOrganizations'
import type { Tables_MyOrganizations_QueryData } from '@/hooks/useQ_Tables_MyOrganizations'
import { useQ_Tables_MyRole } from '@/hooks/useQ_Tables_MyRole'
import { useQ_Tables_MyOnboardingInvitations } from '@/hooks/useQ_Tables_MyOnboardingInvitations'
import { App_OrgSettingsModal } from '@/components/organization/App_OrgSettingsModal'
import { App_CreateOrgModal } from '@/components/organization/App_CreateOrgModal'
import { PageHome_OnboardingInvitations } from './PageHome_OnboardingInvitations/PageHome_OnboardingInvitations'

export const Page_Home = () => {
  const { token } = theme.useToken()
  const qOrganizations = useQ_Tables_MyOrganizations()
  const qOnboardingInvitations = useQ_Tables_MyOnboardingInvitations()
  const [createOrgOpen, setCreateOrgOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  if (qOrganizations.query.isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: `${token.paddingLG}px ${token.paddingMD}px` }}>
      {/* Header row: [title] ... [search] ... [create] */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          My Organizations
        </Typography.Title>
        <Input
          placeholder="Search..."
          prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          allowClear
          style={{ width: 240 }}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateOrgOpen(true)}
        >
          Create
        </Button>
      </div>

      {/* Org list */}
      {(() => {
        const filtered = searchQuery
          ? qOrganizations.organizations.filter((org) => org.name.toLowerCase().includes(searchQuery.toLowerCase()))
          : qOrganizations.organizations

        if (qOrganizations.organizations.length === 0) {
          return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No organizations yet" />
        }

        if (filtered.length === 0) {
          return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No organizations match your search" />
        }

        return (
          <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, overflow: 'hidden', background: token.colorBgContainer }}>
            {filtered.map((org, i) => (
              <PageHome_OrgRow
                key={org.id}
                org={org}
                isLast={i === filtered.length - 1}
              />
            ))}
          </div>
        )
      })()}

      <PageHome_OnboardingInvitations invitations={qOnboardingInvitations.invitations} />

      <App_CreateOrgModal
        open={createOrgOpen}
        onClose={() => setCreateOrgOpen(false)}
      />
    </div>
  )
}

function PageHome_OrgRow({ org, isLast }: { org: Tables_MyOrganizations_QueryData[number]; isLast: boolean }) {
  const { token } = theme.useToken()
  const qRole = useQ_Tables_MyRole({ organizationId: org.id })
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <>
      <Link
        to="/$organizationId"
        params={{ organizationId: org.id }}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 16px',
          textDecoration: 'none',
          color: 'inherit',
          borderBottom: isLast ? 'none' : `1px solid ${token.colorBorderSecondary}`,
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = token.colorPrimaryBg }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {/* Org icon */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: token.borderRadiusSM, background: token.colorFillQuaternary }}>
          <Building2 size={18} color={token.colorTextSecondary} />
        </div>

        {/* Name */}
        <div style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
          <Typography.Text strong ellipsis style={{ display: 'block', fontSize: 14 }}>
            {org.name}
          </Typography.Text>
        </div>

        {/* Members placeholder */}
        <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 12, flexShrink: 0 }}>
          <Users size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          —
        </Typography.Text>

        {/* Settings dropdown — owner only */}
        {qRole.role === 'owner' && (
          <div onClick={(e) => { e.preventDefault(); e.stopPropagation() }} style={{ marginLeft: 8 }}>
            <Dropdown
              menu={{
                items: [{ key: 'settings', label: 'Settings' }],
                onClick: ({ key }) => {
                  if (key === 'settings') setSettingsOpen(true)
                },
              }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Button
                type="text"
                size="small"
                icon={<MoreHorizontal size={16} />}
                style={{ color: token.colorTextSecondary }}
              />
            </Dropdown>
          </div>
        )}
      </Link>

      <App_OrgSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        organizationId={org.id}
        organizationName={org.name}
      />
    </>
  )
}
