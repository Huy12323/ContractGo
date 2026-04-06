import { useState } from 'react'
import { useNavigate, useMatch } from '@tanstack/react-router'
import { useQ_Tables_MyOrganizations } from '@/hooks/useQ_Tables_MyOrganizations'
import { Typography, Dropdown, Avatar, Button, theme } from 'antd'
import { CheckOutlined, SettingOutlined, CaretUpOutlined, CaretDownOutlined } from '@ant-design/icons'
import { App_OrgSettingsModal } from '@/components/organization/App_OrgSettingsModal'
import type { MenuProps } from 'antd'

interface App_OrgSwitcherProps {
  collapsed: boolean
}

export const App_OrgSwitcher = ({ collapsed }: App_OrgSwitcherProps) => {
  const { token } = theme.useToken()
  const navigate = useNavigate()
  const qOrganizations = useQ_Tables_MyOrganizations()

  const orgMatch = useMatch({ from: '/_protected/$organizationId', shouldThrow: false })
  const currentOrgId = orgMatch?.params?.organizationId
  const currentOrg = qOrganizations.organizations.find((o) => o.id === currentOrgId)

  const [settingsOpen, setSettingsOpen] = useState(false)

  const items: MenuProps['items'] = qOrganizations.organizations.map((org) => ({
    key: org.id,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar
          size={20}
          style={{ backgroundColor: token.colorPrimary, fontSize: 10, flexShrink: 0 }}
        >
          {org.name.charAt(0).toUpperCase()}
        </Avatar>
        <span style={{ flex: 1 }}>{org.name}</span>
        {org.id === currentOrgId && (
          <CheckOutlined style={{ color: token.colorPrimary, fontSize: 11 }} />
        )}
      </div>
    ),
    onClick: () => {
      if (org.id !== currentOrgId) {
        navigate({ to: '/$organizationId', params: { organizationId: org.id } })
      }
    },
  }))

  const orgInitial = currentOrg?.name?.charAt(0)?.toUpperCase() ?? '?'
  const displayName = currentOrg?.name ?? 'Select organization'

  return (
    <>
      <div
        style={{
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          padding: collapsed ? '8px 0' : '8px 8px 8px 4px',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <Dropdown menu={{ items }} trigger={['click']} placement="topLeft">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flex: collapsed ? undefined : 1,
              minWidth: 0,
              cursor: 'pointer',
              padding: collapsed ? 4 : '4px 6px',
              borderRadius: token.borderRadius,
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = token.colorBgTextHover }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            {!collapsed && (
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 0, flexShrink: 0, gap: 0 }}>
                <CaretUpOutlined style={{ fontSize: 8, color: token.colorTextSecondary }} />
                <CaretDownOutlined style={{ fontSize: 8, color: token.colorTextSecondary }} />
              </span>
            )}
            <Avatar
              size={24}
              style={{ backgroundColor: token.colorPrimary, fontSize: 11, flexShrink: 0 }}
            >
              {orgInitial}
            </Avatar>
            {!collapsed && (
              <Typography.Text
                ellipsis
                style={{ flex: 1, fontSize: 13, fontWeight: 500 }}
              >
                {displayName}
              </Typography.Text>
            )}
          </div>
        </Dropdown>

        {!collapsed && currentOrg && (
          <Button
            type="text"
            size="small"
            icon={<SettingOutlined style={{ fontSize: 13 }} />}
            onClick={() => setSettingsOpen(true)}
            style={{ flexShrink: 0, color: token.colorTextSecondary }}
          />
        )}
      </div>

      {currentOrg && (
        <App_OrgSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          organizationId={currentOrg.id}
          organizationName={currentOrg.name}
        />
      )}
    </>
  )
}
