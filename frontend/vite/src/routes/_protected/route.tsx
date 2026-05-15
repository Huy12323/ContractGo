import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { Layout, theme } from 'antd'
import { App_VerticalNav } from '@/components/app-shell/App_VerticalNav'
import { App_HorizontalNav } from '@/components/app-shell/App_HorizontalNav/App_HorizontalNav'
import { supabase } from '@/configs/supabase/config'
import { BG_GRADIENT } from '@/providers/antd/Provider_ANTD'

const { Content } = Layout


export const Route = createFileRoute('/_protected')({
  beforeLoad: async ({ location }) => {
    const sb_Auth_GetSession = await supabase.auth.getSession()
    const session = sb_Auth_GetSession.data.session

    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }

    // Check email verification
    const sb_FromProfiles_Select = await supabase
      .from('profiles')
      .select('email_verified')
      .eq('id', session.user.id)
      .single()

    if (sb_FromProfiles_Select.data && !sb_FromProfiles_Select.data.email_verified) {
      throw redirect({ to: '/verify-email', search: { redirect: location.href } })
    }

  },
  component: ProtectedLayout,
})

function ProtectedLayout() {
  const { token } = theme.useToken()

  return (
    <Layout style={{ height: '100vh', background: BG_GRADIENT }}>
      <App_HorizontalNav />

      <div style={{
        flex: 1,
        padding: `0 ${token.paddingXS}px ${token.paddingXS}px`,
        background: BG_GRADIENT,
        overflow: 'hidden',
      }}>
        <Layout style={{
          height: '100%',
          borderRadius: token.borderRadius,
          border: `1px solid ${token.colorBorder}`,
          overflow: 'hidden',
        }}>
          <App_VerticalNav />

          <Content style={{ overflowY: 'auto', overflowX: 'hidden' }}>
            <Outlet />
          </Content>
        </Layout>
      </div>
    </Layout>
  )
}
