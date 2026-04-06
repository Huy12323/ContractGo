import { createFileRoute, Outlet, redirect, Link, useLocation, useMatch } from '@tanstack/react-router'
import { useQ_Me } from '@/hooks/useQ_Me'
import { Utils_String_GetInitials } from '@/utils/Utils_String_GetInitials'
import { Layout, Menu, Button, Avatar, Dropdown, theme } from 'antd'
import {
  DashboardOutlined,
  ApartmentOutlined,
  MenuOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import { useStore_Sidebar_Collapsed, Store_Sidebar_Actions } from '@/stores/Store_Sidebar'
import { Store_Auth_Actions } from '@/stores/Store_Auth'
import { App_OrgSwitcher } from '@/components/organization/App_OrgSwitcher'
import { App_ViewSwitcherMock } from '@/components/app-shell/App_ViewSwitcherMock'
import { supabase } from '@/configs/supabase/config'

const { Sider, Header, Content } = Layout


export const Route = createFileRoute('/_protected')({
  beforeLoad: async ({ location }) => {
    const sb_Auth_GetSession = await supabase.auth.getSession()
    const session = sb_Auth_GetSession.data.session

    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }

    if (!session.user.email_confirmed_at) {
      throw redirect({
        to: '/verify-email',
        search: { email: session.user.email ?? undefined },
      })
    }

    // Redirect to setup-org if user has no organization (unless they skipped)
    if (!sessionStorage.getItem('setup-org-skipped')) {
      const sb_FromOrganizations_Select = await supabase
        .from('organizations')
        .select('id')
        .limit(1)

      if (!sb_FromOrganizations_Select.data || sb_FromOrganizations_Select.data.length === 0) {
        throw redirect({ to: '/setup-organization' })
      }
    }
  },
  component: ProtectedLayout,
})

function ProtectedLayout() {
  const qMe = useQ_Me()
  const collapsed = useStore_Sidebar_Collapsed()
  const location = useLocation()
  const { token } = theme.useToken()

  const orgMatch = useMatch({ from: '/_protected/$organizationId', shouldThrow: false })
  const organizationId = orgMatch?.params?.organizationId
  const isHome = location.pathname === '/home'

  const displayName = qMe.profile?.full_name ?? qMe.profile?.email ?? 'User'
  const initials = Utils_String_GetInitials(qMe.profile?.full_name)

  const menuKey = organizationId
    ? (location.pathname.includes('/dashboard')
      ? `/${organizationId}/dashboard`
      : location.pathname.includes('/org-chart')
        ? `/${organizationId}/org-chart`
        : location.pathname)
    : location.pathname

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Top navbar — full width, above sidebar */}
      <Header
        style={{
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          padding: '0 16px',
          height: 48,
          lineHeight: '48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isHome && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={Store_Sidebar_Actions.toggle}
              style={{ fontSize: 16 }}
            />
          )}
          <Link to="/home" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
            <span style={{ fontWeight: 700, fontSize: 16, color: token.colorText }}>
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
              backgroundColor: token.colorPrimary,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {initials}
          </Avatar>
        </Dropdown>
      </Header>

      <Layout>
        {!isHome && (
          <Sider
            trigger={null}
            collapsible
            collapsed={collapsed}
            width={240}
            collapsedWidth={64}
            breakpoint="md"
            onBreakpoint={(broken) => {
              if (broken) Store_Sidebar_Actions.setCollapsed(true)
            }}
            style={{
              background: token.colorBgContainer,
              borderRight: `1px solid ${token.colorBorderSecondary}`,
              height: 'calc(100vh - 48px)',
              position: 'sticky',
              top: 48,
              left: 0,
              overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <Menu
                mode="inline"
                selectedKeys={[menuKey]}
                style={{ flex: 1, borderRight: 0 }}
                items={organizationId ? [
                  {
                    key: `/${organizationId}/dashboard`,
                    icon: <DashboardOutlined />,
                    label: (
                      <Link
                        to="/$organizationId/dashboard"
                        params={{ organizationId }}
                      >
                        Dashboard
                      </Link>
                    ),
                  },
                  {
                    key: `/${organizationId}/org-chart`,
                    icon: <ApartmentOutlined />,
                    label: (
                      <Link
                        to="/$organizationId/org-chart"
                        params={{ organizationId }}
                      >
                        Org Chart
                      </Link>
                    ),
                  },
                ] : []}
              />
              {/* Bottom area: view switcher + org switcher */}
              <App_ViewSwitcherMock collapsed={collapsed} />
              <App_OrgSwitcher collapsed={collapsed} />
            </div>
          </Sider>
        )}

        <Content style={{ padding: 24, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
