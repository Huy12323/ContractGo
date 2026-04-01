import { createFileRoute, Outlet, Navigate, useLocation } from '@tanstack/react-router'
import { useAuth } from '@/hooks/use-auth'
import { Spin, theme } from 'antd'

export const Route = createFileRoute('/_auth')({
  component: AuthLayout,
})

function AuthLayout() {
  const { isAuthenticated, loading } = useAuth()
  const { token } = theme.useToken()
  const location = useLocation()

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  // Allow authenticated users on these pages:
  // - /reset-password: arrive with session from reset email tokens
  // - /setup-organization: authenticated but no org yet
  const allowAuthenticated = ['/reset-password', '/setup-organization']
  if (isAuthenticated && !allowAuthenticated.includes(location.pathname)) {
    return <Navigate to="/dashboard" />
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: token.paddingLG,
        overflow: 'auto',
        background: 'linear-gradient(160deg, #d6e4ff 0%, #f0f5ff 30%, #fff1f0 70%, #e6f7ff 100%)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: token.colorBgContainer,
          borderRadius: token.borderRadiusLG,
          padding: '36px 28px 28px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Outlet />
      </div>
    </div>
  )
}
