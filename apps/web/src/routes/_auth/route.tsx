import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { supabase } from '@/configs/supabase/config'
import { theme } from 'antd'

export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ location }) => {
    const sb_Auth_GetSession = await supabase.auth.getSession()
    const session = sb_Auth_GetSession.data.session

    const allowAuthenticated = ['/reset-password', '/setup-organization', '/invitation']
    if (session && !allowAuthenticated.includes(location.pathname)) {
      throw redirect({ to: '/home' })
    }
  },
  component: AuthLayout,
})

function AuthLayout() {
  const { token } = theme.useToken()

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
