import { createFileRoute, Outlet, Navigate } from '@tanstack/react-router'
import { useAuth } from '@/hooks/use-auth'
import { Layout, Spin } from 'antd'

export const Route = createFileRoute('/_auth')({
  component: AuthLayout,
})

function AuthLayout() {
  const { isAuthenticated, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  // Already logged in → go to dashboard
  if (isAuthenticated) {
    return <Navigate to="/dashboard" />
  }

  return (
    <Layout style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f5f5f5' }}>
      <Outlet />
    </Layout>
  )
}
