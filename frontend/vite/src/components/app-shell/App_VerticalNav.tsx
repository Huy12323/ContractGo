import { Link, useMatch, useLocation } from '@tanstack/react-router'
import { Layout, Menu, theme } from 'antd'
import { ApartmentOutlined } from '@ant-design/icons'
import { useStore_VerticalNav_Collapsed } from '@/stores/Store_VerticalNav'
import { App_OrgSwitcher } from '@/components/organization/App_OrgSwitcher'
import { App_ViewSwitcherMock } from '@/components/app-shell/App_ViewSwitcherMock'
import {
  const_AppShell_HorizontalNavHeight,
  const_AppShell_VerticalNavWidth,
  const_AppShell_VerticalNavCollapsedWidth,
} from '@/components/app-shell/const_AppShell_Dimensions'

const { Sider } = Layout

export const App_VerticalNav = () => {
  const collapsed = useStore_VerticalNav_Collapsed()
  const { token } = theme.useToken()
  const location = useLocation()

  const organizationId = useMatch({
    from: '/_protected/$organizationId',
    shouldThrow: false,
    select: (m) => m.params.organizationId,
  })

  if (!organizationId) return null

  return (
    <Sider
      trigger={null}
      collapsible
      collapsed={collapsed}
      width={const_AppShell_VerticalNavWidth}
      collapsedWidth={const_AppShell_VerticalNavCollapsedWidth}
      style={{
        background: token.colorBgContainer,
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        height: `calc(100vh - ${const_AppShell_HorizontalNavHeight}px)`,
        position: 'sticky',
        top: const_AppShell_HorizontalNavHeight,
        left: 0,
        overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Menu
          mode="inline"
          selectedKeys={location.pathname.includes('/org-chart') ? [`/${organizationId}/org-chart`] : []}
          style={{ flex: 1, borderRight: 0 }}
          items={[
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
          ]}
        />
        <App_ViewSwitcherMock collapsed={collapsed} />
        <App_OrgSwitcher collapsed={collapsed} />
      </div>
    </Sider>
  )
}
