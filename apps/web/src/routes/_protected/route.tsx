import { createFileRoute, Outlet, Navigate } from '@tanstack/react-router'
import { useAuth } from '@/hooks/use-auth'
import { Layout, Menu, Button, Typography, Spin } from 'antd'
import { signOut } from '@/stores/auth'

const { Header, Content } = Layout

export const Route = createFileRoute('/_protected')({
  component: ProtectedLayout,
})

function ProtectedLayout() {
  const { isAuthenticated, loading, user } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ color: 'white', margin: 0 }}>
          WorldCraft
        </Typography.Title>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Typography.Text style={{ color: 'rgba(255,255,255,0.65)' }}>
            {user?.email}
          </Typography.Text>
          <Button type="text" style={{ color: 'white' }} onClick={() => signOut()}>
            Sign Out
          </Button>
        </div>
      </Header>
      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </Layout>
  )
}
