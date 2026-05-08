import { Link, useMatch, useLocation } from '@tanstack/react-router'
import { Layout, Menu, theme } from 'antd'
import type { ItemType } from 'antd/es/menu/interface'
import {
  DashboardOutlined,
  TeamOutlined,
  ApartmentOutlined,
  ScheduleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { useStore_VerticalNav_Collapsed } from '@/stores/Store_VerticalNav'
import { useQ_Tables_MyRole } from '@/hooks/useQ_Tables_MyRole'
import { App_OrgSwitcher } from '@/components/organization/App_OrgSwitcher'
import {
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

  const qRole = useQ_Tables_MyRole({ organizationId: organizationId ?? '' })
  const role = qRole.role

  if (!organizationId) return null

  const isHR = role === 'owner' || role === 'admin'

  const selectedKeys = location.pathname.includes('/employees')
    ? [`/${organizationId}/employees`]
    : location.pathname.includes('/org-chart')
      ? [`/${organizationId}/org-chart`]
      : location.pathname.includes('/timesheets')
        ? [`/${organizationId}/timesheets`]
        : location.pathname.includes('/my-timeclock')
          ? [`/${organizationId}/my-timeclock`]
          : location.pathname === `/${organizationId}`
            ? [`/${organizationId}`]
            : []

  const hrItems: ItemType[] = [
    {
      key: `/${organizationId}`,
      icon: <DashboardOutlined />,
      label: <Link to="/$organizationId" params={{ organizationId }}>Dashboard</Link>,
    },
    {
      key: `/${organizationId}/employees`,
      icon: <TeamOutlined />,
      label: <Link to="/$organizationId/employees" params={{ organizationId }}>Employees</Link>,
    },
    {
      key: `/${organizationId}/org-chart`,
      icon: <ApartmentOutlined />,
      label: <Link to="/$organizationId/org-chart" params={{ organizationId }}>Org Chart</Link>,
    },
    {
      key: `/${organizationId}/timesheets`,
      icon: <ScheduleOutlined />,
      label: <Link to="/$organizationId/timesheets" params={{ organizationId }}>Timesheets</Link>,
    },
  ]

  const employeeItems: ItemType[] = [
    {
      key: `/${organizationId}/my-timeclock`,
      icon: <ClockCircleOutlined />,
      label: <Link to="/$organizationId/my-timeclock" params={{ organizationId }}>My Timeclock</Link>,
    },
  ]

  const menuItems: ItemType[] = [
    ...(isHR
      ? [{ type: 'group' as const, label: collapsed ? null : 'HR', children: hrItems }]
      : []),
    { type: 'group' as const, label: collapsed ? null : 'Employee', children: employeeItems },
  ]

  return (
    <Sider
      trigger={null}
      collapsible
      collapsed={collapsed}
      width={const_AppShell_VerticalNavWidth}
      collapsedWidth={const_AppShell_VerticalNavCollapsedWidth}
      style={{
        background: token.colorBgContainer,
        borderRight: `1px solid ${token.colorBorder}`,
        height: '100%',
        overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Menu
          mode="inline"
          selectedKeys={selectedKeys}
          style={{ flex: 1, borderRight: 0 }}
          items={menuItems}
        />
        <App_OrgSwitcher collapsed={collapsed} />
      </div>
    </Sider>
  )
}
