import { Link, useMatch } from '@tanstack/react-router'
import { useQ_Me } from '@/hooks/useQ_Me'
import { Utils_String_GetInitials } from '@/utils/Utils_String_GetInitials'
import { Layout, Button, Avatar, Dropdown, theme } from 'antd'
import { MenuOutlined, LogoutOutlined } from '@ant-design/icons'
import { Store_VerticalNav_Actions } from '@/stores/Store_VerticalNav'
import { Store_Auth_Actions } from '@/stores/Store_Auth'
import { const_AppShell_HorizontalNavHeight } from '@/components/app-shell/const_AppShell_Dimensions'

const { Header } = Layout

export const App_HorizontalNav = () => {
  const qMe = useQ_Me()
  const { token } = theme.useToken()

  const isOrgRoute = useMatch({
    from: '/_protected/$organizationId',
    shouldThrow: false,
    select: () => true,
  }) ?? false

  const displayName = qMe.profile?.full_name ?? qMe.profile?.email ?? 'User'
  const initials = Utils_String_GetInitials(qMe.profile?.full_name)

  return (
    <Header
      style={{
        background: `linear-gradient(90deg, ${token.colorPrimary}, ${token.colorPrimaryActive})`,
        padding: '0 16px',
        height: const_AppShell_HorizontalNavHeight,
        lineHeight: `${const_AppShell_HorizontalNavHeight}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isOrgRoute && (
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={Store_VerticalNav_Actions.toggle}
            style={{ fontSize: 16, color: token.colorTextLightSolid }}
          />
        )}
        <Link to="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: token.colorTextLightSolid }}>
            AIUR-HR
          </span>
        </Link>
      </div>

      <Dropdown
        menu={{
          items: [
            {
              key: 'user',
              label: displayName,
              disabled: true,
              style: { fontWeight: 600, color: token.colorText },
            },
            { type: 'divider' },
            {
              key: 'logout',
              icon: <LogoutOutlined />,
              label: 'Sign out',
              onClick: () => Store_Auth_Actions.signOut(),
            },
          ],
        }}
        trigger={['hover']}
        placement="bottomRight"
      >
        <Avatar
          size={28}
          style={{
            backgroundColor: token.colorBgContainer,
            color: token.colorPrimary,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {initials}
        </Avatar>
      </Dropdown>
    </Header>
  )
}
